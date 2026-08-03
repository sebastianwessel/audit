import { z } from 'zod';

import {
  BoundedTextSchema,
  IdentifierSchema,
  modelTokenSchema,
} from '../../../shared/contracts/core.js';
import {
  PlanObligationReferenceSchema,
  PlanObligationReferencesSchema,
  SourceEvidenceSchema,
} from '../../attack-planning/plan.schema.js';

export const EvidenceMapFactRoleSchema = modelTokenSchema(
  z.enum([
    'entrypoint',
    'input',
    'asset',
    'boundary',
    'operation',
    'control',
    'output',
    'assumption',
  ]),
);

function requireUniqueFactReferences(factIds: readonly string[], context: z.RefinementCtx): void {
  if (new Set(factIds).size === factIds.length) return;
  context.addIssue({
    code: 'custom',
    message: 'Evidence-map fact references must be unique.',
  });
}

/** Canonical fact-reference collection for every downstream map-bound phase. */
export const EvidenceMapFactIdsSchema = z
  .array(IdentifierSchema)
  .min(1)
  .superRefine(requireUniqueFactReferences);

/** Model-bound form weakens only identifier normalization before integrity admission. */
export const UnverifiedEvidenceMapFactIdSchema = z.string().trim().min(1).max(160);

/** A model chooses existing neutral-map evidence without authoring a source location. */
export const UnverifiedEvidenceMapEvidenceSelectionSchema = z.strictObject({
  factId: UnverifiedEvidenceMapFactIdSchema,
  evidenceIndex: z.number().int().nonnegative(),
});

/** Model-bound fact-reference collection for downstream pre-admission stages. */
export const UnverifiedEvidenceMapFactIdsSchema = z
  .array(UnverifiedEvidenceMapFactIdSchema)
  .min(1)
  .superRefine(requireUniqueFactReferences);

export const EvidenceMapSourceEvidenceSchema = SourceEvidenceSchema.extend({
  kind: modelTokenSchema(z.enum(['source', 'configuration', 'context', 'inventory'])),
});

/**
 * Closed model-facing source selection. Canonical evidence identity,
 * line range, kind, and redacted snippet are projected only after the map
 * verifier confirms this selection against its scoped source view.
 */
const UnverifiedEvidenceMapSourceEvidenceSchema = z.strictObject({
  path: z.string().min(1),
  startLine: z.number().int(),
});

/**
 * A model may make a bad local reference. The verifier quarantines that fact
 * instead of letting it invalidate unrelated canonical facts in the same map.
 */
const UnverifiedPlanObligationReferenceSchema = z.strictObject({
  obligationId: z.string().trim().min(1).max(160),
});

/**
 * A mapper's explicit, source-free inventory of the neutral control facts it
 * associated with one approved obligation. It records provenance coverage,
 * never whether a control is effective.
 */
export const UnverifiedEvidenceMapControlCoverageSchema = z.strictObject({
  obligationId: UnverifiedPlanObligationReferenceSchema.shape.obligationId,
  controlFactIds: z.array(UnverifiedEvidenceMapFactIdSchema),
});

/**
 * A source-backed fact prepared before an investigator is allowed to form a
 * security hypothesis. Roles organize review evidence; they are never rules.
 */
export const EvidenceMapFactSchema = z.strictObject({
  factId: IdentifierSchema,
  role: EvidenceMapFactRoleSchema,
  statement: BoundedTextSchema.min(1),
  evidence: z.array(EvidenceMapSourceEvidenceSchema).min(1),
  planObligations: PlanObligationReferencesSchema,
});

/** Closed model-stage shape. Invalid facts are filtered by verifyEvidenceMap before persistence. */
export const UnverifiedEvidenceMapFactSchema = z.strictObject({
  factId: IdentifierSchema,
  role: EvidenceMapFactRoleSchema,
  statement: BoundedTextSchema.min(1),
  evidence: z.array(UnverifiedEvidenceMapSourceEvidenceSchema),
  planObligations: z.array(UnverifiedPlanObligationReferenceSchema),
});

const EvidenceMapEnvelopeFields = {
  unansweredPlanObligations: z
    .array(PlanObligationReferenceSchema)
    .superRefine((references, context) => {
      const obligationIds = references.map((reference) => reference.obligationId);
      if (new Set(obligationIds).size !== obligationIds.length) {
        context.addIssue({
          code: 'custom',
          message: 'Unanswered plan obligations must be unique.',
        });
      }
    }),
  limitations: z.array(BoundedTextSchema.min(1)),
};

export const UnverifiedEvidenceMapSchema = z
  .strictObject({
    facts: z.array(UnverifiedEvidenceMapFactSchema),
    controlCoverage: z.array(UnverifiedEvidenceMapControlCoverageSchema),
    ...EvidenceMapEnvelopeFields,
  })
  .superRefine((value, context) => {
    const obligationIds = value.controlCoverage.map((coverage) => coverage.obligationId);
    if (new Set(obligationIds).size !== obligationIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['controlCoverage'],
        message: 'Control coverage must contain at most one entry per plan obligation.',
      });
    }
    for (const [index, coverage] of value.controlCoverage.entries()) {
      if (new Set(coverage.controlFactIds).size !== coverage.controlFactIds.length) {
        context.addIssue({
          code: 'custom',
          path: ['controlCoverage', index, 'controlFactIds'],
          message: 'Control coverage fact identifiers must be unique.',
        });
      }
    }
  });

export const EvidenceMapSchema = z
  .strictObject({
    facts: z.array(EvidenceMapFactSchema),
    ...EvidenceMapEnvelopeFields,
  })
  .superRefine((value, context) => {
    const identifiers = value.facts.map((fact) => fact.factId);
    if (new Set(identifiers).size !== identifiers.length) {
      context.addIssue({
        code: 'custom',
        path: ['facts'],
        message: 'Evidence-map fact identifiers must be unique.',
      });
    }
    const mappedObligationIds = new Set(
      value.facts.flatMap((fact) =>
        fact.planObligations.map((reference) => reference.obligationId),
      ),
    );
    for (const [index, reference] of value.unansweredPlanObligations.entries()) {
      if (!mappedObligationIds.has(reference.obligationId)) continue;
      context.addIssue({
        code: 'custom',
        path: ['unansweredPlanObligations', index],
        message: 'A mapped plan obligation cannot also be unanswered.',
      });
    }
  });

export type EvidenceMap = z.infer<typeof EvidenceMapSchema>;
export type EvidenceMapFact = z.infer<typeof EvidenceMapFactSchema>;
export type EvidenceMapFactIds = z.infer<typeof EvidenceMapFactIdsSchema>;
export type UnverifiedEvidenceMap = z.infer<typeof UnverifiedEvidenceMapSchema>;

/**
 * The sole structural projection of map-labelled controls for an obligation.
 * It does not infer a control from source text or determine effectiveness.
 */
export function mappedControlFactIdsForObligation(
  evidenceMap: EvidenceMap,
  obligationId: string,
): string[] {
  return evidenceMap.facts
    .filter(
      (fact) =>
        fact.role === 'control' &&
        fact.planObligations.some((reference) => reference.obligationId === obligationId),
    )
    .map((fact) => fact.factId)
    .sort((left, right) => left.localeCompare(right));
}
