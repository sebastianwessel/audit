import { expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type JsonValue,
  ModelError,
  type ObjectRequest,
  type ObjectResponse,
} from '@purista/harness';
import { FakeModelProvider } from '@purista/harness/testing';

import { createPlan } from '../attack-planning/index.js';
import { PublicAuditReportSchema } from '../audit-report/public-contract.js';
import {
  type DeveloperGuidanceAttempt,
  DeveloperGuidanceCheckpointSchema,
} from '../developer-guidance/guidance.schema.js';
import {
  createDeveloperGuidanceCheckpointBinding,
  developerGuidanceModelStages,
} from '../developer-guidance/identity.js';

import { createReviewService, prepareDeveloperGuidanceTarget } from './service.js';

test('resumes only unfinished developer guidance and retains every prior observation', async () => {
  const targetRoot = await mkdtemp(join(tmpdir(), 'audit-guidance-service-'));
  await writeFile(join(targetRoot, 'reviewed.unknown'), 'value = request.input;\n', 'utf8');
  const preparationService = createReviewService(new FakeModelProvider());
  const inventory = await preparationService.inspectTarget({
    targetRoot,
    targetDisplayName: 'fixture',
  });
  const plan = createPlan({
    targetFingerprint: inventory.targetFingerprint,
    contextDigest: inventory.contextDigest,
    targetDisplayName: 'fixture',
    inventorySummary: inventory.summary,
    createdAt: '2026-08-04T12:00:00.000Z',
    vectors: [vector()],
  });
  const planVector = plan.vectors[0];
  if (planVector === undefined) throw new Error('Expected one plan vector.');
  const report = reportFor(plan.planId, inventory.targetFingerprint, planVector.vectorId);
  const retainedTarget = await prepareDeveloperGuidanceTarget({
    targetRoot,
    targetDisplayName: 'fixture',
    plan,
    report,
  });
  const binding = createDeveloperGuidanceCheckpointBinding({
    runId: 'guidance-run-001',
    plan,
    report,
    contextDigest: inventory.contextDigest,
    provider: 'fake',
    model: 'test-model',
    protocolFingerprint: 'f'.repeat(64),
  });
  const firstProvider = new FailsSecondGuidanceProvider();
  enqueueScopedSearch(firstProvider, 'first-search');
  firstProvider.enqueueObject(response());
  let firstAttempts: readonly DeveloperGuidanceAttempt[] = [];
  const first = await createReviewService(firstProvider, 'test-model').createDeveloperGuidance({
    targetRoot,
    targetDisplayName: 'fixture',
    plan,
    report,
    retainedTarget,
    runId: 'guidance-run-001',
    generatedAt: '2026-08-04T12:01:00.000Z',
    sessionId: 'guidance-run-001',
    onCheckpoint: async (state) => {
      firstAttempts = [...state.attempts];
    },
  });

  expect(first.guidance.items.map((item) => item.status)).toEqual(['completed', 'incomplete']);
  expect(firstAttempts).toHaveLength(2);
  const checkpoint = DeveloperGuidanceCheckpointSchema.parse({
    schemaVersion: 3,
    binding,
    generatedAt: '2026-08-04T12:01:00.000Z',
    attempts: firstAttempts,
  });
  expect(developerGuidanceModelStages(checkpoint)).toHaveLength(2);

  const resumedProvider = new FakeModelProvider();
  enqueueScopedSearch(resumedProvider, 'second-search');
  resumedProvider.enqueueObject(response());
  const resumed = await createReviewService(resumedProvider, 'test-model').createDeveloperGuidance({
    targetRoot,
    targetDisplayName: 'fixture',
    plan,
    report,
    retainedTarget,
    recoveredCheckpoint: checkpoint,
    retryUnfinished: true,
    runId: 'guidance-run-001',
    generatedAt: '2026-08-04T12:02:00.000Z',
    sessionId: 'guidance-run-001',
  });

  expect(resumed.guidance.items.map((item) => item.status)).toEqual(['completed', 'completed']);
  expect(resumedProvider.requests).toHaveLength(2);
  expect(resumed.guidance.modelObservation.stages).toHaveLength(3);
});

test('keeps provider context overflow as an explicit incomplete guidance item', async () => {
  const targetRoot = await mkdtemp(join(tmpdir(), 'audit-guidance-overflow-'));
  await writeFile(join(targetRoot, 'reviewed.unknown'), 'const value = "fixture";\n');
  const setupService = createReviewService(new FakeModelProvider(), 'test-model');
  const inventory = await setupService.inspectTarget({
    targetRoot,
    targetDisplayName: 'fixture',
  });
  const plan = createPlan({
    targetFingerprint: inventory.targetFingerprint,
    contextDigest: inventory.contextDigest,
    targetDisplayName: 'fixture',
    inventorySummary: inventory.summary,
    createdAt: '2026-08-04T12:03:00.000Z',
    vectors: [vector()],
  });
  const planVector = plan.vectors[0];
  if (planVector === undefined) throw new Error('Expected one plan vector.');
  const report = reportFor(plan.planId, inventory.targetFingerprint, planVector.vectorId);
  const retainedTarget = await prepareDeveloperGuidanceTarget({
    targetRoot,
    targetDisplayName: 'fixture',
    plan,
    report,
  });
  const provider = new ContextOverflowGuidanceProvider();

  const result = await createReviewService(provider, 'test-model').createDeveloperGuidance({
    targetRoot,
    targetDisplayName: 'fixture',
    plan,
    report,
    retainedTarget,
    runId: 'guidance-overflow-001',
    generatedAt: '2026-08-04T12:03:00.000Z',
    sessionId: 'guidance-overflow-001',
  });

  expect(result.guidance.items).toHaveLength(2);
  expect(result.guidance.items.every((item) => item.status === 'incomplete')).toBe(true);
  expect(result.guidance.items).toEqual(
    expect.arrayContaining([expect.objectContaining({ reasonCode: 'provider-context-overflow' })]),
  );
  expect(result.guidance.modelObservation.stages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ errorCode: 'provider-context-overflow', status: 'failed' }),
    ]),
  );
  expect(provider.objectCalls).toBe(2);
});

class FailsSecondGuidanceProvider extends FakeModelProvider {
  private objectCalls = 0;

  public override async object<T extends JsonValue>(
    request: ObjectRequest<T>,
  ): Promise<ObjectResponse<T>> {
    this.objectCalls += 1;
    if (this.objectCalls === 3) throw new Error('transient provider failure');
    return super.object(request);
  }
}

class ContextOverflowGuidanceProvider extends FakeModelProvider {
  public objectCalls = 0;

  public override async object<T extends JsonValue>(
    _request: ObjectRequest<T>,
  ): Promise<ObjectResponse<T>> {
    this.objectCalls += 1;
    throw new ModelError('The provider rejected the context.', {
      provider: 'test',
      model: 'test-model',
      method: 'object',
      reason: 'context_length_exceeded',
    });
  }
}

function enqueueScopedSearch(provider: FakeModelProvider, id: string): void {
  provider.enqueueObject({
    object: {},
    toolCalls: [
      {
        id,
        name: 'repo_grep',
        arguments: { pattern: 'value', mode: 'literal', caseSensitive: true },
      },
    ],
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: 'tool_calls',
  });
}

function response() {
  return {
    object: {
      recommendedPriority: 'high',
    },
    usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 },
    finishReason: 'stop' as const,
  };
}

function vector() {
  return {
    title: 'Reviewed boundary',
    rationale: 'Review the approved source boundary.',
    enabled: true,
    scopeGlobs: ['reviewed.unknown'],
    reviewObligations: [
      {
        obligationId: 'obligation-001',
        riskStatement: 'The boundary could expose protected operations.',
        evidenceRequirement: 'Inspect the source-backed operation and controls.',
      },
    ],
    limitations: [],
  };
}

function reportFor(planId: string, targetFingerprint: string, vectorId: string) {
  return PublicAuditReportSchema.parse({
    schemaVersion: 5,
    reportId: 'report-001',
    runId: 'audit-001',
    planId,
    targetFingerprint,
    generatedAt: '2026-08-04T12:00:00.000Z',
    reviewContext: {
      vectors: [
        {
          vectorId,
          title: 'Reviewed boundary',
          reviewObligations: [
            {
              obligationId: 'obligation-001',
              riskStatement: 'The boundary could expose protected operations.',
              evidenceRequirement: 'Inspect the source-backed operation and controls.',
            },
          ],
        },
      ],
    },
    coverage: [
      {
        vectorId,
        planned: true,
        completed: true,
        matchedSourcePaths: 1,
        evidenceMapFactCount: 2,
        evidenceMapUnansweredObligationCount: 0,
        sourcePostureAssessmentCount: 1,
        sourcePostureSupportedCount: 1,
        sourcePostureContradictedCount: 0,
        sourcePostureInconclusiveCount: 0,
        findingCount: 2,
        reviewRequiredCount: 0,
        outcome: 'completed',
        errorCode: null,
        limitations: [],
        obligationClosure: [
          {
            obligationId: 'obligation-001',
            planObligation: { obligationId: 'obligation-001' },
            mapState: 'mapped',
            evidenceMapFactCount: 2,
            sourcePostureConclusion: 'risk-supported',
            investigationState: 'candidate-raised',
            candidateCount: 2,
            admittedFindingCount: 2,
            terminalDisposition: 'finding-admitted',
          },
        ],
      },
    ],
    findings: ['finding-001', 'finding-002'].map((findingId) => finding(findingId, vectorId)),
    reviewRequired: [],
    errors: [],
  });
}

function finding(findingId: string, vectorId: string) {
  return {
    findingId,
    vectorId,
    narrative: {
      statement: 'The reviewed operation may be reached with an unsafe condition.',
      roleExplanations: [
        {
          role: 'operation' as const,
          explanation: 'The operation evidence identifies the reviewed action.',
        },
        {
          role: 'unsafe-condition' as const,
          explanation: 'The condition evidence identifies the unsafe state.',
        },
      ],
      limitations: [],
    },
    claimEvidenceBundles: [
      {
        role: 'operation' as const,
        evidence: [
          {
            path: 'reviewed.unknown',
            startLine: 1,
            contentDigest: 'a'.repeat(64),
            kind: 'source' as const,
            role: 'operation' as const,
          },
        ],
      },
      {
        role: 'unsafe-condition' as const,
        evidence: [
          {
            path: 'reviewed.unknown',
            startLine: 1,
            contentDigest: 'a'.repeat(64),
            kind: 'source' as const,
            role: 'unsafe-condition' as const,
          },
        ],
      },
    ],
    planObligations: [{ obligationId: 'obligation-001' }],
    status: 'accepted' as const,
    verification: { status: 'verified' as const, checks: ['scope'] },
  };
}
