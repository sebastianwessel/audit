import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const required = [
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  '.agent/IMPLEMENTATION.md',
  '.claude/agents/audit-planner.md',
  '.claude/agents/audit-executor.md',
  '.claude/agents/report-reviewer.md',
  'concepts/README.md',
  'docs/README.md',
  'docs/01-overview/README.md',
  'docs/02-getting-started/README.md',
  '.github/workflows/ci.yml',
  'package.json',
  'bun.lock',
  'src/features/attack-planning/README.md',
  'src/features/evaluation/README.md',
  'src/features/audit-execution/README.md',
  'src/features/audit-lineage/README.md',
  'src/platform/filesystem/README.md',
  'tests/integration/README.md',
  'evaluation/README.md',
  'evaluation/fixtures/README.md',
  'evaluation/fixtures/cases/ts-unsafe-query/case.json',
  'specs/02-capabilities/capability-inventory.md',
  'specs/03-architecture/01-system-architecture.md',
  'specs/03-architecture/04-independent-verifier-diversity.md',
  'specs/04-contracts/01-artifact-contracts.md',
  'specs/05-security/01-security-model.md',
  'specs/06-quality/01-verification-and-operations.md',
  'specs/07-research/02-upstream-implementation-analysis.md',
  'specs/07-research/03-evaluation-corpus-research.md',
  'specs/08-evaluation/01-evaluation-strategy.md',
  'specs/08-evaluation/02-test-data-and-fixture-corpus.md',
  'specs/08-evaluation/03-evaluation-runner-and-report.md',
  'specs/08-evaluation/04-real-world-corpus-and-reliability.md',
  'evaluation/corpora/manifest.json',
  'evaluation/candidates/openssf-candidate-pilot.json',
  'artifacts/schemas/attack-plan.schema.json',
  'artifacts/schemas/audit-lineage.schema.json',
  'artifacts/schemas/audit-report-v15.schema.json',
  'artifacts/schemas/audit-run-attempt.schema.json',
  'artifacts/schemas/audit-run-manifest.schema.json',
  'artifacts/schemas/context-document.schema.json',
  'artifacts/schemas/corpus-pack.schema.json',
  'artifacts/schemas/corpus-candidate-registry.schema.json',
  'artifacts/schemas/corpus-readiness.schema.json',
  'artifacts/schemas/evaluation-pack.schema.json',
  'artifacts/schemas/runtime-configuration.schema.json',
  'artifacts/schemas/source-admission-policy.schema.json',
  'artifacts/schemas/source-snapshot-manifest.schema.json',
  'artifacts/schemas/source-snapshot-retention-index.schema.json',
  'artifacts/schemas/target-inventory.schema.json',
];

for (const path of required) {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`Missing required artifact: ${path}`);
  if (path.startsWith('specs/') && !(await file.text()).includes('#')) {
    throw new Error(`Specification lacks a heading: ${path}`);
  }
}

const entries = await readdir(join(import.meta.dir, '..', 'specs'), { recursive: true });
if (!entries.some((entry) => entry.endsWith('readiness-and-traceability.md'))) {
  throw new Error('Missing readiness and traceability record');
}

const publicDocEntries = await readdir(join(import.meta.dir, '..', 'docs'), { recursive: true });
const internalPublicDocLink =
  /\]\((?:(?:\.\.?\/)*)(?:specs|\.agent|\.claude)(?:\/|[)#])|\]\((?:(?:\.\.?\/)*)?(?:AGENTS|CLAUDE)\.md(?:[)#])/u;
for (const entry of publicDocEntries) {
  if (!entry.endsWith('.md')) continue;
  const content = await Bun.file(join(import.meta.dir, '..', 'docs', entry)).text();
  if (internalPublicDocLink.test(content)) {
    throw new Error(
      `Public documentation must not link to internal repository guidance: docs/${entry}`,
    );
  }
}

for (const forbiddenPath of ['tests/unit', 'tests/contracts']) {
  if (await Bun.file(forbiddenPath).exists()) {
    throw new Error(`Unit and contract tests must be colocated: ${forbiddenPath}`);
  }
}

const retiredObligationTerms = [
  'evidenceQuestionIndex',
  'successCriterionIndex',
  'question-and-success-criterion',
  'one candidate-blind conclusion (`supported`, `contradicted`, or `inconclusive`)',
  'one supported, contradicted, or inconclusive assessment for every vector question',
] as const;
for (const path of [
  'AGENTS.md',
  '.agent/IMPLEMENTATION.md',
  'specs/01-product/01-scope-and-workflow.md',
  'specs/03-architecture/01-system-architecture.md',
  'specs/03-architecture/02-evidence-fact-pipeline.md',
  'specs/03-architecture/03-plan-anchored-semantic-review.md',
  'specs/03-architecture/05-evidence-first-review.md',
  'specs/03-architecture/06-candidate-blind-source-posture.md',
  'specs/04-contracts/01-artifact-contracts.md',
] as const) {
  const content = await Bun.file(path).text();
  for (const term of retiredObligationTerms) {
    if (content.includes(term)) {
      throw new Error(`Normative contract retains retired obligation terminology: ${path}`);
    }
  }
}

const languageNeutralityRequirements = [
  ['AGENTS.md', 'reviewed target is language-agnostic'],
  ['.agent/IMPLEMENTATION.md', 'target-language allowlist'],
  ['specs/01-product/01-scope-and-workflow.md', 'Target-language policy'],
  ['specs/03-architecture/01-system-architecture.md', 'Language identification'],
  ['specs/08-evaluation/02-test-data-and-fixture-corpus.md', 'language-balanced'],
  ['docs/01-overview/README.md', 'any programming language'],
  ['src/features/evaluation/evaluation.schema.ts', 'LanguageTagSchema'],
  ['src/features/target-inventory/inventory.ts', 'inferLanguageHint'],
  ['src/features/review-workflow/runtime/source-tools.ts', 'inferLanguageHint'],
  ['src/features/evaluation/corpus.schema.ts', 'CorpusVariantModeSchema'],
  ['src/features/evaluation/real-world-runner.ts', 'runCorpusEvaluation'],
] as const;
for (const [path, marker] of languageNeutralityRequirements) {
  if (!(await Bun.file(path).text()).includes(marker)) {
    throw new Error(`Language-neutrality sync marker is missing: ${path}`);
  }
}

const acquisitionStateOwnershipRequirements = [
  [
    'specs/02-capabilities/capability-inventory.md',
    'observed upstream source-license status, single-owner state isolation',
  ],
  [
    'specs/08-evaluation/05-control-and-state-corpus-expansion.md',
    'contains no source-snapshot state, human-adjudication state',
  ],
  [
    'specs/04-contracts/01-artifact-contracts.md',
    'contain no target source, source-snapshot state, human-adjudication state',
  ],
] as const;
for (const [path, marker] of acquisitionStateOwnershipRequirements) {
  if (!(await Bun.file(path).text()).includes(marker)) {
    throw new Error(`Acquisition state ownership sync marker is missing: ${path}`);
  }
}

console.log(`Bootstrap check passed: ${required.length} required artifacts and specs verified.`);
