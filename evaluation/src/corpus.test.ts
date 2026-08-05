import { expect, test } from 'bun:test';
import { cp, lstat, mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createJailedReadOnlyFilesystem } from '../../src/platform/filesystem/index.js';
import { sha256 } from '../../src/shared/contracts/core.js';

import {
  corpusManifestDigest,
  deterministicCorpusFixturePack,
  loadCorpusPack,
  loadCorpusSmokeCase,
  variantRoot,
} from './corpus.js';
import {
  CorpusAnswerKeySchema,
  EvaluationTrialSchema,
  ReviewedPlanFixtureSchema,
} from './corpus.schema.js';

const dualExpectedFinding = {
  findingId: 'expected-01',
  staticReviewApplicable: true,
  evidenceRoles: [
    {
      role: 'operation',
      notApplicable: false,
      ranges: [{ path: 'src/query.ts', startLine: 1, endLine: 1 }],
    },
    {
      role: 'unsafe-condition',
      notApplicable: false,
      ranges: [{ path: 'src/query.ts', startLine: 1, endLine: 1 }],
    },
  ],
};

const dualExpectedPlanScenarios = [
  {
    scenarioId: 'scenario-injection-01',
    objective: 'Review request-derived input at the query boundary.',
    sourceOnlyApplicable: true,
    requiredRiskCondition: 'Request-controlled input can alter query semantics.',
    evidenceRequirements: ['Inspect input origin.', 'Inspect query construction.'],
    relevantPaths: ['src/query.ts'],
    expectedFindingIds: ['expected-01'],
  },
];

test('loads a pinned corpus and keeps its answer key outside the agent target jail', async () => {
  const root = join(tmpdir(), `audit-corpus-${crypto.randomUUID()}`);
  const vulnerableRoot = join(root, 'cases', 'real-js-001', 'vulnerable', 'src');
  const patchedRoot = join(root, 'cases', 'real-js-001', 'patched', 'src');
  await mkdir(vulnerableRoot, { recursive: true });
  await mkdir(patchedRoot, { recursive: true });
  const vulnerable = "const query = `SELECT * FROM users WHERE id = '" + '${' + "userId}'`;\n";
  const patched = "const query = db.query('SELECT * FROM users WHERE id = ?', [userId]);\n";
  await writeFile(join(vulnerableRoot, 'query.ts'), vulnerable, 'utf8');
  await writeFile(join(patchedRoot, 'query.ts'), patched, 'utf8');
  await mkdir(join(root, 'answer-keys'), { recursive: true });
  await mkdir(join(root, 'reviewed-plans'), { recursive: true });
  await writeFile(
    join(root, 'answer-keys', 'real-js-001.json'),
    JSON.stringify({
      schemaVersion: 6,
      caseId: 'real-js-001',
      findingCoverage: 'targeted',
      expectedPlanScenarios: dualExpectedPlanScenarios,
      expectedFindings: [
        {
          findingId: 'expected-01',
          staticReviewApplicable: true,
          evidenceRoles: [
            {
              role: 'operation',
              notApplicable: false,
              ranges: [{ path: 'src/query.ts', startLine: 1, endLine: 1 }],
            },
            {
              role: 'unsafe-condition',
              notApplicable: false,
              ranges: [{ path: 'src/query.ts', startLine: 1, endLine: 1 }],
            },
          ],
        },
      ],
      patchedExpectation: 'no-matching-finding',
      staticReviewApplicable: true,
      adjudicationStatus: 'provisional',
      reviewers: ['fixture-maintainer'],
      notes: 'A source-only query construction pair.',
    }),
    'utf8',
  );
  await writeFile(
    join(root, 'reviewed-plans', 'real-js-001.json'),
    JSON.stringify({
      schemaVersion: 1,
      caseId: 'real-js-001',
      reviewer: 'fixture-maintainer',
      reviewedAt: '2026-07-27T12:00:00.000Z',
      notes: 'Human-reviewed plan fixture without expected locations.',
      vectors: [
        {
          title: 'Review query construction',
          rationale: 'Request data may influence query structure.',
          enabled: true,
          scopeGlobs: ['**/*'],
          reviewObligations: [
            {
              obligationId: 'test-obligation-01',
              riskStatement: 'Input could influence query structure.',
              evidenceRequirement: 'Findings cite source evidence.',
            },
          ],
          limitations: [],
        },
      ],
    }),
    'utf8',
  );
  const vulnerableDigest = directoryDigest('src/query.ts', vulnerable);
  const patchedDigest = directoryDigest('src/query.ts', patched);
  const unsignedManifest = {
    schemaVersion: 1,
    packId: 'real-world-test',
    packVersion: '1.0.0',
    createdAt: '2026-07-27T12:00:00.000Z',
    datasets: [
      {
        datasetId: 'fixture-source',
        title: 'Fixture source',
        sourceUrl: 'https://example.test/dataset',
        revision: 'abc123',
        license: 'MIT',
        retrievedAt: '2026-07-27T12:00:00.000Z',
        attribution: 'Test-only provenance.',
      },
    ],
    cases: [
      {
        caseId: 'real-js-001',
        datasetId: 'fixture-source',
        projectId: 'fixture-project',
        repositoryUrl: 'https://example.test/project',
        vulnerableRevision: 'abc123',
        patchedRevision: 'def456',
        language: 'typescript',
        difficulty: 'easy',
        split: 'development',
        evidenceOrigin: 'real-world',
        controlFamilies: ['injection-outbound-boundary'],
        variantMode: 'paired',
        sourceDirectories: {
          vulnerable: 'cases/real-js-001/vulnerable',
          patched: 'cases/real-js-001/patched',
        },
        sourceDigests: { vulnerable: vulnerableDigest, patched: patchedDigest },
        answerKeyPath: 'answer-keys/real-js-001.json',
        reviewedPlanPath: 'reviewed-plans/real-js-001.json',
        transformedContentDigest: sha256(
          `vulnerable\0${vulnerableDigest}\npatched\0${patchedDigest}`,
        ),
      },
    ],
    redistributionDecision: 'metadata-only',
  };
  await writeFile(
    join(root, 'manifest.json'),
    JSON.stringify({ ...unsignedManifest, manifestDigest: sha256(stableJson(unsignedManifest)) }),
    'utf8',
  );

  const pack = await loadCorpusPack(root);
  expect(pack.cases).toHaveLength(1);
  const deterministicFixture = deterministicCorpusFixturePack(pack);
  expect(deterministicFixture).toEqual({
    cases: [
      {
        case: {
          caseId: 'real-js-001',
          split: 'development',
          sourceDirectories: {
            vulnerable: 'cases/real-js-001/vulnerable',
            patched: 'cases/real-js-001/patched',
          },
        },
        reviewedPlan: expect.objectContaining({ caseId: 'real-js-001' }),
      },
    ],
  });
  expect(JSON.stringify(deterministicFixture)).not.toContain('expected-01');
  const firstCase = pack.cases[0];
  if (firstCase === undefined) throw new Error('Expected the fixture corpus case.');
  const filesystem = await createJailedReadOnlyFilesystem({
    targetRoot: variantRoot(pack, firstCase.case, 'vulnerable'),
  });
  await expect(
    filesystem.readFile({ relativePath: '../answer-keys/real-js-001.json', startLine: 1 }),
  ).rejects.toThrow('invalid');
  await expect(
    filesystem.readFile({ relativePath: '../reviewed-plans/real-js-001.json', startLine: 1 }),
  ).rejects.toThrow('invalid');
});

test('loads the AI-assisted real-world development pair as targeted evaluator-only evidence', async () => {
  const pack = await loadCorpusPack('evaluation/data/research-corpora/ai-assisted-real-world-v1');
  const entry = pack.cases[0];
  if (entry === undefined) throw new Error('Expected the AI-assisted development case.');

  expect(pack.manifest.packId).toBe('ai-assisted-real-world-development');
  expect(entry.answerKey.adjudicationStatus).toBe('ai-assisted');
  expect(entry.answerKey.findingCoverage).toBe('targeted');
  await expect(
    createJailedReadOnlyFilesystem({
      targetRoot: variantRoot(pack, entry.case, 'vulnerable'),
    }).then((filesystem) =>
      filesystem.readFile({ relativePath: '../answer-keys/key.json', startLine: 1 }),
    ),
  ).rejects.toThrow('invalid');
});

test('loads every source-pinned private multilingual semantic-regression pair', async () => {
  const pack = await loadCorpusPack('evaluation/data/research-corpora/private-mixed-language-v1');

  expect(pack.manifest.packId).toBe('private-mixed-language-diagnostic');
  expect(pack.cases).toHaveLength(6);
  expect(new Set(pack.cases.map((entry) => entry.case.language))).toEqual(
    new Set(['csharp', 'go', 'php', 'python', 'ruby', 'rust']),
  );
  expect(pack.cases.every((entry) => entry.case.evidenceOrigin === 'semantic-regression')).toBe(
    true,
  );
  expect(pack.cases.every((entry) => entry.answerKey.adjudicationStatus === 'provisional')).toBe(
    true,
  );
});

test('loads one checksummed smoke target without opening an answer key', async () => {
  const root = join(tmpdir(), `audit-smoke-corpus-${crypto.randomUUID()}`);
  await cp('evaluation/data/corpora', root, { recursive: true });
  await writeFile(
    join(root, 'answer-keys', 'ossf-cve-2018-16492.json'),
    'not valid evaluator JSON',
    'utf8',
  );

  const smoke = await loadCorpusSmokeCase({
    root,
    caseId: 'ossf-cve-2018-16492',
    variant: 'vulnerable',
  });

  expect(smoke.reviewedPlan.caseId).toBe('ossf-cve-2018-16492');
  expect(smoke.variant).toBe('vulnerable');
  expect(smoke.targetRoot).toContain('source/vulnerable');
});

test('rejects an evaluator metadata path that traverses a symbolic link', async () => {
  const parent = join(tmpdir(), `audit-corpus-symlink-${crypto.randomUUID()}`);
  const root = join(parent, 'corpus');
  const outside = join(parent, 'outside-audit-reviewed-plan.json');
  await cp('evaluation/data/corpora', root, { recursive: true });
  await writeFile(outside, '{}', 'utf8');
  const reviewedPlanPath = join(root, 'reviewed-plans', 'ossf-cve-2018-16492.json');
  await rm(reviewedPlanPath);
  await symlink(outside, reviewedPlanPath);

  await expect(loadCorpusPack(root)).rejects.toThrow('symbolic links');
});

test('rejects answer-key fields in a reviewed plan fixture', () => {
  expect(() =>
    ReviewedPlanFixtureSchema.parse({
      schemaVersion: 1,
      caseId: 'audit-reviewed-plan-fixture',
      reviewer: 'fixture-maintainer',
      reviewedAt: '2026-07-29T12:00:00.000Z',
      notes: 'A strict human review fixture.',
      expectedFindings: [],
      vectors: [
        {
          title: 'Review source boundary',
          rationale: 'The source boundary needs review.',
          enabled: true,
          scopeGlobs: ['**/*'],
          reviewObligations: [
            {
              obligationId: 'test-obligation-01',
              riskStatement: 'The source boundary could lack validation.',
              evidenceRequirement: 'Findings cite source evidence.',
            },
          ],
          limitations: [],
        },
      ],
    }),
  ).toThrow();
});

test('requires matching include judgments from exactly two reviewers for a dual-reviewed answer key', () => {
  const answerKey = {
    schemaVersion: 6,
    caseId: 'dual-review-key',
    findingCoverage: 'targeted',
    expectedPlanScenarios: dualExpectedPlanScenarios,
    expectedFindings: [dualExpectedFinding],
    patchedExpectation: 'no-matching-finding',
    staticReviewApplicable: true,
    adjudicationStatus: 'dual-reviewed' as const,
    reviewers: ['reviewer-a'],
    independentReviews: [
      {
        reviewer: 'reviewer-a',
        reviewerKind: 'human',
        reviewedAt: '2026-07-29T12:00:00.000Z',
        decision: 'include',
        findingCoverage: 'targeted',
        expectedPlanScenarios: dualExpectedPlanScenarios,
        expectedFindings: [dualExpectedFinding],
        patchedExpectation: 'no-matching-finding',
        staticReviewApplicable: true,
        notes: 'Independent first review.',
      },
      {
        reviewer: 'reviewer-b',
        reviewerKind: 'human',
        reviewedAt: '2026-07-29T12:01:00.000Z',
        decision: 'include',
        findingCoverage: 'targeted',
        expectedPlanScenarios: dualExpectedPlanScenarios,
        expectedFindings: [dualExpectedFinding],
        patchedExpectation: 'no-matching-finding',
        staticReviewApplicable: true,
        notes: 'Independent second review.',
      },
    ],
    notes: 'A source-only dual-review contract test.',
  };
  expect(() => CorpusAnswerKeySchema.parse(answerKey)).toThrow(
    'matching human independent review records',
  );
  expect(() =>
    CorpusAnswerKeySchema.parse({ ...answerKey, reviewers: ['reviewer-a', 'reviewer-a'] }),
  ).toThrow('matching human independent review records');
  const dualReviewed = { ...answerKey, reviewers: ['reviewer-a', 'reviewer-b'] };
  expect(() => CorpusAnswerKeySchema.parse(dualReviewed)).not.toThrow();
  expect(() =>
    CorpusAnswerKeySchema.parse({
      ...dualReviewed,
      independentReviews: dualReviewed.independentReviews.map((review) => ({
        ...review,
        reviewerKind: 'ai-assisted' as const,
      })),
    }),
  ).toThrow('matching human independent review records');
  expect(() =>
    CorpusAnswerKeySchema.parse({
      ...dualReviewed,
      independentReviews: [
        dualReviewed.independentReviews[0],
        { ...dualReviewed.independentReviews[1], findingCoverage: 'exhaustive' },
      ],
    }),
  ).toThrow('matching include judgments');
  expect(() =>
    CorpusAnswerKeySchema.parse({
      ...dualReviewed,
      independentReviews: [...dualReviewed.independentReviews].reverse(),
    }),
  ).not.toThrow();
  expect(() =>
    CorpusAnswerKeySchema.parse({
      ...dualReviewed,
      independentReviews: [
        dualReviewed.independentReviews[0],
        {
          ...dualReviewed.independentReviews[1],
          expectedPlanScenarios: [
            { ...dualExpectedPlanScenarios[0], relevantPaths: ['src/other.ts'] },
          ],
        },
      ],
    }),
  ).toThrow('matching include judgments');
  expect(() =>
    CorpusAnswerKeySchema.parse({
      ...dualReviewed,
      independentReviews: [
        dualReviewed.independentReviews[0],
        {
          ...dualReviewed.independentReviews[1],
          expectedPlanScenarios: [
            { ...dualExpectedPlanScenarios[0], expectedFindingIds: ['other-finding'] },
          ],
        },
      ],
    }),
  ).toThrow('matching include judgments');
  expect(() =>
    CorpusAnswerKeySchema.parse({
      ...dualReviewed,
      independentReviews: [
        dualReviewed.independentReviews[0],
        {
          ...dualReviewed.independentReviews[1],
          expectedFindings: [
            {
              ...dualExpectedFinding,
              evidenceRoles: [
                {
                  role: 'operation',
                  notApplicable: false,
                  ranges: [{ path: 'src/other.ts', startLine: 1, endLine: 1 }],
                },
                {
                  role: 'unsafe-condition',
                  notApplicable: false,
                  ranges: [{ path: 'src/other.ts', startLine: 1, endLine: 1 }],
                },
              ],
            },
          ],
        },
      ],
    }),
  ).toThrow('matching include judgments');
  expect(() =>
    CorpusAnswerKeySchema.parse({
      ...dualReviewed,
      independentReviews: [
        dualReviewed.independentReviews[0],
        { ...dualReviewed.independentReviews[1], patchedExpectation: 'not-applicable' },
      ],
    }),
  ).toThrow('matching include judgments');
  expect(() =>
    CorpusAnswerKeySchema.parse({
      ...dualReviewed,
      independentReviews: [
        dualReviewed.independentReviews[0],
        { ...dualReviewed.independentReviews[1], staticReviewApplicable: false },
      ],
    }),
  ).toThrow('matching include judgments');
  expect(() =>
    CorpusAnswerKeySchema.parse({
      ...dualReviewed,
      independentReviews: [
        dualReviewed.independentReviews[0],
        { ...dualReviewed.independentReviews[1], decision: 'exclude' },
      ],
    }),
  ).toThrow('matching include judgments');
  expect(() => CorpusAnswerKeySchema.parse({ ...dualReviewed, schemaVersion: 1 })).toThrow();
  expect(() => CorpusAnswerKeySchema.parse({ ...dualReviewed, expectedFindings: [] })).toThrow(
    'source-only applicability and one expected vulnerable finding',
  );
  expect(() =>
    CorpusAnswerKeySchema.parse({ ...dualReviewed, staticReviewApplicable: false }),
  ).toThrow('source-only applicability and one expected vulnerable finding');
});

test('accepts one traceable source-only AI-assisted development review', () => {
  const review = {
    reviewer: 'codex-source-only-review-20260803',
    reviewerKind: 'ai-assisted' as const,
    reviewedAt: '2026-08-03T12:00:00.000Z',
    decision: 'include' as const,
    findingCoverage: 'targeted' as const,
    expectedPlanScenarios: dualExpectedPlanScenarios,
    expectedFindings: [dualExpectedFinding],
    patchedExpectation: 'no-matching-finding' as const,
    staticReviewApplicable: true,
    notes: 'Source-only internal development review; not external reliability evidence.',
  };
  const key = {
    schemaVersion: 6,
    caseId: 'ai-assisted-case-01',
    findingCoverage: 'targeted',
    expectedPlanScenarios: dualExpectedPlanScenarios,
    expectedFindings: [dualExpectedFinding],
    patchedExpectation: 'no-matching-finding',
    staticReviewApplicable: true,
    adjudicationStatus: 'ai-assisted' as const,
    reviewers: [review.reviewer],
    independentReviews: [review],
    notes: 'One AI-assisted source-only review for a low-cost internal development measurement.',
  };
  expect(CorpusAnswerKeySchema.parse(key).adjudicationStatus).toBe('ai-assisted');
  expect(() =>
    CorpusAnswerKeySchema.parse({
      ...key,
      independentReviews: [{ ...review, reviewerKind: 'human' as const }],
    }),
  ).toThrow('AI-assisted answer keys require');
});

test('rejects a paired corpus case without a patched negative expectation', async () => {
  const root = join(tmpdir(), `audit-corpus-paired-negative-${crypto.randomUUID()}`);
  await cp('evaluation/data/corpora', root, { recursive: true });
  const answerKeyPath = join(root, 'answer-keys', 'ossf-cve-2018-16492.json');
  const answerKey = JSON.parse(await readFile(answerKeyPath, 'utf8'));
  await writeFile(
    answerKeyPath,
    JSON.stringify({
      ...answerKey,
      patchedExpectation: 'not-applicable',
      independentReviews: answerKey.independentReviews?.map(
        (review: { patchedExpectation: string }) => ({
          ...review,
          patchedExpectation: 'not-applicable',
        }),
      ),
    }),
    'utf8',
  );
  await expect(loadCorpusPack(root)).rejects.toThrow('requires a patched negative expectation');
});

test('rejects answer-key paths that do not exist in the checked vulnerable snapshot', async () => {
  const root = join(tmpdir(), `audit-corpus-invalid-anchor-path-${crypto.randomUUID()}`);
  await cp('evaluation/data/corpora', root, { recursive: true });
  const answerKeyPath = join(root, 'answer-keys', 'ossf-cve-2018-16492.json');
  const answerKey = JSON.parse(await readFile(answerKeyPath, 'utf8'));
  const missingPath = 'missing-source-file.txt';
  await writeFile(
    answerKeyPath,
    JSON.stringify({
      ...answerKey,
      adjudicationStatus: 'provisional',
      reviewers: ['fixture-maintainer'],
      independentReviews: undefined,
      developmentCalibration: undefined,
      expectedPlanScenarios: answerKey.expectedPlanScenarios.map(
        (scenario: { relevantPaths: string[] }) => ({
          ...scenario,
          relevantPaths: [missingPath],
        }),
      ),
      expectedFindings: answerKey.expectedFindings.map(
        (finding: { evidenceRoles: { ranges: { path: string }[] }[] }) => ({
          ...finding,
          evidenceRoles: finding.evidenceRoles.map((role) => ({
            ...role,
            ranges: role.ranges.map((range) => ({ ...range, path: missingPath })),
          })),
        }),
      ),
    }),
    'utf8',
  );
  await expect(loadCorpusPack(root)).rejects.toThrow('Corpus path does not exist');
});

test('rejects answer-key ranges outside the checked vulnerable source lines', async () => {
  const root = join(tmpdir(), `audit-corpus-invalid-anchor-range-${crypto.randomUUID()}`);
  await cp('evaluation/data/corpora', root, { recursive: true });
  const answerKeyPath = join(root, 'answer-keys', 'ossf-cve-2018-16492.json');
  const answerKey = JSON.parse(await readFile(answerKeyPath, 'utf8'));
  await writeFile(
    answerKeyPath,
    JSON.stringify({
      ...answerKey,
      adjudicationStatus: 'provisional',
      reviewers: ['fixture-maintainer'],
      independentReviews: undefined,
      developmentCalibration: undefined,
      expectedFindings: answerKey.expectedFindings.map(
        (finding: { evidenceRoles: { ranges: { endLine: number }[] }[] }) => ({
          ...finding,
          evidenceRoles: finding.evidenceRoles.map((role) => ({
            ...role,
            ranges: role.ranges.map((range) => ({ ...range, endLine: 10_000 })),
          })),
        }),
      ),
    }),
    'utf8',
  );
  await expect(loadCorpusPack(root)).rejects.toThrow(
    'exceeds its frozen vulnerable source snapshot',
  );
});

test('validates source snapshots from raw bytes rather than lossy decoded text', async () => {
  const root = join(tmpdir(), `audit-corpus-raw-byte-digest-${crypto.randomUUID()}`);
  await cp('evaluation/data/corpora', root, { recursive: true });
  const sourcePath = join(
    root,
    'openssf-cve-benchmark-cve-2018-16492',
    'source',
    'vulnerable',
    'raw-byte.bin',
  );
  await writeFile(sourcePath, new Uint8Array([0x80]));
  const manifestPath = join(root, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const ossfCase = manifest.cases.find(
    (entry: { caseId: string }) => entry.caseId === 'ossf-cve-2018-16492',
  );
  if (ossfCase === undefined) throw new Error('Expected pinned OpenSSF fixture.');
  const vulnerableDigest = await rawDirectoryDigest(
    join(root, ossfCase.sourceDirectories.vulnerable),
  );
  const sourceDigests = { ...ossfCase.sourceDigests, vulnerable: vulnerableDigest };
  const transformedContentDigest = sha256(
    (['vulnerable', 'patched', 'benign'] as const)
      .flatMap((variant) => {
        const digest = sourceDigests[variant];
        return digest === undefined ? [] : [`${variant}\0${digest}`];
      })
      .join('\n'),
  );
  const cases = manifest.cases.map((entry: { caseId: string }) =>
    entry.caseId === ossfCase.caseId
      ? { ...entry, sourceDigests, transformedContentDigest }
      : entry,
  );
  const { manifestDigest: _manifestDigest, ...unsignedManifest } = { ...manifest, cases };
  await writeFile(
    manifestPath,
    JSON.stringify(
      { ...unsignedManifest, manifestDigest: corpusManifestDigest(unsignedManifest) },
      null,
      2,
    ),
    'utf8',
  );

  expect((await loadCorpusPack(root)).cases).toHaveLength(4);
});

test('evaluation trials preserve only a balanced content-free admission funnel', () => {
  const trial = EvaluationTrialSchema.parse({
    caseId: 'case-evaluation-funnel-01',
    variant: 'vulnerable',
    repetition: 1,
    status: 'completed',
    reviewedPlanFingerprint: null,
    pathReachability: null,
    findingScore: null,
    planKeys: [],
    findingKeys: [],
    durationMs: 1,
    errorCode: null,
    admissionFunnel: {
      modelCandidateCount: 1,
      integrityRejectedCount: 0,
      toolEvidenceRejectedCount: 0,
      verifierAcceptedCount: 1,
      verifierRejectedCount: 0,
      verifierIncompleteCount: 0,
      verifierToolEvidenceRejectedCount: 0,
      verifierEvidenceRejectedCount: 0,
      verifierReconciledCount: 1,
      postVerificationRejectedCount: 0,
      duplicateCollapsedCount: 0,
      admittedFindingCount: 1,
      verificationTerminalLanes: {
        accepted: 1,
        rejected: 0,
        modelIncomplete: 0,
        evidenceProjectionInvalid: 0,
        stageFailed: 0,
        inspectionMissing: 0,
        wrapperContractInvalid: 0,
      },
    },
  });
  expect(trial.admissionFunnel?.admittedFindingCount).toBe(1);
  expect(() =>
    EvaluationTrialSchema.parse({
      ...trial,
      admissionFunnel: { ...trial.admissionFunnel, sourceReason: 'must not persist' },
    }),
  ).toThrow();
});

test('evaluation trials retain every source-free identity beyond retired collection ceilings', () => {
  const identities = Array.from({ length: 513 }, (_, index) => `identity-${String(index)}`);
  const trial = EvaluationTrialSchema.parse({
    caseId: 'case-evaluation-unbounded-01',
    variant: 'vulnerable',
    repetition: 1,
    status: 'completed',
    reviewedPlanFingerprint: null,
    pathReachability: null,
    findingScore: null,
    planKeys: identities,
    findingKeys: identities,
    reviewRequiredKeys: identities,
    durationMs: 1,
    errorCode: null,
  });
  expect(trial.planKeys).toHaveLength(513);
  expect(trial.findingKeys).toHaveLength(513);
  expect(trial.reviewRequiredKeys).toHaveLength(513);
});

test('rejects a completed true positive when its terminal evidence trace loses an expected role', () => {
  const trial = {
    caseId: 'case-terminal-evidence-01',
    variant: 'vulnerable' as const,
    repetition: 1,
    status: 'completed' as const,
    reviewedPlanFingerprint: null,
    pathReachability: null,
    findingScore: {
      truePositives: 1,
      falsePositives: 0,
      falseNegatives: 0,
      findingPrecision: null,
      findingRecall: 1,
      findingF1: null,
      notApplicableExpectedFindingCount: 0,
      unnecessaryVectorCount: 0,
      matchedLocalizedCount: 1,
      matchedMislocalizedCount: 0,
      unmatchedAdjudicatedFalsePositiveCount: 0,
      unmatchedUnadjudicatedCount: 0,
      patchedMatchingFindingCount: 0,
      localizationAccuracy: 1,
      pairedPersistence: null,
      matchedExpectedFindingIds: ['expected-01'],
    },
    stageEvidenceCoverage: {
      expectedRoleCount: 2,
      mappedLocationCount: 2,
      groundedRoleCount: 2,
      verifiedRoleCount: 2,
      firstIncompleteStage: 'complete' as const,
      roleTraces: [
        {
          findingId: 'expected-01',
          role: 'operation' as const,
          planScoped: true,
          mapperSelected: true,
          postureReconciled: true,
          discoverySeeded: true,
          groundingSelected: true,
          verifierSelected: true,
          terminalVerifierSelected: true,
          terminalCompleted: true,
          firstIncompleteStage: 'complete' as const,
        },
        {
          findingId: 'expected-01',
          role: 'unsafe-condition' as const,
          planScoped: true,
          mapperSelected: true,
          postureReconciled: true,
          discoverySeeded: true,
          groundingSelected: true,
          verifierSelected: true,
          terminalVerifierSelected: false,
          terminalCompleted: true,
          firstIncompleteStage: 'complete' as const,
        },
      ],
      terminalFindingEvidenceMatches: [
        {
          expectedFindingId: 'expected-01',
          terminalFindingId: 'finding-01',
          roleSelections: [
            { role: 'operation' as const, selected: true },
            { role: 'unsafe-condition' as const, selected: false },
          ],
        },
      ],
    },
    planKeys: [],
    findingKeys: [],
    durationMs: 1,
    errorCode: null,
  };
  expect(() => EvaluationTrialSchema.parse(trial)).toThrow('terminal evidence');
});

test('rejects a corpus manifest that assigns more than one case to one repository', async () => {
  const root = join(tmpdir(), `audit-corpus-project-limit-${crypto.randomUUID()}`);
  await cp('evaluation/data/corpora', root, { recursive: true });
  const source = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  const secondCase = {
    ...source.cases[0],
    caseId: 'ossf-cve-2018-16492-second-case',
    answerKeyPath: 'answer-keys/ossf-cve-2018-16492-second-case.json',
    reviewedPlanPath: 'reviewed-plans/ossf-cve-2018-16492-second-case.json',
  };
  const unsignedManifest = { ...source, cases: [...source.cases, secondCase] };
  delete unsignedManifest.manifestDigest;
  await writeFile(
    join(root, 'manifest.json'),
    JSON.stringify(
      { ...unsignedManifest, manifestDigest: corpusManifestDigest(unsignedManifest) },
      null,
      2,
    ),
    'utf8',
  );
  await expect(loadCorpusPack(root)).rejects.toThrow('contributes more than one');
});

function directoryDigest(path: string, content: string): string {
  return sha256(`${path}\0${sha256(content)}`);
}

async function rawDirectoryDigest(root: string): Promise<string> {
  const records: string[] = [];
  const visit = async (directory: string, prefix: string): Promise<void> => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const path = join(directory, entry.name);
      const relativePath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      const status = await lstat(path);
      if (status.isDirectory()) {
        await visit(path, relativePath);
      } else if (status.isFile()) {
        records.push(`${relativePath}\0${sha256(await readFile(path))}`);
      }
    }
  };
  await visit(root, '');
  return sha256(records.join('\n'));
}

function stableJson(value: object): string {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return item;
    return Object.fromEntries(
      Object.entries(item).sort(([left], [right]) => left.localeCompare(right)),
    );
  });
}
