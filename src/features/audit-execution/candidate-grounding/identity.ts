import type { AttackVector, ClaimEvidenceRole } from '../../attack-planning/index.js';
import type { EvidenceMap } from '../evidence-map/contract.js';
import type { HypothesisSeed, UnverifiedAuditCandidate } from '../investigation/contract.js';
import { verifyModelFindings } from '../investigation/verify.js';
import type { SourceEvidenceResolver } from '../source-evidence-resolver.js';
import type { SourcePosture } from '../source-posture/contract.js';
import type { VerifiableHypothesis } from '../verification/contract.js';
import type {
  CandidateGroundingModelCandidate,
  CandidateGroundingOutput,
  CanonicalCandidateGroundingOutput,
} from './contract.js';

/**
 * A model response that passes its transport shape but cannot be bound to the
 * supplied seed/map basis. The stage lifecycle owns conversion to generic
 * retry guidance; this value never crosses a durable boundary.
 */
export class CandidateGroundingProjectionError extends Error {
  readonly schemaPathLabels: readonly string[];

  constructor(schemaPathLabels: readonly string[]) {
    super('Candidate grounding cannot be bound to the supplied evidence basis.');
    this.name = 'CandidateGroundingProjectionError';
    this.schemaPathLabels = schemaPathLabels;
  }
}

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
export async function canonicalizeCandidateGroundingOutput(input: {
  vector: AttackVector;
  seeds: readonly HypothesisSeed[];
  output: CandidateGroundingOutput;
  evidenceMap: EvidenceMap;
  sourcePosture: SourcePosture;
  sourceEvidence: SourceEvidenceResolver;
}): Promise<CanonicalCandidateGroundingOutput> {
  const rawBySeedId = new Map(
    input.output.groundings.map((grounding) => [grounding.seedId, grounding]),
  );
  const expectedSeedIds = new Set(input.seeds.map((seed) => seed.seedId));
  if (
    rawBySeedId.size !== input.output.groundings.length ||
    rawBySeedId.size !== expectedSeedIds.size ||
    [...rawBySeedId.keys()].some((seedId) => !expectedSeedIds.has(seedId))
  ) {
    throw new CandidateGroundingProjectionError(['groundings']);
  }
  const groundings: CanonicalCandidateGroundingOutput['groundings'][number][] = [];
  for (const seed of input.seeds) {
    const raw = rawBySeedId.get(seed.seedId);
    if (raw === undefined) throw new CandidateGroundingProjectionError(['groundings']);
    if (raw.candidate === null) {
      groundings.push({
        seedId: seed.seedId,
        disposition: raw.nullReason,
      });
      continue;
    }
    const candidate = materializeCandidate(seed, raw.candidate, input.evidenceMap);
    if (candidate === undefined)
      throw new CandidateGroundingProjectionError(['groundings', 'claimEvidenceBundles']);
    const verified = (
      await verifyModelFindings(
        input.vector,
        [candidate],
        input.sourceEvidence,
        input.evidenceMap,
        input.sourcePosture,
      )
    ).verified[0];
    if (verified === undefined)
      throw new CandidateGroundingProjectionError(['groundings', 'claimEvidenceBundles']);
    groundings.push({ seedId: seed.seedId, disposition: 'grounded', hypothesis: verified });
  }
  return { groundings };
}

/** Selects recovery-safe candidates without recreating raw grounding output. */
export function selectCanonicalSeedBoundGroundings(
  seeds: readonly HypothesisSeed[],
  output: CanonicalCandidateGroundingOutput,
): Readonly<{
  candidates: readonly VerifiableHypothesis[];
  submittedCount: number;
  nullCount: number;
  rejectedCount: number;
}> {
  const bySeed = new Map(output.groundings.map((grounding) => [grounding.seedId, grounding]));
  if (bySeed.size !== output.groundings.length || bySeed.size !== seeds.length) {
    return { candidates: [], submittedCount: 0, nullCount: 0, rejectedCount: seeds.length };
  }
  const candidates: VerifiableHypothesis[] = [];
  let nullCount = 0;
  let rejectedCount = 0;
  for (const seed of seeds) {
    const outcome = bySeed.get(seed.seedId);
    if (outcome === undefined) {
      rejectedCount += 1;
    } else if (
      outcome.disposition === 'no-source-backed-candidate' ||
      outcome.disposition === 'map-insufficient'
    ) {
      nullCount += 1;
    } else {
      candidates.push(outcome.hypothesis);
    }
  }
  return { candidates, submittedCount: candidates.length, nullCount, rejectedCount };
}

/** Extracts the only reportable candidates from durable per-seed outcomes. */
export function groundedHypotheses(
  output: CanonicalCandidateGroundingOutput,
): readonly VerifiableHypothesis[] {
  return output.groundings.flatMap((outcome) =>
    outcome.disposition === 'grounded' ? [outcome.hypothesis] : [],
  );
}

function materializeCandidate(
  seed: HypothesisSeed,
  candidate: CandidateGroundingModelCandidate,
  evidenceMap: EvidenceMap,
): UnverifiedAuditCandidate | undefined {
  const facts = new Map(evidenceMap.facts.map((fact) => [fact.factId, fact] as const));
  const evidenceMapFactIds = candidateEvidenceMapFactIds(seed, candidate);
  if (!hasSameObligationFactBasis(seed, evidenceMapFactIds, facts)) return undefined;
  const claimEvidenceBundles = candidate.claimEvidenceBundles.map((bundle) => {
    const evidence = bundle.selections.map((selection) =>
      selectedEvidence(selection, facts, bundle.role),
    );
    if (evidence.some((item) => item === undefined)) return undefined;
    return {
      role: bundle.role,
      explanation: bundle.explanation,
      evidence: evidence.filter((item): item is NonNullable<typeof item> => item !== undefined),
    };
  });
  if (claimEvidenceBundles.some((bundle) => bundle === undefined)) return undefined;
  return {
    vectorId: seed.vectorId,
    statement: candidate.statement,
    planObligations: seed.planObligations,
    evidenceMapFactIds,
    limitations: [],
    claimEvidenceSelections: candidate.claimEvidenceBundles.map(({ role, selections }) => ({
      role,
      selections,
    })),
    sourcePostureAssessmentIds: seed.sourcePostureAssessmentIds,
    claimEvidenceBundles: claimEvidenceBundles.filter(
      (bundle): bundle is NonNullable<typeof bundle> => bundle !== undefined,
    ),
  };
}

function selectedEvidence(
  selection: CandidateGroundingModelCandidate['claimEvidenceBundles'][number]['selections'][number],
  facts: ReadonlyMap<string, EvidenceMap['facts'][number]>,
  role: ClaimEvidenceRole,
) {
  const evidence = facts.get(selection.factId)?.evidence[selection.evidenceIndex];
  return evidence === undefined ? undefined : { ...evidence, role };
}

function candidateEvidenceMapFactIds(
  seed: HypothesisSeed,
  candidate: CandidateGroundingModelCandidate,
): string[] {
  return [
    ...new Set([
      ...seed.evidenceMapFactIds,
      ...candidate.claimEvidenceBundles.flatMap((bundle) =>
        bundle.selections.map((selection) => selection.factId),
      ),
    ]),
  ];
}

/** The seed owns provenance; model-added selections may only extend it within an approved obligation. */
function hasSameObligationFactBasis(
  seed: HypothesisSeed,
  evidenceMapFactIds: readonly string[],
  facts: ReadonlyMap<string, EvidenceMap['facts'][number]>,
): boolean {
  const obligationIds = new Set(seed.planObligations.map((obligation) => obligation.obligationId));
  return (
    seed.evidenceMapFactIds.every((identifier) => evidenceMapFactIds.includes(identifier)) &&
    evidenceMapFactIds.every((identifier) => {
      const fact = facts.get(identifier);
      return fact?.planObligations.some((obligation) => obligationIds.has(obligation.obligationId));
    })
  );
}
