import type { AttackVector } from '../../attack-planning/plan.schema.js';
import { hasExactPlanObligations } from '../../attack-planning/plan.schema.js';
import type { EvidenceMap } from '../evidence-map/contract.js';
import type { HypothesisSeed, UnverifiedAuditCandidate } from '../investigation/contract.js';
import { verifyModelFindings } from '../investigation/verify.js';
import type { SourceDocument } from '../phase-input/contract.js';
import type { SourcePosture } from '../source-posture/contract.js';
import type {
  CandidateGroundingOutput,
  CanonicalCandidateGroundingOutput,
  UnverifiedGroundedCandidate,
} from './contract.js';

/** Selects one complete, identity-bound grounding per discovery seed. */
export function selectSeedBoundGroundings(
  seeds: readonly HypothesisSeed[],
  output: CandidateGroundingOutput,
  evidenceMap: EvidenceMap,
): Readonly<{
  candidates: readonly UnverifiedAuditCandidate[];
  seedBoundCandidates: readonly Readonly<{
    seed: HypothesisSeed;
    candidate: UnverifiedAuditCandidate;
  }>[];
  submittedCount: number;
  nullCount: number;
  rejectedCount: number;
}> {
  const bySeed = new Map(output.groundings.map((grounding) => [grounding.seedId, grounding]));
  if (bySeed.size !== output.groundings.length || bySeed.size !== seeds.length) {
    return {
      candidates: [],
      seedBoundCandidates: [],
      submittedCount: 0,
      nullCount: 0,
      rejectedCount: seeds.length,
    };
  }
  let nullCount = 0;
  let rejectedCount = 0;
  let submittedCount = 0;
  const candidates: UnverifiedAuditCandidate[] = [];
  const seedBoundCandidates: Array<
    Readonly<{ seed: HypothesisSeed; candidate: UnverifiedAuditCandidate }>
  > = [];
  for (const seed of seeds) {
    const grounding = bySeed.get(seed.seedId);
    if (grounding === undefined) {
      rejectedCount += 1;
      continue;
    }
    if (grounding.candidate === null) {
      nullCount += 1;
      continue;
    }
    const candidate = materializeCandidate(seed, grounding.candidate, evidenceMap);
    if (candidate === undefined) {
      rejectedCount += 1;
      continue;
    }
    submittedCount += 1;
    candidates.push(candidate);
    seedBoundCandidates.push({ seed, candidate });
  }
  return Object.freeze({
    candidates,
    seedBoundCandidates,
    submittedCount,
    nullCount,
    rejectedCount,
  });
}

/**
 * Converts untrusted model grounding output into the only form that may cross
 * a recovery boundary. A seed has exactly one explicit outcome; raw selectors
 * and non-reportable discovery data remain process-local.
 */
export function canonicalizeCandidateGroundingOutput(input: {
  vector: AttackVector;
  seeds: readonly HypothesisSeed[];
  output: CandidateGroundingOutput;
  evidenceMap: EvidenceMap;
  sourcePosture: SourcePosture;
  sources: readonly SourceDocument[];
}): CanonicalCandidateGroundingOutput {
  const selected = selectSeedBoundGroundings(input.seeds, input.output, input.evidenceMap);
  const candidateBySeedId = new Map(
    selected.seedBoundCandidates.map(({ seed, candidate }) => [seed.seedId, candidate] as const),
  );
  const rawBySeedId = new Map(
    input.output.groundings.map((grounding) => [grounding.seedId, grounding]),
  );
  const malformedOutput =
    rawBySeedId.size !== input.output.groundings.length || rawBySeedId.size !== input.seeds.length;
  return {
    groundings: input.seeds.map((seed) => {
      if (malformedOutput) return { seedId: seed.seedId, disposition: 'binding-rejected' as const };
      const raw = rawBySeedId.get(seed.seedId);
      if (raw?.candidate === null) return { seedId: seed.seedId, disposition: 'null' as const };
      const candidate = candidateBySeedId.get(seed.seedId);
      if (candidate === undefined) {
        return { seedId: seed.seedId, disposition: 'binding-rejected' as const };
      }
      const verified = verifyModelFindings(
        input.vector,
        [candidate],
        input.sources,
        input.evidenceMap,
        input.sourcePosture,
      ).verified[0];
      return verified === undefined
        ? { seedId: seed.seedId, disposition: 'binding-rejected' as const }
        : { seedId: seed.seedId, disposition: 'grounded' as const, hypothesis: verified };
    }),
  };
}

/** Selects recovery-safe candidates without recreating raw grounding output. */
export function selectCanonicalSeedBoundGroundings(
  seeds: readonly HypothesisSeed[],
  output: CanonicalCandidateGroundingOutput,
): Readonly<{
  candidates: readonly UnverifiedAuditCandidate[];
  submittedCount: number;
  nullCount: number;
  rejectedCount: number;
}> {
  const bySeed = new Map(output.groundings.map((grounding) => [grounding.seedId, grounding]));
  if (bySeed.size !== output.groundings.length || bySeed.size !== seeds.length) {
    return { candidates: [], submittedCount: 0, nullCount: 0, rejectedCount: seeds.length };
  }
  const candidates: UnverifiedAuditCandidate[] = [];
  let nullCount = 0;
  let rejectedCount = 0;
  for (const seed of seeds) {
    const outcome = bySeed.get(seed.seedId);
    if (outcome === undefined || outcome.disposition === 'binding-rejected') {
      rejectedCount += 1;
    } else if (outcome.disposition === 'null') {
      nullCount += 1;
    } else {
      candidates.push(outcome.hypothesis);
    }
  }
  return { candidates, submittedCount: candidates.length, nullCount, rejectedCount };
}

function materializeCandidate(
  seed: HypothesisSeed,
  candidate: UnverifiedGroundedCandidate,
  evidenceMap: EvidenceMap,
): UnverifiedAuditCandidate | undefined {
  if (!preservesSeedBinding(seed, candidate)) return undefined;
  const facts = new Map(evidenceMap.facts.map((fact) => [fact.factId, fact] as const));
  const operation = selectedEvidence(candidate.operationEvidence, candidate, facts, 'operation');
  const unsafeCondition = selectedEvidence(
    candidate.unsafeConditionEvidence,
    candidate,
    facts,
    'unsafe-condition',
  );
  if (operation === undefined || unsafeCondition === undefined) return undefined;
  const {
    operationEvidence: _operationEvidence,
    unsafeConditionEvidence: _unsafeConditionEvidence,
    ...rest
  } = candidate;
  return {
    ...rest,
    sourcePostureAssessmentIds: seed.sourcePostureAssessmentIds,
    evidence: [operation, unsafeCondition],
  };
}

function selectedEvidence(
  selection: UnverifiedGroundedCandidate['operationEvidence'],
  candidate: UnverifiedGroundedCandidate,
  facts: ReadonlyMap<string, EvidenceMap['facts'][number]>,
  role: 'operation' | 'unsafe-condition',
) {
  if (!candidate.evidenceMapFactIds.includes(selection.factId)) return undefined;
  const evidence = facts.get(selection.factId)?.evidence[selection.evidenceIndex];
  return evidence === undefined ? undefined : { ...evidence, role };
}

function preservesSeedBinding(
  seed: HypothesisSeed,
  candidate: UnverifiedGroundedCandidate,
): boolean {
  return (
    candidate.vectorId === seed.vectorId &&
    candidate.planObligations !== undefined &&
    hasExactPlanObligations(candidate.planObligations, seed.planObligations) &&
    hasExactIdentifiers(candidate.evidenceMapFactIds, seed.evidenceMapFactIds)
  );
}

/** Keeps a seed-owned identifier basis single-valued across the grounding boundary. */
function hasExactIdentifiers(actual: readonly string[], expected: readonly string[]): boolean {
  const actualIdentifiers = new Set(actual);
  const expectedIdentifiers = new Set(expected);
  return (
    actualIdentifiers.size === actual.length &&
    expectedIdentifiers.size === expected.length &&
    actualIdentifiers.size === expectedIdentifiers.size &&
    [...actualIdentifiers].every((identifier) => expectedIdentifiers.has(identifier))
  );
}
