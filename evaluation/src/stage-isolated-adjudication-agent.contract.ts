import { z } from 'zod';

import {
  canonicalJson,
  IdentifierSchema,
  modelTokenSchema,
  Sha256Schema,
  sha256,
} from '../../src/shared/contracts/core.js';
import { AuditRuntimeError } from '../../src/shared/errors/audit-runtime-error.js';

import { ExpectedFindingEvidenceRoleSchema } from './corpus.schema.js';
import { StageIsolatedEvaluationStageSchema } from './stage-isolated.schema.js';

const uniqueIdentifiers = (identifiers: readonly string[]): boolean =>
  new Set(identifiers).size === identifiers.length;

/**
 * One evaluator-private expected outcome. These statements describe review
 * intent, never source excerpts, paths, answer-key labels, or remediation.
 */
export const StageIsolatedExpectedOutcomeRubricEntrySchema = z
  .strictObject({
    expectedOutcomeId: IdentifierSchema,
    objective: z.string().trim().min(1),
    requiredRiskCondition: z.string().trim().min(1),
    evidenceRequirements: z.array(z.string().trim().min(1)).min(1),
    requiredRoles: z.array(ExpectedFindingEvidenceRoleSchema),
  })
  .superRefine((entry, context) => {
    if (!uniqueIdentifiers(entry.requiredRoles)) {
      context.addIssue({
        code: 'custom',
        path: ['requiredRoles'],
        message: 'An expected outcome rubric cannot require the same role twice.',
      });
    }
  });

/**
 * Evaluator-private rubric for one production stage. It has no source,
 * locations, expected-finding prose, priority, remediation, or answer-key
 * fields. The rubric is never mounted in a product model session.
 */
export const StageIsolatedExpectedOutcomeRubricSchema = z
  .strictObject({
    rubricId: IdentifierSchema,
    rubricFingerprint: Sha256Schema,
    stage: StageIsolatedEvaluationStageSchema,
    expectedOutcomes: z.array(StageIsolatedExpectedOutcomeRubricEntrySchema),
  })
  .superRefine((rubric, context) => {
    const identifiers = rubric.expectedOutcomes.map((outcome) => outcome.expectedOutcomeId);
    if (!uniqueIdentifiers(identifiers)) {
      context.addIssue({
        code: 'custom',
        path: ['expectedOutcomes'],
        message: 'An expected outcome rubric must contain each outcome identity once.',
      });
    }
    if (rubric.rubricFingerprint !== stageIsolatedRubricFingerprint(rubric)) {
      context.addIssue({
        code: 'custom',
        path: ['rubricFingerprint'],
        message: 'The rubric fingerprint must bind its exact source-free rubric content.',
      });
    }
  });

/** Produces the one deterministic binding for a source-free evaluator rubric. */
export function stageIsolatedRubricFingerprint(
  rubric: Omit<z.input<typeof StageIsolatedExpectedOutcomeRubricSchema>, 'rubricFingerprint'>,
): string {
  return sha256(
    canonicalJson({
      rubricId: rubric.rubricId,
      stage: rubric.stage,
      expectedOutcomes: rubric.expectedOutcomes,
    }),
  );
}

/** A source-free semantic claim from one validated product-stage output, held only in memory. */
export const StageIsolatedProductStageOutputEntrySchema = z.strictObject({
  productOutputId: IdentifierSchema,
  semanticClaim: z.string().trim().min(1),
});

/**
 * A role localization reference intentionally contains identifiers only. The
 * source path, line range, snippet, and repository-tool data remain outside
 * the evaluator-agent contract.
 */
export const StageIsolatedProductStageRoleLocalizationSchema = z.strictObject({
  localizationId: IdentifierSchema,
  productOutputId: IdentifierSchema,
  role: ExpectedFindingEvidenceRoleSchema,
});

/**
 * The unpersisted product projection made available to the isolated evaluator.
 * Claims are derived from validated structured fields; source/tool/prompt/raw
 * output content is deliberately absent and this object is never persisted.
 */
export const StageIsolatedProductStageOutputSchema = z
  .strictObject({
    stage: StageIsolatedEvaluationStageSchema,
    stageResultId: IdentifierSchema,
    stageResultFingerprint: Sha256Schema,
    outputs: z.array(StageIsolatedProductStageOutputEntrySchema),
    roleLocalizations: z.array(StageIsolatedProductStageRoleLocalizationSchema),
  })
  .superRefine((result, context) => {
    const outputIds = result.outputs.map((output) => output.productOutputId);
    const localizationIds = result.roleLocalizations.map(
      (localization) => localization.localizationId,
    );
    if (!uniqueIdentifiers(outputIds)) {
      context.addIssue({
        code: 'custom',
        path: ['outputs'],
        message: 'A product-stage output identity may occur only once.',
      });
    }
    if (!uniqueIdentifiers(localizationIds)) {
      context.addIssue({
        code: 'custom',
        path: ['roleLocalizations'],
        message: 'A product-stage localization identity may occur only once.',
      });
    }
    for (const [index, localization] of result.roleLocalizations.entries()) {
      if (!outputIds.includes(localization.productOutputId)) {
        context.addIssue({
          code: 'custom',
          path: ['roleLocalizations', index, 'productOutputId'],
          message: 'A role localization must reference a declared product-stage output.',
        });
      }
    }
    if (result.stageResultFingerprint !== stageIsolatedProductOutputFingerprint(result)) {
      context.addIssue({
        code: 'custom',
        path: ['stageResultFingerprint'],
        message:
          'The product projection fingerprint must bind its exact source-free output content.',
      });
    }
  });

/** Produces the one deterministic binding for a source-free product-stage projection. */
export function stageIsolatedProductOutputFingerprint(
  result: Omit<z.input<typeof StageIsolatedProductStageOutputSchema>, 'stageResultFingerprint'>,
): string {
  return sha256(
    canonicalJson({
      stage: result.stage,
      stageResultId: result.stageResultId,
      outputs: result.outputs,
      roleLocalizations: result.roleLocalizations,
    }),
  );
}

/**
 * No-tools evaluator input. The product projection is in-memory only and the
 * expectation rubric remains evaluator-private; neither may be passed back to
 * a production workflow or persisted in an evaluation artifact.
 */
export const StageIsolatedAdjudicationModelInputSchema = z
  .strictObject({
    expectedOutcomeRubric: StageIsolatedExpectedOutcomeRubricSchema,
    productStageOutput: StageIsolatedProductStageOutputSchema,
  })
  .superRefine((input, context) => {
    if (input.expectedOutcomeRubric.stage !== input.productStageOutput.stage) {
      context.addIssue({
        code: 'custom',
        path: ['productStageOutput', 'stage'],
        message: 'The product-stage output must identify the rubric stage exactly.',
      });
    }
  });

export const StageIsolatedAdjudicationDispositionSchema = modelTokenSchema(
  z.enum(['matched', 'missing', 'not-applicable']),
);

export const StageIsolatedAdjudicationRoleLocalizationReferenceSchema = z
  .strictObject({
    role: modelTokenSchema(ExpectedFindingEvidenceRoleSchema),
    localizationIds: z.array(IdentifierSchema),
  })
  .superRefine((reference, context) => {
    if (!uniqueIdentifiers(reference.localizationIds)) {
      context.addIssue({
        code: 'custom',
        path: ['localizationIds'],
        message: 'A role-localization reference may contain each localization once.',
      });
    }
  });

/** Exactly one evaluator disposition for one evaluator-private expected outcome. */
export const StageIsolatedAdjudicationExpectedOutcomeMappingSchema = z
  .strictObject({
    expectedOutcomeId: IdentifierSchema,
    disposition: StageIsolatedAdjudicationDispositionSchema,
    productOutputIds: z.array(IdentifierSchema),
    roleLocalizations: z.array(StageIsolatedAdjudicationRoleLocalizationReferenceSchema),
  })
  .superRefine((mapping, context) => {
    if (!uniqueIdentifiers(mapping.productOutputIds)) {
      context.addIssue({
        code: 'custom',
        path: ['productOutputIds'],
        message: 'An expected outcome mapping may reference each product output once.',
      });
    }
    const roles = mapping.roleLocalizations.map((reference) => reference.role);
    if (!uniqueIdentifiers(roles)) {
      context.addIssue({
        code: 'custom',
        path: ['roleLocalizations'],
        message: 'An expected outcome mapping may contain each role once.',
      });
    }
    if (
      (mapping.disposition === 'matched' && mapping.productOutputIds.length === 0) ||
      (mapping.disposition !== 'matched' &&
        (mapping.productOutputIds.length > 0 || mapping.roleLocalizations.length > 0))
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Only a matched expected outcome may reference product outputs or role localizations.',
      });
    }
  });

/**
 * Strict no-tools model output. It cannot carry a narrative, source content,
 * tool interaction, priority, fix, or product-admission conclusion.
 */
export const StageIsolatedAdjudicationModelOutputSchema = z
  .strictObject({
    expectedOutcomes: z.array(StageIsolatedAdjudicationExpectedOutcomeMappingSchema),
    unexpectedProductOutputIds: z.array(IdentifierSchema),
  })
  .superRefine((output, context) => {
    const expectedOutcomeIds = output.expectedOutcomes.map((mapping) => mapping.expectedOutcomeId);
    if (!uniqueIdentifiers(expectedOutcomeIds)) {
      context.addIssue({
        code: 'custom',
        path: ['expectedOutcomes'],
        message: 'The evaluator must return one mapping for each expected outcome identity.',
      });
    }
    if (!uniqueIdentifiers(output.unexpectedProductOutputIds)) {
      context.addIssue({
        code: 'custom',
        path: ['unexpectedProductOutputIds'],
        message: 'An unexpected product output identity may occur only once.',
      });
    }
  });

export type StageIsolatedExpectedOutcomeRubricEntry = z.infer<
  typeof StageIsolatedExpectedOutcomeRubricEntrySchema
>;
export type StageIsolatedExpectedOutcomeRubric = z.infer<
  typeof StageIsolatedExpectedOutcomeRubricSchema
>;
export type StageIsolatedProductStageOutputEntry = z.infer<
  typeof StageIsolatedProductStageOutputEntrySchema
>;
export type StageIsolatedProductStageRoleLocalization = z.infer<
  typeof StageIsolatedProductStageRoleLocalizationSchema
>;
export type StageIsolatedProductStageOutput = z.infer<typeof StageIsolatedProductStageOutputSchema>;
export type StageIsolatedAdjudicationModelInput = z.infer<
  typeof StageIsolatedAdjudicationModelInputSchema
>;
export type StageIsolatedAdjudicationDisposition = z.infer<
  typeof StageIsolatedAdjudicationDispositionSchema
>;
export type StageIsolatedAdjudicationRoleLocalizationReference = z.infer<
  typeof StageIsolatedAdjudicationRoleLocalizationReferenceSchema
>;
export type StageIsolatedAdjudicationExpectedOutcomeMapping = z.infer<
  typeof StageIsolatedAdjudicationExpectedOutcomeMappingSchema
>;
export type StageIsolatedAdjudicationModelOutput = z.infer<
  typeof StageIsolatedAdjudicationModelOutputSchema
>;

/**
 * Closes a no-tools evaluator response against the exact in-memory product
 * output and evaluator-private rubric. It is deliberately structural: it
 * cannot make a product security, classification, urgency, or admission
 * decision.
 */
export function validateStageIsolatedAdjudicationResponse(input: {
  request: StageIsolatedAdjudicationModelInput;
  response: StageIsolatedAdjudicationModelOutput;
}): StageIsolatedAdjudicationModelOutput {
  const request = StageIsolatedAdjudicationModelInputSchema.parse(input.request);
  const response = StageIsolatedAdjudicationModelOutputSchema.parse(input.response);
  const expectedById = new Map(
    request.expectedOutcomeRubric.expectedOutcomes.map((outcome) => [
      outcome.expectedOutcomeId,
      outcome,
    ]),
  );
  const outputsById = new Map(
    request.productStageOutput.outputs.map((output) => [output.productOutputId, output]),
  );
  const localizationsById = new Map(
    request.productStageOutput.roleLocalizations.map((localization) => [
      localization.localizationId,
      localization,
    ]),
  );

  assertExactIdentityClosure(
    response.expectedOutcomes.map((mapping) => mapping.expectedOutcomeId),
    expectedById,
    'expected outcome',
  );

  const referencedOutputIds = new Set<string>();
  const referencedLocalizationIds = new Set<string>();
  for (const mapping of response.expectedOutcomes) {
    const expected = expectedById.get(mapping.expectedOutcomeId);
    if (expected === undefined) {
      throw invalidAdjudication('The evaluator referenced an unknown expected outcome.');
    }
    const expectedRoles = new Set(expected.requiredRoles);
    const mappedRoles = mapping.roleLocalizations.map((reference) => reference.role);
    if (mapping.disposition === 'matched') {
      assertExactIdentityClosure(mappedRoles, expectedRoles, 'required role');
    }
    for (const productOutputId of mapping.productOutputIds) {
      if (!outputsById.has(productOutputId) || referencedOutputIds.has(productOutputId)) {
        throw invalidAdjudication(
          'A product-stage output must be known and map to at most one expected outcome.',
        );
      }
      referencedOutputIds.add(productOutputId);
    }
    for (const reference of mapping.roleLocalizations) {
      for (const localizationId of reference.localizationIds) {
        const localization = localizationsById.get(localizationId);
        if (
          localization === undefined ||
          localization.role !== reference.role ||
          !mapping.productOutputIds.includes(localization.productOutputId) ||
          referencedLocalizationIds.has(localizationId)
        ) {
          throw invalidAdjudication(
            'A role localization must be known, role-consistent, uniquely selected, and belong to its mapped product output.',
          );
        }
        referencedLocalizationIds.add(localizationId);
      }
    }
  }

  const unexpectedIds = new Set(response.unexpectedProductOutputIds);
  for (const outputId of unexpectedIds) {
    if (!outputsById.has(outputId) || referencedOutputIds.has(outputId)) {
      throw invalidAdjudication(
        'Unexpected product outputs must be known and disjoint from expected-outcome mappings.',
      );
    }
  }
  const closedOutputIds = new Set([...referencedOutputIds, ...unexpectedIds]);
  assertExactIdentityClosure([...closedOutputIds], outputsById, 'product-stage output');
  return response;
}

function assertExactIdentityClosure<T>(
  actual: readonly string[],
  expected: ReadonlyMap<string, T> | ReadonlySet<string>,
  label: string,
): void {
  const expectedIds = expected instanceof Map ? new Set(expected.keys()) : expected;
  if (
    actual.length !== expectedIds.size ||
    !uniqueIdentifiers(actual) ||
    actual.some((identifier) => !expectedIds.has(identifier))
  ) {
    throw invalidAdjudication(
      `Stage-isolated adjudication must close every ${label} exactly once.`,
    );
  }
}

function invalidAdjudication(message: string): AuditRuntimeError {
  return new AuditRuntimeError('artifact-invalid', message);
}
