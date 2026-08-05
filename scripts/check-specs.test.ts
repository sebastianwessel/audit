import { expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  CanonicalPersistedArtifactVersionMarker,
  CanonicalPersistedArtifactVersions,
  CanonicalSpecReadingOrderSections,
  canonicalPersistedArtifactVersionRow,
  duplicateNumberedSpecPrefixes,
  duplicateTableSpecificationIdentifiers,
  strictContractDeclaresVersion,
} from './spec-checks.js';

const required = [
  'docs/README.md',
  'docs/01-overview/README.md',
  'src/features/attack-planning/README.md',
  'evaluation/src/README.md',
  'src/platform/filesystem/README.md',
  'tests/integration/README.md',
  'evaluation/data/fixtures/cases/ts-unsafe-query/case.json',
];

test('bootstrap keeps public docs and the vertical-slice structure', async () => {
  for (const path of required) {
    expect(await Bun.file(path).exists()).toBe(true);
  }
});

test('topic facades keep model contracts separate from executable stages', async () => {
  const facades = [
    'src/features/attack-planning/planner/agent/index.ts',
    'src/features/attack-planning/planner/stage/index.ts',
    'src/features/audit-execution/evidence-map/agent/index.ts',
    'src/features/audit-execution/evidence-map/stage/index.ts',
    'src/features/audit-execution/source-posture/agent/index.ts',
    'src/features/audit-execution/source-posture/stage/index.ts',
    'src/features/audit-execution/investigation/agent/index.ts',
    'src/features/audit-execution/investigation/stage/index.ts',
    'src/features/audit-execution/candidate-grounding/agent/index.ts',
    'src/features/audit-execution/candidate-grounding/stage/index.ts',
    'src/features/audit-execution/verification/agent/index.ts',
    'src/features/audit-execution/verification/stage/index.ts',
    'src/features/audit-execution/candidate-aware/index.ts',
    'src/features/review-workflow/tools/index.ts',
  ];
  for (const path of facades) expect(await Bun.file(path).exists()).toBe(true);
  expect(await Bun.file('src/features/review-workflow/infrastructure/index.ts').exists()).toBe(
    false,
  );
});

test('the specification reading order exposes every canonical top-level area', async () => {
  const readingOrder = await Bun.file('specs/README.md').text();
  for (const section of CanonicalSpecReadingOrderSections) {
    expect(readingOrder).toContain(section);
  }
});

test('normative contracts use only the canonical obligation and posture vocabulary', async () => {
  const paths = [
    'AGENTS.md',
    '.agent/IMPLEMENTATION.md',
    'specs/01-product/01-scope-and-workflow.md',
    'specs/03-architecture/01-system-architecture.md',
    'specs/03-architecture/02-evidence-fact-pipeline.md',
    'specs/03-architecture/03-plan-anchored-semantic-review.md',
    'specs/03-architecture/05-evidence-first-review.md',
    'specs/03-architecture/06-candidate-blind-source-posture.md',
    'specs/04-contracts/01-artifact-contracts.md',
  ];
  const retiredTerms = [
    'evidenceQuestionIndex',
    'successCriterionIndex',
    'question-and-success-criterion',
    'one candidate-blind conclusion (`supported`, `contradicted`, or `inconclusive`)',
    'one supported, contradicted, or inconclusive assessment for every vector question',
    'binding-rejected',
    'groundingBindingRejectedCount',
    'Grounding binding rejected',
  ];

  for (const path of paths) {
    const content = await Bun.file(path).text();
    for (const term of retiredTerms) expect(content).not.toContain(term);
  }
});

test('acquisition specifications preserve single-owner state boundaries', async () => {
  const expectations = [
    [
      'specs/02-capabilities/capability-inventory.md',
      'observed upstream source-license status, single-owner state isolation',
    ],
    [
      'specs/08-evaluation/06-control-and-state-corpus-expansion.md',
      'contains no source-snapshot state, human-adjudication state',
    ],
    [
      'specs/04-contracts/01-artifact-contracts.md',
      'contain no target source, source-snapshot state, human-adjudication state',
    ],
  ] as const;
  for (const [path, marker] of expectations) {
    expect(await Bun.file(path).text()).toContain(marker);
  }
  expect(await Bun.file('specs/02-capabilities/capability-inventory.md').text()).not.toContain(
    'license/adjudication-state',
  );
});

test('public documentation does not link to internal repository guidance', async () => {
  const internalPublicDocLink =
    /\]\((?:(?:\.\.?\/)*)(?:specs|\.agent|\.claude)(?:\/|[)#])|\]\((?:(?:\.\.?\/)*)?(?:AGENTS|CLAUDE)\.md(?:[)#])/u;
  const entries = await readdir('docs', { recursive: true });
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const path = join('docs', entry);
    expect(await Bun.file(path).text()).not.toMatch(internalPublicDocLink);
  }
});

test('numbered specifications have one unambiguous position per directory', async () => {
  const entries = await readdir('specs', { recursive: true });
  const collisions = duplicateNumberedSpecPrefixes(
    entries.filter((entry) => entry.endsWith('.md')).map((entry) => `specs/${entry}`),
  );
  expect(collisions).toEqual([]);
});

test('numbered-spec collision detection ignores different directories and unnumbered files', () => {
  expect(
    duplicateNumberedSpecPrefixes([
      'specs/03-architecture/01-one.md',
      'specs/03-architecture/01-two.md',
      'specs/03-architecture/02-three.md',
      'specs/04-contracts/01-four.md',
      'specs/README.md',
    ]),
  ).toEqual([
    'specs/03-architecture/01: specs/03-architecture/01-one.md, specs/03-architecture/01-two.md',
  ]);
});

test('canonical capability and requirement owner tables reject duplicate definitions', async () => {
  expect(
    duplicateTableSpecificationIdentifiers('| CAP-001 | One |\n| CAP-001 | Two |', 'CAP'),
  ).toEqual(['CAP-001 (2)']);
  expect(
    duplicateTableSpecificationIdentifiers('| REQ-001 | One |\n| REQ-002 | Two |', 'REQ'),
  ).toEqual([]);
  expect(
    duplicateTableSpecificationIdentifiers(
      await Bun.file('specs/02-capabilities/capability-inventory.md').text(),
      'CAP',
    ),
  ).toEqual([]);
  expect(
    duplicateTableSpecificationIdentifiers(
      await Bun.file('specs/06-quality/01-verification-and-operations.md').text(),
      'REQ',
    ),
  ).toEqual([]);
});

test('the canonical persisted artifact version registry agrees with strict contracts', async () => {
  const registry = await Bun.file('specs/04-contracts/01-artifact-contracts.md').text();
  expect(registry).toContain(CanonicalPersistedArtifactVersionMarker);
  expect(await Bun.file('AGENTS.md').text()).toContain(
    '`specs/04-contracts/01-artifact-contracts.md`',
  );

  for (const artifact of CanonicalPersistedArtifactVersions) {
    expect(registry).toContain(canonicalPersistedArtifactVersionRow(artifact));
    const source = await Bun.file(artifact.sourcePath).text();
    expect(strictContractDeclaresVersion(artifact, source)).toBe(true);
  }
  expect(
    strictContractDeclaresVersion(CanonicalPersistedArtifactVersions[0], '{"properties":{}}'),
  ).toBe(false);
});

test('retired fact-candidate agent roles are absent', async () => {
  expect(await Bun.file('.claude/agents/fact-candidate-discovery.md').exists()).toBe(false);
  expect(await Bun.file('.claude/agents/fact-refuter.md').exists()).toBe(false);
});
