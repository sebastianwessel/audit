import { z } from 'zod';
import { ClaimEvidenceRoleSchema } from '../../src/features/attack-planning/index.js';
import {
  IdentifierSchema,
  RelativePathSchema,
  Sha256Schema,
} from '../../src/shared/contracts/core.js';
import { CorpusVariantSchema, PlanEvaluationProfileSchema } from './corpus.schema.js';
import { StageIsolatedEvaluationStageSchema } from './stage-isolated.schema.js';

export const StageIsolatedDiagnosticFailureClassSchema = z.enum([
  'evidence-mapping',
  'candidate-grounding',
  'verification',
  'planning-speculation',
]);

const StageIsolatedDiagnosticEvidenceAnchorSchema = z.strictObject({
  role: ClaimEvidenceRoleSchema,
  path: RelativePathSchema,
  startLine: z.int().positive(),
});

const StageIsolatedDiagnosticCanonicalPredecessorSchema = z
  .strictObject({
    vectorIndex: z.int().nonnegative(),
    evidenceAnchors: z.array(StageIsolatedDiagnosticEvidenceAnchorSchema).max(2),
  })
  .superRefine((fixture, context) => {
    const roles = fixture.evidenceAnchors.map((anchor) => anchor.role);
    if (new Set(roles).size !== roles.length) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceAnchors'],
        message: 'Canonical predecessor evidence anchors must have distinct roles.',
      });
    }
  });

export const StageIsolatedDiagnosticPackDescriptorSchema = z
  .strictObject({
    diagnosticId: IdentifierSchema,
    failureClass: StageIsolatedDiagnosticFailureClassSchema,
    diagnosticQuestion: z.string().trim().min(1).max(600),
    qualification: z.literal('diagnostic'),
    semanticPackPath: z.string().trim().min(1).max(256),
    corpusRoot: z.string().trim().min(1).max(256),
    corpusPackId: IdentifierSchema,
    corpusPackVersion: z.string().trim().min(1).max(32),
    corpusManifestFingerprint: Sha256Schema,
    caseId: IdentifierSchema,
    variant: CorpusVariantSchema,
    corpusSourceDigest: Sha256Schema,
    targetFingerprint: Sha256Schema,
    stage: StageIsolatedEvaluationStageSchema,
    planProfile: PlanEvaluationProfileSchema,
    canonicalPredecessor: StageIsolatedDiagnosticCanonicalPredecessorSchema,
  })
  .superRefine((descriptor, context) => {
    const evidenceRequired =
      descriptor.stage === 'investigation-grounding' || descriptor.stage === 'verification';
    const expectedRoles = ClaimEvidenceRoleSchema.options;
    const roles = descriptor.canonicalPredecessor.evidenceAnchors.map((anchor) => anchor.role);
    if (
      evidenceRequired &&
      (roles.length !== expectedRoles.length ||
        !expectedRoles.every((role) => roles.includes(role as (typeof roles)[number])))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['canonicalPredecessor', 'evidenceAnchors'],
        message:
          'Grounding and verification predecessors require one operation and one unsafe-condition anchor.',
      });
    }
    if (!evidenceRequired && roles.length !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['canonicalPredecessor', 'evidenceAnchors'],
        message: 'Planning and evidence-mapping predecessors must not carry later-stage anchors.',
      });
    }
  });

export const StageIsolatedDiagnosticPackRegistrySchema = z
  .strictObject({
    schemaVersion: z.literal(2),
    qualification: z.literal('diagnostic'),
    packs: z.array(StageIsolatedDiagnosticPackDescriptorSchema).length(4),
  })
  .superRefine((registry, context) => {
    const ids = registry.packs.map((entry) => entry.diagnosticId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        path: ['packs'],
        message: 'Diagnostic pack identifiers must be unique.',
      });
    }
  });

export type StageIsolatedDiagnosticPackDescriptor = z.infer<
  typeof StageIsolatedDiagnosticPackDescriptorSchema
>;
export type StageIsolatedDiagnosticPackRegistry = z.infer<
  typeof StageIsolatedDiagnosticPackRegistrySchema
>;
