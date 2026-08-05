import { z } from 'zod';
import { IdentifierSchema } from '../../../shared/contracts/core.js';
import { PlanObligationReferenceSchema } from '../../attack-planning/plan/index.js';
import {
  type EvidenceMap,
  mappedControlFactIdsForObligation,
  UnverifiedEvidenceMapEvidenceSelectionSchema,
} from '../evidence-map/contract.js';
import type { SourcePosture } from '../source-posture/contract.js';
import type { VerifiableHypothesis } from './contract.js';

const EvidenceSelectionsSchema = z.array(UnverifiedEvidenceMapEvidenceSelectionSchema);

const ObligationEvidenceSelectionBasisSchema = z.strictObject({
  planObligation: PlanObligationReferenceSchema,
  selections: EvidenceSelectionsSchema,
});

const PostureEvidenceSelectionBasisSchema = z.strictObject({
  assessmentId: IdentifierSchema,
  selections: EvidenceSelectionsSchema,
});

/**
 * Source-free selection inventory shared by verifier prompting and canonical
 * materialization. It declares provenance bounds only; it does not assess risk.
 */
export const VerificationEvidenceSelectionBasisSchema = z.strictObject({
  hypothesisSelections: EvidenceSelectionsSchema,
  requiredControlFactIds: z.array(IdentifierSchema),
  controlSelections: EvidenceSelectionsSchema,
  obligationSelections: z.array(ObligationEvidenceSelectionBasisSchema),
  postureSelections: z.array(PostureEvidenceSelectionBasisSchema),
});

export type VerificationEvidenceSelectionBasis = z.infer<
  typeof VerificationEvidenceSelectionBasisSchema
>;

/** Builds the one canonical source-free selection basis for a bounded hypothesis. */
export function createVerificationEvidenceSelectionBasis(input: {
  hypothesis: VerifiableHypothesis;
  evidenceMap: EvidenceMap;
  sourcePosture: SourcePosture;
}): VerificationEvidenceSelectionBasis {
  const factById = new Map(input.evidenceMap.facts.map((fact) => [fact.factId, fact] as const));
  const obligationIds = new Set(
    input.hypothesis.planObligations.map((obligation) => obligation.obligationId),
  );
  const requiredControlFactIds = [...obligationIds]
    .flatMap((obligationId) => mappedControlFactIdsForObligation(input.evidenceMap, obligationId))
    .sort((left, right) => left.localeCompare(right));
  const controlFactIds =
    requiredControlFactIds.length === 0
      ? input.hypothesis.evidenceMapFactIds
      : requiredControlFactIds;
  const relevantPostures = input.sourcePosture.assessments.filter((assessment) =>
    obligationIds.has(assessment.obligationId),
  );
  return VerificationEvidenceSelectionBasisSchema.parse({
    hypothesisSelections: selectionsForFactIds(input.hypothesis.evidenceMapFactIds, factById),
    requiredControlFactIds,
    controlSelections: selectionsForFactIds(controlFactIds, factById),
    obligationSelections: input.hypothesis.planObligations.map((planObligation) => ({
      planObligation,
      selections: selectionsForFactIds(
        input.evidenceMap.facts
          .filter((fact) =>
            fact.planObligations.some(
              (reference) => reference.obligationId === planObligation.obligationId,
            ),
          )
          .map((fact) => fact.factId),
        factById,
      ),
    })),
    postureSelections: relevantPostures.map((assessment) => ({
      assessmentId: assessment.assessmentId,
      selections: selectionsForFactIds(assessment.evidenceMapFactIds, factById),
    })),
  });
}

export function selectionIsInBasis(
  selections: readonly { factId: string; evidenceIndex: number }[],
  selection: { factId: string; evidenceIndex: number },
): boolean {
  return selections.some(
    (candidate) =>
      candidate.factId === selection.factId && candidate.evidenceIndex === selection.evidenceIndex,
  );
}

function selectionsForFactIds(
  factIds: readonly string[],
  facts: ReadonlyMap<string, EvidenceMap['facts'][number]>,
): Array<{ factId: string; evidenceIndex: number }> {
  return factIds.flatMap((factId) =>
    (facts.get(factId)?.evidence ?? []).map((_evidence, evidenceIndex) => ({
      factId,
      evidenceIndex,
    })),
  );
}
