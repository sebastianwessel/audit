import { BoundedTextSchema } from '../../../shared/contracts/core.js';
import {
  type AttackVector,
  hasApprovedPlanObligations,
  planObligationKey,
} from '../../attack-planning/plan/index.js';
import type { SourceEvidenceResolver } from '../source-evidence-resolver.js';
import {
  type EvidenceMap,
  EvidenceMapFactRoleSchema,
  EvidenceMapSchema,
  mappedControlFactIdsForObligation,
  type UnverifiedEvidenceMap,
} from './contract.js';

export type EvidenceMapVerificationResult = Readonly<{
  evidenceMap: EvidenceMap;
  rejectedFactCount: number;
  complete: boolean;
}>;

/**
 * Validates one lossless recovery fragment without requiring it to represent
 * the complete vector. The caller must still run {@link verifyEvidenceMap}
 * after all fragments are reduced before allowing the audit to continue.
 */
export async function verifyEvidenceMapFragment(
  vector: AttackVector,
  evidenceMap: UnverifiedEvidenceMap | EvidenceMap,
  sourceEvidence: SourceEvidenceResolver,
): Promise<Readonly<{ evidenceMap: EvidenceMap; rejectedFactCount: number }>> {
  const retainedFactIds = new Set<string>();
  const facts: Array<EvidenceMap['facts'][number]> = [];
  for (const fact of evidenceMap.facts) {
    const role = EvidenceMapFactRoleSchema.safeParse(fact.role);
    const statementIsValid =
      !('statement' in fact) || BoundedTextSchema.min(1).safeParse(fact.statement).success;
    if (!role.success || !statementIsValid || retainedFactIds.has(fact.factId)) continue;
    if (!hasApprovedPlanObligations(vector, fact.planObligations)) continue;
    const evidence = [];
    for (const item of fact.evidence) {
      const reference = await sourceEvidence.resolve(item);
      if (reference === undefined) break;
      evidence.push(reference);
    }
    if (evidence.length !== fact.evidence.length) continue;
    retainedFactIds.add(fact.factId);
    const summary =
      'statement' in fact ? fact.statement : 'summary' in fact ? fact.summary : undefined;
    facts.push({
      factId: fact.factId,
      role: role.data,
      ...(summary === undefined ? {} : { summary }),
      evidence,
      planObligations: fact.planObligations,
    });
  }
  const mappedObligationKeys = new Set(
    facts.flatMap((fact) => fact.planObligations.map(planObligationKey)),
  );
  return Object.freeze({
    evidenceMap: EvidenceMapSchema.parse({
      facts,
      unansweredPlanObligations: evidenceMap.unansweredPlanObligations.filter(
        (reference) =>
          hasApprovedPlanObligations(vector, [reference]) &&
          !mappedObligationKeys.has(planObligationKey(reference)),
      ),
      limitations:
        'controlCoverage' in evidenceMap
          ? evidenceMap.limitations.length > 0
            ? ['model-declared-limitation']
            : []
          : evidenceMap.limitations,
    }),
    rejectedFactCount: evidenceMap.facts.length - facts.length,
  });
}

/**
 * Checks only source-location and plan-binding integrity. It deliberately does
 * not determine whether a fact is security-relevant or whether a control works.
 */
export async function verifyEvidenceMap(
  vector: AttackVector,
  evidenceMap: UnverifiedEvidenceMap | EvidenceMap,
  sourceEvidence: SourceEvidenceResolver,
): Promise<EvidenceMapVerificationResult> {
  const fragment = await verifyEvidenceMapFragment(vector, evidenceMap, sourceEvidence);
  return completeEvidenceMapVerification(vector, evidenceMap, fragment);
}

function completeEvidenceMapVerification(
  vector: AttackVector,
  evidenceMap: UnverifiedEvidenceMap | EvidenceMap,
  fragment: Readonly<{ evidenceMap: EvidenceMap; rejectedFactCount: number }>,
): EvidenceMapVerificationResult {
  const verified = fragment.evidenceMap;
  const representedObligations = new Set([
    ...verified.facts.flatMap((fact) => fact.planObligations.map(planObligationKey)),
    ...verified.unansweredPlanObligations.map(planObligationKey),
  ]);
  const declaredControlCoverage =
    'controlCoverage' in evidenceMap
      ? evidenceMap.controlCoverage
      : vector.reviewObligations.map((obligation) => ({
          obligationId: obligation.obligationId,
          controlFactIds: mappedControlFactIdsForObligation(verified, obligation.obligationId),
        }));
  const completeControlCoverage = vector.reviewObligations.every((obligation) => {
    const declared = declaredControlCoverage.filter(
      (coverage) => coverage.obligationId === obligation.obligationId,
    );
    if (declared.length !== 1) return false;
    const expected = mappedControlFactIdsForObligation(verified, obligation.obligationId);
    const actual = [...new Set(declared[0]?.controlFactIds ?? [])].sort((left, right) =>
      left.localeCompare(right),
    );
    return (
      expected.length === actual.length &&
      expected.every((factId, index) => factId === actual[index])
    );
  });
  return Object.freeze({
    evidenceMap: verified,
    rejectedFactCount: fragment.rejectedFactCount,
    complete:
      completeControlCoverage &&
      vector.reviewObligations.every((obligation) =>
        representedObligations.has(planObligationKey({ obligationId: obligation.obligationId })),
      ),
  });
}
