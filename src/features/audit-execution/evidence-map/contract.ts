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
import { AuditNarrativeTextSchema } from '../narrative/contract.js';

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

/**
 * A source-free request from a later semantic phase for additional neutral
 * evidence. These values describe missing evidence roles only; they are never
 * a vulnerability conclusion, location hint, or language-specific rule.
 */
export const EvidenceMapGapKindSchema = z.enum([
  'operation-evidence-missing',
  'unsafe-condition-relation-missing',
  'control-coverage-missing',
  'source-relation-unresolved',
]);

/** Durable source-free signals derived from untrusted mapper prose. */
export const EvidenceMapLimitationCodeSchema = z.enum(['model-declared-limitation']);

function requireUniqueValues(values: readonly string[], context: z.RefinementCtx): void {
  if (new Set(values).size === values.length) return;
  context.addIssue({
    code: 'custom',
    message: 'Values must be unique.',
  });
}

/** Strict, candidate-blind repair signal bound later to approved obligations. */
export const EvidenceMapInsufficiencySchema = z.strictObject({
  obligationIds: z.array(IdentifierSchema).min(1).superRefine(requireUniqueValues),
  needs: z.array(EvidenceMapGapKindSchema).min(1).superRefine(requireUniqueValues),
});

export const EvidenceMapInsufficienciesSchema = z
  .array(EvidenceMapInsufficiencySchema)
  .superRefine((insufficiencies, context) => {
    const signatures = insufficiencies.map((insufficiency) =>
      JSON.stringify([
        [...insufficiency.obligationIds].sort((left, right) => left.localeCompare(right)),
        [...insufficiency.needs].sort((left, right) => left.localeCompare(right)),
      ]),
    );
    if (new Set(signatures).size === signatures.length) return;
    context.addIssue({
      code: 'custom',
      message: 'Evidence-map insufficiency signals must not duplicate a gap signature.',
    });
  });

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
 * line range, kind, and content digest are projected only after the map
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
  /** Validated/redacted semantic context for later model stages, never evidence itself. */
  summary: AuditNarrativeTextSchema.optional(),
  evidence: z.array(EvidenceMapSourceEvidenceSchema).min(1),
  planObligations: PlanObligationReferencesSchema,
});

/** Closed model-stage shape. Invalid facts are filtered by verifyEvidenceMap before persistence. */
export const UnverifiedEvidenceMapFactSchema = z.strictObject({
  factId: IdentifierSchema,
  role: EvidenceMapFactRoleSchema,
  /** Normal model output has prose; a recovered canonical leaf deliberately does not. */
  statement: BoundedTextSchema.min(1).optional(),
  evidence: z.array(UnverifiedEvidenceMapSourceEvidenceSchema),
  planObligations: z.array(UnverifiedPlanObligationReferenceSchema),
});

/**
 * Mapper-owned append-only repair output. It cannot replace existing facts,
 * declare coverage, or receive a later-stage conclusion.
 */
export const UnverifiedEvidenceMapRepairSchema = z
  .strictObject({
    facts: z.array(UnverifiedEvidenceMapFactSchema),
  })
  .superRefine((value, context) => {
    const factIds = value.facts.map((fact) => fact.factId);
    if (new Set(factIds).size === factIds.length) return;
    context.addIssue({
      code: 'custom',
      path: ['facts'],
      message: 'Evidence-map repair facts must have unique identifiers.',
    });
  });

const UnansweredPlanObligationsField = {
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
};

export const UnverifiedEvidenceMapSchema = z
  .strictObject({
    facts: z.array(UnverifiedEvidenceMapFactSchema),
    controlCoverage: z.array(UnverifiedEvidenceMapControlCoverageSchema),
    ...UnansweredPlanObligationsField,
    limitations: z.array(BoundedTextSchema.min(1)),
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
    ...UnansweredPlanObligationsField,
    limitations: z.array(EvidenceMapLimitationCodeSchema),
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
export type EvidenceMapInsufficiency = z.infer<typeof EvidenceMapInsufficiencySchema>;
export type EvidenceMapInsufficiencies = z.infer<typeof EvidenceMapInsufficienciesSchema>;
export type UnverifiedEvidenceMap = z.infer<typeof UnverifiedEvidenceMapSchema>;
export type UnverifiedEvidenceMapRepair = z.infer<typeof UnverifiedEvidenceMapRepairSchema>;

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
