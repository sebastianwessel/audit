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
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  '.agent/IMPLEMENTATION.md',
  '.claude/agents/audit-planner.md',
  '.claude/agents/audit-executor.md',
  '.claude/agents/report-reviewer.md',
  'docs/README.md',
  'docs/01-overview/README.md',
  'docs/02-getting-started/README.md',
  '.github/workflows/ci.yml',
  'package.json',
  'bun.lock',
  'src/features/attack-planning/README.md',
  'evaluation/src/README.md',
  'src/features/audit-execution/README.md',
  'src/features/audit-lineage/README.md',
  'src/platform/filesystem/README.md',
  'tests/integration/README.md',
  'evaluation/README.md',
  'evaluation/data/fixtures/README.md',
  'evaluation/data/fixtures/cases/ts-unsafe-query/case.json',
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
  'evaluation/data/corpora/manifest.json',
  'evaluation/data/candidates/openssf-candidate-pilot.json',
];

const evaluatorTopLevelEntries = new Set(await readdir('evaluation'));
for (const requiredEntry of ['src', 'data', 'runs'] as const) {
  if (!evaluatorTopLevelEntries.has(requiredEntry)) {
    throw new Error(`Evaluation workspace is missing its required ${requiredEntry}/ directory.`);
  }
}
for (const retiredEntry of [
  'acquisition',
  'acquisition-metadata',
  'acquisition-snapshots',
  'baselines',
  'benchmarks',
  'candidates',
  'corpora',
  'curation-dossiers',
  'fixtures',
  'research-corpora',
  'stage-isolated',
] as const) {
  if (evaluatorTopLevelEntries.has(retiredEntry)) {
    throw new Error(
      `Evaluation workspace retains retired top-level directory: evaluation/${retiredEntry}`,
    );
  }
}

for (const path of required) {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`Missing required artifact: ${path}`);
  if (path.startsWith('specs/') && !(await file.text()).includes('#')) {
    throw new Error(`Specification lacks a heading: ${path}`);
  }
}

const specReadingOrder = await Bun.file('specs/README.md').text();
for (const section of CanonicalSpecReadingOrderSections) {
  if (!specReadingOrder.includes(section)) {
    throw new Error(`Specification reading order omits canonical section: ${section}`);
  }
}

const entries = await readdir(join(import.meta.dir, '..', 'specs'), { recursive: true });
if (!entries.some((entry) => entry.endsWith('readiness-and-traceability.md'))) {
  throw new Error('Missing readiness and traceability record');
}

const numberedSpecCollisions = duplicateNumberedSpecPrefixes(
  entries.filter((entry) => entry.endsWith('.md')).map((entry) => `specs/${entry}`),
);
if (numberedSpecCollisions.length > 0) {
  throw new Error(
    `Numbered specification filenames must be unique within their directory: ${numberedSpecCollisions.join('; ')}`,
  );
}

for (const [path, prefix] of [
  ['specs/02-capabilities/capability-inventory.md', 'CAP'],
  ['specs/06-quality/01-verification-and-operations.md', 'REQ'],
] as const) {
  const duplicates = duplicateTableSpecificationIdentifiers(await Bun.file(path).text(), prefix);
  if (duplicates.length > 0) {
    throw new Error(
      `Canonical ${prefix} definitions must be unique in ${path}: ${duplicates.join(', ')}`,
    );
  }
}

const canonicalVersionRegistryPath = 'specs/04-contracts/01-artifact-contracts.md';
const canonicalVersionRegistry = await Bun.file(canonicalVersionRegistryPath).text();
if (!canonicalVersionRegistry.includes(CanonicalPersistedArtifactVersionMarker)) {
  throw new Error(
    `Missing canonical persisted artifact version registry: ${canonicalVersionRegistryPath}`,
  );
}
for (const artifact of CanonicalPersistedArtifactVersions) {
  if (!canonicalVersionRegistry.includes(canonicalPersistedArtifactVersionRow(artifact))) {
    throw new Error(
      `Canonical persisted artifact version registry is missing ${artifact.artifact} v${artifact.version}.`,
    );
  }
  const source = await Bun.file(artifact.sourcePath).text();
  if (!strictContractDeclaresVersion(artifact, source)) {
    throw new Error(
      `Strict contract source does not declare ${artifact.artifact} v${artifact.version}: ${artifact.sourcePath}`,
    );
  }
}

const agentGuidance = await Bun.file('AGENTS.md').text();
if (!agentGuidance.includes('`specs/04-contracts/01-artifact-contracts.md`')) {
  throw new Error('AGENTS.md must point to the canonical persisted artifact version registry.');
}

for (const retiredGuidance of [
  '.claude/agents/fact-candidate-discovery.md',
  '.claude/agents/fact-refuter.md',
] as const) {
  if (await Bun.file(retiredGuidance).exists()) {
    throw new Error(`Retired agent guidance must not be retained: ${retiredGuidance}`);
  }
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

const requiredFeatureFacades = [
  'src/features/attack-planning/index.ts',
  'src/features/attack-planning/planner/agent/index.ts',
  'src/features/attack-planning/planner/stage/index.ts',
  'src/features/audit-execution/index.ts',
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
  'src/features/developer-guidance/index.ts',
  'src/features/developer-guidance/agent/index.ts',
  'src/features/developer-guidance/stage/index.ts',
  'src/features/review-workflow/model-contracts/index.ts',
  'src/features/review-workflow/instructions/index.ts',
  'src/features/review-workflow/stage-lifecycle/index.ts',
] as const;
for (const path of requiredFeatureFacades) {
  if (!(await Bun.file(path).exists())) {
    throw new Error(`Feature facade is missing: ${path}`);
  }
}
for (const retiredPath of ['src/features/review-workflow/infrastructure'] as const) {
  if (await Bun.file(retiredPath).exists()) {
    throw new Error(`Retired feature facade must not be retained: ${retiredPath}`);
  }
}

const retiredObligationTerms = [
  'evidenceQuestionIndex',
  'successCriterionIndex',
  'question-and-success-criterion',
  'one candidate-blind conclusion (`supported`, `contradicted`, or `inconclusive`)',
  'one supported, contradicted, or inconclusive assessment for every vector question',
] as const;
const retiredGroundingTerms = [
  'binding-rejected',
  'groundingBindingRejectedCount',
  'Grounding binding rejected',
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
  for (const term of retiredGroundingTerms) {
    if (content.includes(term)) {
      throw new Error(`Normative contract retains retired grounding terminology: ${path}`);
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
  ['evaluation/src/evaluation-primitives.schema.ts', 'LanguageTagSchema'],
  ['src/features/target-inventory/inventory.ts', 'inferLanguageHint'],
  ['src/features/review-workflow/runtime/source-tools.ts', 'inferLanguageHint'],
  ['evaluation/src/corpus.schema.ts', 'CorpusVariantModeSchema'],
  ['evaluation/src/real-world-runner.ts', 'runCorpusEvaluation'],
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
    'specs/08-evaluation/06-control-and-state-corpus-expansion.md',
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
