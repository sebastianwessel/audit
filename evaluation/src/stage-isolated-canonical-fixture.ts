import type { AttackVector } from '../../src/features/attack-planning/index.js';
import { createPlan } from '../../src/features/attack-planning/index.js';
import type { SourceDocument } from '../../src/features/audit-execution/audit.schema.js';
import { CandidateGroundingRequestSchema } from '../../src/features/audit-execution/candidate-grounding/contract.js';
import { EvidenceMapSchema } from '../../src/features/audit-execution/evidence-map/contract.js';
import { createSourceEvidenceReference } from '../../src/features/audit-execution/evidence-reference.js';
import { HypothesisSeedSchema } from '../../src/features/audit-execution/investigation/contract.js';
import { selectScopedSources } from '../../src/features/audit-execution/investigation/scope.js';
import { AuditInvestigationRequestSchema } from '../../src/features/audit-execution/phase-input/contract.js';
import { SourcePostureSchema } from '../../src/features/audit-execution/source-posture/contract.js';
import { VerifiableHypothesisSchema } from '../../src/features/audit-execution/verification/contract.js';
import { captureTargetInventory } from '../../src/features/target-inventory/inventory.js';
import { createJailedReadOnlyFilesystem } from '../../src/platform/filesystem/index.js';
import { AuditRuntimeError } from '../../src/shared/errors/audit-runtime-error.js';
import type { LoadedCorpusCase, LoadedCorpusPack } from './corpus.js';
import { contextRoot, variantRoot } from './corpus.js';
import type { StageIsolatedCanonicalInput } from './stage-isolated.js';
import type { StageIsolatedDiagnosticPackDescriptor } from './stage-isolated-diagnostic-pack.schema.js';

/**
 * Materializes an evaluator-private canonical predecessor from a checksummed
 * corpus tree and reviewed-plan fixture. It never reads an answer key to
 * prepare product input and never constructs a model provider.
 */
export async function prepareStageIsolatedCanonicalFixture(input: {
  descriptor: StageIsolatedDiagnosticPackDescriptor;
  corpus: LoadedCorpusPack;
  loadedCase: Pick<LoadedCorpusCase, 'case' | 'reviewedPlan'>;
}): Promise<StageIsolatedCanonicalInput> {
  const targetRoot = variantRoot(input.corpus, input.loadedCase.case, input.descriptor.variant);
  const advisoryContextRoot = contextRoot(input.corpus, input.loadedCase.case);
  const filesystem = await createJailedReadOnlyFilesystem({
    targetRoot,
    ...(advisoryContextRoot === undefined ? {} : { contextRoot: advisoryContextRoot }),
  });
  const captured = await captureTargetInventory(filesystem);
  if (captured.inventory.targetFingerprint !== input.descriptor.targetFingerprint) {
    throw invalidFixture(
      'The diagnostic target fingerprint does not match the captured inventory.',
    );
  }
  const plan = createPlan({
    targetFingerprint: captured.inventory.targetFingerprint,
    contextDigest: captured.inventory.contextDigest,
    targetDisplayName: input.descriptor.caseId,
    inventorySummary: captured.inventory.summary,
    vectors: input.loadedCase.reviewedPlan.vectors,
    createdAt: input.loadedCase.reviewedPlan.reviewedAt,
  });
  const vector = plan.vectors[input.descriptor.canonicalPredecessor.vectorIndex];
  if (vector === undefined)
    throw invalidFixture('The canonical predecessor selects no reviewed vector.');
  const scopedSources = selectScopedSources(vector, captured.snapshot.documents());
  if (scopedSources.length === 0) {
    throw invalidFixture(
      'The canonical predecessor reviewed vector has no admitted scoped source.',
    );
  }

  const base = {
    targetFingerprint: captured.inventory.targetFingerprint,
    contextDigest: captured.inventory.contextDigest,
  };
  if (input.descriptor.stage === 'planning') {
    return {
      ...base,
      stage: 'planning',
      request: {
        targetFingerprint: captured.inventory.targetFingerprint,
        contextDigest: captured.inventory.contextDigest,
        targetDisplayName: input.descriptor.caseId,
        inventorySummary: captured.inventory.summary,
        sourcePaths: captured.inventory.sourcePaths,
        context: captured.inventory.context,
        createdAt: input.loadedCase.reviewedPlan.reviewedAt,
      },
    };
  }
  if (input.descriptor.stage === 'evidence-mapping') {
    return {
      ...base,
      stage: 'evidence-mapping',
      request: {
        vector,
        availableSourcePaths: scopedSources.map((source) => source.path),
        limitations: [],
      },
      context: captured.inventory.context,
    };
  }

  const predecessors = createEvidenceBoundPredecessors({
    descriptor: input.descriptor,
    vector,
    sources: scopedSources,
  });
  if (input.descriptor.stage === 'investigation-grounding') {
    return {
      ...base,
      stage: 'investigation-grounding',
      investigationRequest: AuditInvestigationRequestSchema.parse({
        vector,
        availableSourcePaths: scopedSources.map((source) => source.path),
        limitations: [],
        evidenceMap: predecessors.evidenceMap,
        sourcePosture: predecessors.sourcePosture,
      }),
      investigationContext: captured.inventory.context,
      groundingRequest: CandidateGroundingRequestSchema.parse({
        vector,
        availableSourcePaths: scopedSources.map((source) => source.path),
        evidenceMap: predecessors.evidenceMap,
        sourcePosture: predecessors.sourcePosture,
        seeds: [predecessors.seed],
      }),
      groundingSources: scopedSources,
      groundingContext: captured.inventory.context,
    };
  }
  if (input.descriptor.stage === 'verification') {
    return {
      ...base,
      stage: 'verification',
      request: {
        verificationId: `${input.descriptor.diagnosticId}-verification`,
        vector,
        evidenceMap: predecessors.evidenceMap,
        sourcePosture: predecessors.sourcePosture,
        hypothesis: predecessors.hypothesis,
        availableSourcePaths: scopedSources.map((source) => source.path),
      },
      sources: scopedSources,
      context: captured.inventory.context,
    };
  }
  throw invalidFixture('The diagnostic stage cannot have an evidence-bound predecessor.');
}

function createEvidenceBoundPredecessors(input: {
  descriptor: StageIsolatedDiagnosticPackDescriptor;
  vector: AttackVector;
  sources: readonly SourceDocument[];
}) {
  const evidence = input.descriptor.canonicalPredecessor.evidenceAnchors.map((anchor) => {
    const source = input.sources.find((candidate) => candidate.path === anchor.path);
    const reference =
      source === undefined
        ? undefined
        : createSourceEvidenceReference({ source, startLine: anchor.startLine, role: anchor.role });
    if (reference === undefined) {
      throw invalidFixture(
        'A canonical predecessor anchor does not bind an admitted scoped source line.',
      );
    }
    return { role: anchor.role, reference };
  });
  const operation = evidence.find((entry) => entry.role === 'operation')?.reference;
  const unsafeCondition = evidence.find((entry) => entry.role === 'unsafe-condition')?.reference;
  if (operation === undefined || unsafeCondition === undefined) {
    throw invalidFixture('An evidence-bound predecessor requires both claim-evidence roles.');
  }
  const obligations = input.vector.reviewObligations.map((obligation) => ({
    obligationId: obligation.obligationId,
  }));
  const evidenceMap = EvidenceMapSchema.parse({
    facts: [
      {
        factId: `${input.descriptor.diagnosticId}-operation`,
        role: 'operation',
        evidence: [{ ...operation, role: undefined }],
        planObligations: obligations,
      },
      {
        factId: `${input.descriptor.diagnosticId}-unsafe-condition`,
        role: 'boundary',
        evidence: [{ ...unsafeCondition, role: undefined }],
        planObligations: obligations,
      },
    ],
    unansweredPlanObligations: [],
    limitations: [],
  });
  const evidenceMapFactIds = evidenceMap.facts.map((fact) => fact.factId);
  const claimEvidenceSelections = [
    {
      role: 'operation' as const,
      selections: [{ factId: `${input.descriptor.diagnosticId}-operation`, evidenceIndex: 0 }],
    },
    {
      role: 'unsafe-condition' as const,
      selections: [
        { factId: `${input.descriptor.diagnosticId}-unsafe-condition`, evidenceIndex: 0 },
      ],
    },
  ];
  const sourcePosture = SourcePostureSchema.parse({
    assessments: obligations.map((obligation) => ({
      assessmentId: `${input.descriptor.diagnosticId}-${obligation.obligationId}-posture`,
      obligationId: obligation.obligationId,
      conclusion: 'inconclusive',
      evidenceMapFactIds,
      limitations: [],
    })),
    limitations: [],
  });
  const postureIds = sourcePosture.assessments.map((assessment) => assessment.assessmentId);
  const seed = HypothesisSeedSchema.parse({
    seedId: `${input.descriptor.diagnosticId}-seed`,
    vectorId: input.vector.vectorId,
    hypothesis: 'The bounded reviewed condition requires candidate grounding.',
    planObligations: obligations,
    evidenceMapFactIds,
    sourcePostureAssessmentIds: postureIds,
    limitations: [],
  });
  const hypothesis = VerifiableHypothesisSchema.parse({
    vectorId: input.vector.vectorId,
    narrative: {
      statement: 'The reviewed operation may be reached with an unsafe condition.',
      roleExplanations: [
        {
          role: 'operation',
          explanation: 'The operation evidence identifies the reviewed action.',
        },
        {
          role: 'unsafe-condition',
          explanation: 'The condition evidence identifies the unsafe state.',
        },
      ],
      limitations: [],
    },
    claimEvidenceBundles: [
      { role: 'operation', evidence: [operation] },
      { role: 'unsafe-condition', evidence: [unsafeCondition] },
    ],
    planObligations: obligations,
    evidenceMapFactIds,
    claimEvidenceSelections,
    sourcePostureAssessmentIds: postureIds,
  });
  return { evidenceMap, sourcePosture, seed, hypothesis };
}

function invalidFixture(message: string): AuditRuntimeError {
  return new AuditRuntimeError('artifact-invalid', message);
}
