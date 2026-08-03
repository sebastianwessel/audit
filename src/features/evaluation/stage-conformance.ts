import type { JsonValue, ObjectResponse, ToolCallSpec } from '@purista/harness';
import type { JailedReadOnlyFilesystem } from '../../platform/filesystem/index.js';
import { HarnessExecutionConfigurationSchema } from '../../platform/harness/security-reviewer-harness.js';
import { AttackVectorSchema } from '../attack-planning/plan.schema.js';
import { AuditInvestigationRequestSchema } from '../audit-execution/audit.schema.js';
import { CandidateGroundingRequestSchema } from '../audit-execution/candidate-grounding/contract.js';
import { EvidenceMapSchema } from '../audit-execution/evidence-map/contract.js';
import { HypothesisSeedSchema } from '../audit-execution/investigation/contract.js';
import {
  EvidenceMapRequestSchema,
  SourcePostureRequestSchema,
} from '../audit-execution/phase-input/contract.js';
import { SourcePostureSchema } from '../audit-execution/source-posture/contract.js';
import {
  AuditCountercheckRequestSchema,
  AuditVerificationRequestSchema,
} from '../audit-execution/verification/contract.js';
import {
  hasSuccessfulScopedSourceInspection,
  type ToolUsage,
} from '../model-operations/model-operations.js';
import { runCandidateGroundingStage } from '../review-workflow/stages/candidate-grounding.js';
import { runEvidenceMapStage } from '../review-workflow/stages/evidence-map.js';
import { runInvestigationStage } from '../review-workflow/stages/investigation.js';
import { runPlanningStage } from '../review-workflow/stages/planning.js';
import { runScopedModelStage } from '../review-workflow/stages/scoped-model-stage.js';
import { runSourcePostureStage } from '../review-workflow/stages/source-posture.js';
import { runVerificationStage } from '../review-workflow/stages/verification.js';
import { scopedInspectionRequirement } from '../review-workflow/tools/contract.js';

import { DeterministicCorpusProvider } from './deterministic-provider.js';
import {
  type SourceDecidingModelStage,
  type StageConformanceResult,
  StageConformanceRunSchema,
} from './stage-conformance.schema.js';

const sourcePath = 'reviewed.unknown';
const sourceLine = 'value = request.input;\n';
const execution = HarnessExecutionConfigurationSchema.parse({ modelRetry: 'default' });
const vector = AttackVectorSchema.parse({
  vectorId: 'stage-conformance-vector-01',
  vectorDigest: 'a'.repeat(64),
  title: 'Review bounded source',
  rationale: 'Exercise the source-inspection protocol without a security claim.',
  enabled: true,
  scopeGlobs: [sourcePath],
  reviewObligations: [
    {
      obligationId: 'stage-conformance-obligation-01',
      riskStatement: 'The bounded source may require security follow-up.',
      evidenceRequirement: 'Inspect only approved source through the read-only tools.',
    },
  ],
  limitations: ['Deterministic protocol fixture; not a security conclusion.'],
});
const evidenceMap = EvidenceMapSchema.parse({
  facts: [
    {
      factId: 'stage-conformance-operation-01',
      role: 'operation',
      statement: 'The approved source contains the reviewed operation.',
      evidence: [{ path: sourcePath, startLine: 1, snippet: sourceLine.trim(), kind: 'source' }],
      planObligations: [{ obligationId: 'stage-conformance-obligation-01' }],
    },
  ],
  unansweredPlanObligations: [],
  limitations: [],
});
const sourcePosture = SourcePostureSchema.parse({
  assessments: [
    {
      assessmentId: 'stage-conformance-posture-01',
      obligationId: 'stage-conformance-obligation-01',
      conclusion: 'inconclusive',
      evidenceMapFactIds: ['stage-conformance-operation-01'],
      limitations: ['Deterministic protocol fixture; not a security conclusion.'],
    },
  ],
  limitations: [],
});
const seed = HypothesisSeedSchema.parse({
  seedId: 'stage-conformance-seed-01',
  vectorId: vector.vectorId,
  hypothesis: 'The reviewed operation may need further security analysis.',
  planObligations: [{ obligationId: 'stage-conformance-obligation-01' }],
  evidenceMapFactIds: ['stage-conformance-operation-01'],
  sourcePostureAssessmentIds: ['stage-conformance-posture-01'],
  limitations: [],
});
const hypothesis = {
  vectorId: vector.vectorId,
  statement: 'Bounded protocol hypothesis',
  evidence: [
    {
      path: sourcePath,
      startLine: 1,
      snippet: sourceLine.trim(),
      kind: 'source' as const,
      role: 'operation' as const,
    },
    {
      path: sourcePath,
      startLine: 1,
      snippet: sourceLine.trim(),
      kind: 'source' as const,
      role: 'unsafe-condition' as const,
    },
  ],
  planObligations: [{ obligationId: 'stage-conformance-obligation-01' }],
  evidenceMapFactIds: ['stage-conformance-operation-01'],
  sourcePostureAssessmentIds: ['stage-conformance-posture-01'],
  limitations: ['Deterministic protocol fixture; not a security conclusion.'],
};

/**
 * Exercises every source-deciding stage through its production workflow path.
 * All responses are in-process scripts: this is an operational conformance
 * check, not a provider call, source analysis, or quality evaluation.
 */
export async function runDeterministicStageConformance(filesystem: JailedReadOnlyFilesystem) {
  const stages = await Promise.all([
    runPlanningConformance(filesystem),
    runEvidenceMappingConformance(filesystem),
    runSourcePostureConformance(filesystem),
    runInvestigationConformance(filesystem),
    runCandidateGroundingConformance(filesystem),
    runVerificationConformance(filesystem),
    runCountercheckConformance(filesystem),
  ]);
  return StageConformanceRunSchema.parse({
    schemaVersion: 1,
    mode: 'deterministic-stage-conformance',
    provider: 'in-process-scripted-fixture',
    stages: stages.sort((left, right) => left.stage.localeCompare(right.stage)),
  });
}

async function runPlanningConformance(
  filesystem: JailedReadOnlyFilesystem,
): Promise<StageConformanceResult> {
  const provider = inspectedProvider({
    vectors: [
      {
        title: 'Review bounded source',
        rationale: 'Exercise the planning inspection protocol without a security claim.',
        enabled: true,
        scopeGlobs: [sourcePath],
        reviewObligations: vector.reviewObligations,
        limitations: vector.limitations,
      },
    ],
  });
  const result = await runPlanningStage({
    modelProvider: provider,
    filesystem,
    request: {
      targetFingerprint: 'b'.repeat(64),
      contextDigest: 'c'.repeat(64),
      targetDisplayName: 'stage-conformance',
      inventorySummary: { fileCount: 1, totalBytes: sourceLine.length, languageHints: [] },
      sourcePaths: [sourcePath],
      context: [],
      createdAt: '2026-08-03T12:00:00.000Z',
    },
    sessionId: 'stage-conformance-planning',
    modelName: undefined,
    harnessExecution: execution,
    modelCacheRoutingKey: undefined,
    modelPricing: {},
    cacheRoutingEnabled: false,
  });
  if (result.status !== 'completed') throw new Error('Planning conformance did not complete.');
  return conformanceResult('planning', 'inspected', result.modelObservation.toolUsage);
}

async function runEvidenceMappingConformance(
  filesystem: JailedReadOnlyFilesystem,
): Promise<StageConformanceResult> {
  const provider = new DeterministicCorpusProvider();
  provider.enqueue(
    terminalResponse({
      facts: [],
      controlCoverage: [{ obligationId: 'stage-conformance-obligation-01', controlFactIds: [] }],
      unansweredPlanObligations: [{ obligationId: 'stage-conformance-obligation-01' }],
      limitations: ['Initial fixture completion deliberately omits source inspection.'],
    }),
  );
  enqueueInspection(provider);
  provider.enqueue(
    terminalResponse({
      facts: [],
      controlCoverage: [{ obligationId: 'stage-conformance-obligation-01', controlFactIds: [] }],
      unansweredPlanObligations: [{ obligationId: 'stage-conformance-obligation-01' }],
      limitations: ['The scripted mapper inspected source without a semantic claim.'],
    }),
  );
  const result = await runEvidenceMapStage({
    modelProvider: provider,
    filesystem,
    request: EvidenceMapRequestSchema.parse({
      vector,
      availableSourcePaths: [sourcePath],
      limitations: [],
    }),
    context: [],
    sessionId: 'stage-conformance-mapper',
    modelName: undefined,
    harnessExecution: execution,
    modelCacheRoutingKey: undefined,
    modelPricing: {},
    cacheRoutingEnabled: false,
  });
  if (result.status !== 'completed')
    throw new Error('Evidence mapping conformance did not complete.');
  return conformanceResult('evidence-mapping', 'retry-safe', result.modelObservation.toolUsage);
}

async function runSourcePostureConformance(
  filesystem: JailedReadOnlyFilesystem,
): Promise<StageConformanceResult> {
  const provider = inspectedProvider({
    assessments: [
      {
        assessmentId: 'stage-conformance-posture-01',
        obligationId: 'stage-conformance-obligation-01',
        conclusion: 'inconclusive',
        evidenceMapFactIds: ['stage-conformance-operation-01'],
        limitations: [],
      },
    ],
    limitations: [],
  });
  const result = await runSourcePostureStage({
    modelProvider: provider,
    filesystem,
    request: SourcePostureRequestSchema.parse({
      vector,
      availableSourcePaths: [sourcePath],
      evidenceMap,
      limitations: [],
    }),
    context: [],
    sessionId: 'stage-conformance-posture',
    modelName: undefined,
    harnessExecution: execution,
    modelCacheRoutingKey: undefined,
    modelPricing: {},
    cacheRoutingEnabled: false,
  });
  if (result.status !== 'completed')
    throw new Error('Source posture conformance did not complete.');
  return conformanceResult('source-posture', 'inspected', result.modelObservation.toolUsage);
}

async function runInvestigationConformance(
  filesystem: JailedReadOnlyFilesystem,
): Promise<StageConformanceResult> {
  const provider = inspectedProvider({
    seeds: [],
    closures: [
      {
        planObligation: { obligationId: 'stage-conformance-obligation-01' },
        disposition: 'no-source-backed-candidate',
        evidenceMapFactIds: ['stage-conformance-operation-01'],
        limitations: [],
      },
    ],
  });
  const result = await runInvestigationStage({
    modelProvider: provider,
    filesystem,
    request: AuditInvestigationRequestSchema.parse({
      vector,
      availableSourcePaths: [sourcePath],
      evidenceMap,
      sourcePosture,
      limitations: [],
    }),
    context: [],
    sessionId: 'stage-conformance-investigation',
    modelName: undefined,
    harnessExecution: execution,
    modelCacheRoutingKey: undefined,
    modelPricing: {},
    cacheRoutingEnabled: false,
  });
  return conformanceResult('investigation', 'inspected', result.modelObservation.toolUsage);
}

async function runCandidateGroundingConformance(
  filesystem: JailedReadOnlyFilesystem,
): Promise<StageConformanceResult> {
  const provider = inspectedProvider({ groundings: [{ seedId: seed.seedId, candidate: null }] });
  const result = await runCandidateGroundingStage({
    modelProvider: provider,
    filesystem,
    request: CandidateGroundingRequestSchema.parse({
      vector,
      evidenceMap,
      sourcePosture,
      seeds: [seed],
      availableSourcePaths: [sourcePath],
    }),
    sources: [],
    context: [],
    sessionId: 'stage-conformance-grounding',
    modelName: undefined,
    harnessExecution: execution,
    modelCacheRoutingKey: undefined,
    modelPricing: {},
    cacheRoutingEnabled: false,
  });
  if (result.status !== 'completed')
    throw new Error('Candidate grounding conformance did not complete.');
  return conformanceResult('candidate-grounding', 'inspected', result.modelObservation.toolUsage);
}

async function runVerificationConformance(
  filesystem: JailedReadOnlyFilesystem,
): Promise<StageConformanceResult> {
  const provider = inspectedProvider(incompleteVerification());
  const result = await runVerificationStage({
    modelProvider: provider,
    filesystem,
    request: AuditVerificationRequestSchema.parse({
      verificationId: 'stage-conformance-verification-01',
      vector,
      evidenceMap,
      sourcePosture,
      hypothesis,
      availableSourcePaths: [sourcePath],
    }),
    context: [],
    sessionId: 'stage-conformance-verification',
    modelName: undefined,
    harnessExecution: execution,
    modelCacheRoutingKey: undefined,
    modelPricing: {},
    cacheRoutingEnabled: false,
  });
  return conformanceResult('verification', 'inspected', result.modelObservation.toolUsage);
}

async function runCountercheckConformance(
  filesystem: JailedReadOnlyFilesystem,
): Promise<StageConformanceResult> {
  const provider = inspectedProvider(incompleteVerification());
  const result = await runScopedModelStage({
    stage: 'countercheck',
    route: 'primary',
    stageId: 'stage-conformance-countercheck-01',
    modelProvider: provider,
    filesystem,
    availableSourcePaths: [sourcePath],
    context: [],
    sessionId: 'stage-conformance-countercheck',
    modelName: undefined,
    harnessExecution: execution,
    modelCacheRoutingKey: undefined,
    modelPricing: {},
    cacheRoutingEnabled: false,
    requireScopedSourceInspection: true,
    invoke: (session, _attempt, scope) =>
      session.workflows.countercheck_hypothesis.prompt({
        ...AuditCountercheckRequestSchema.parse({
          countercheckId: 'stage-conformance-countercheck-01',
          vector,
          evidenceMap,
          sourcePosture,
          hypothesis,
          availableSourcePaths: [sourcePath],
        }),
        availableSourcePaths: [...scope.sourcePaths],
        context: [...scope.context],
        inspectionRequirement: scopedInspectionRequirement(scope.sourcePaths),
      }),
  });
  if (result.status !== 'completed') throw new Error('Countercheck conformance did not complete.');
  return conformanceResult('countercheck', 'inspected', result.modelObservation.toolUsage);
}

function inspectedProvider(output: JsonValue): DeterministicCorpusProvider {
  const provider = new DeterministicCorpusProvider();
  enqueueInspection(provider);
  provider.enqueue(terminalResponse(output));
  return provider;
}

function enqueueInspection(provider: DeterministicCorpusProvider): void {
  const toolCall: ToolCallSpec = {
    id: 'stage-conformance-inspection',
    name: 'repo_grep',
    arguments: {
      pattern: '__security_reviewer_stage_conformance_no_match__',
      mode: 'literal',
      caseSensitive: true,
    },
  };
  provider.enqueue({ ...terminalResponse({}), toolCalls: [toolCall], finishReason: 'tool_calls' });
}

function terminalResponse(object: JsonValue): ObjectResponse<JsonValue> {
  return {
    object,
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: 'stop',
  };
}

function incompleteVerification(): JsonValue {
  return {
    decision: 'incomplete',
    reason: 'The deterministic fixture makes no verification decision.',
    operationEvidence: null,
    unsafeConditionEvidence: null,
    controlAssessment: null,
    obligationReconciliations: [],
    postureReconciliations: [],
  };
}

function conformanceResult(
  stage: SourceDecidingModelStage,
  outcome: 'inspected' | 'retry-safe',
  toolUsage: ToolUsage,
): StageConformanceResult {
  if (!hasSuccessfulScopedSourceInspection(toolUsage)) {
    throw new Error(`Stage ${stage} completed without source inspection.`);
  }
  if (toolUsage.rejectedCallCount !== 0) {
    throw new Error(`Stage ${stage} attempted an invalid scoped tool operation.`);
  }
  return { stage, outcome, scopePreserved: true, toolUsage };
}
