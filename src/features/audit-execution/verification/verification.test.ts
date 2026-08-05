import { expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeModelProvider } from '@purista/harness/testing';
import { createJailedReadOnlyFilesystem } from '../../../platform/filesystem/index.js';
import { HarnessExecutionConfigurationSchema } from '../../../platform/harness/audit-harness.js';
import { AuditVerificationRequestSchema } from '../../audit-execution/verification/contract.js';
import { runVerificationStage } from './verification.js';

test('fails closed when a verifier completion omits scoped source inspection', async () => {
  const targetRoot = await mkdtemp(join(tmpdir(), 'audit-verification-stage-'));
  await writeFile(join(targetRoot, 'reviewed.unknown'), 'query = request.input;\n', 'utf8');
  const provider = new FakeModelProvider();
  const acceptedVerifierResult = {
    decision: 'accepted',
    reasonCode: 'claim-supported',
    reason: 'The source supports the stated risk.',
    claimEvidenceBundles: [
      {
        role: 'operation',
        explanation: 'The operation is selected from the map.',
        selections: [{ factId: 'fact-source-01', evidenceIndex: 0 }],
      },
      {
        role: 'unsafe-condition',
        explanation: 'The condition is selected from the map.',
        selections: [{ factId: 'fact-input-01', evidenceIndex: 0 }],
      },
    ],
    controlAssessment: {
      conclusion: 'no-effective-control-found',
      explanation: 'No scoped control negates the claim.',
      evidenceSelections: [{ factId: 'fact-source-01', evidenceIndex: 0 }],
    },
    obligationReconciliations: [
      {
        planObligation: { obligationId: 'test-obligation-01' },
        disposition: 'supports-claim',
        explanation: 'The scoped source supports this approved obligation.',
        evidenceSelections: [{ factId: 'fact-source-01', evidenceIndex: 0 }],
      },
    ],
    postureReconciliations: [
      {
        assessmentId: 'posture-test-obligation-01',
        disposition: 'supports-claim',
        explanation: 'The posture aligns with the inspected source.',
        evidenceSelections: [{ factId: 'fact-source-01', evidenceIndex: 0 }],
      },
    ],
  };
  provider.enqueueObject({
    object: { result: acceptedVerifierResult },
    usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 },
    finishReason: 'stop',
  });

  const request = AuditVerificationRequestSchema.parse({
    verificationId: 'verification-unknown-01',
    vector: {
      vectorId: 'vector-unknown-01',
      vectorDigest: 'a'.repeat(64),
      title: 'Review bounded source',
      rationale: 'Review the approved source for security weaknesses.',
      enabled: true,
      scopeGlobs: ['reviewed.unknown'],
      reviewObligations: [
        {
          obligationId: 'test-obligation-01',
          riskStatement: 'The approved source could expose request-controlled data.',
          evidenceRequirement: 'Any claim is source-backed and inside the approved scope.',
        },
      ],
      limitations: [],
    },
    hypothesis: {
      vectorId: 'vector-unknown-01',
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
        {
          role: 'operation',
          evidence: [
            {
              path: 'reviewed.unknown',
              startLine: 1,
              contentDigest: 'a'.repeat(64),
              kind: 'source',
              role: 'operation',
            },
          ],
        },
        {
          role: 'unsafe-condition',
          evidence: [
            {
              path: 'reviewed.unknown',
              startLine: 1,
              contentDigest: 'a'.repeat(64),
              kind: 'source',
              role: 'unsafe-condition',
            },
          ],
        },
      ],
      planObligations: [{ obligationId: 'test-obligation-01' }],
      evidenceMapFactIds: ['fact-input-01', 'fact-source-01'],
      claimEvidenceSelections: [
        { role: 'operation', selections: [{ factId: 'fact-source-01', evidenceIndex: 0 }] },
        {
          role: 'unsafe-condition',
          selections: [{ factId: 'fact-input-01', evidenceIndex: 0 }],
        },
      ],
      sourcePostureAssessmentIds: ['posture-test-obligation-01'],
    },
    evidenceMap: {
      facts: [
        {
          factId: 'fact-input-01',
          role: 'input',
          evidence: [
            {
              path: 'reviewed.unknown',
              startLine: 1,
              contentDigest: 'a'.repeat(64),
              kind: 'source',
            },
          ],
          planObligations: [{ obligationId: 'test-obligation-01' }],
        },
        {
          factId: 'fact-source-01',
          role: 'operation',
          evidence: [
            {
              path: 'reviewed.unknown',
              startLine: 1,
              contentDigest: 'a'.repeat(64),
              kind: 'source',
            },
          ],
          planObligations: [{ obligationId: 'test-obligation-01' }],
        },
      ],
      unansweredPlanObligations: [],
      limitations: [],
    },
    sourcePosture: {
      assessments: [
        {
          assessmentId: 'posture-test-obligation-01',
          obligationId: 'test-obligation-01',
          conclusion: 'risk-supported',
          evidenceMapFactIds: ['fact-source-01'],
          limitations: [],
        },
      ],
      limitations: [],
    },
    availableSourcePaths: ['reviewed.unknown'],
  });
  const stageInput = {
    filesystem: await createJailedReadOnlyFilesystem({ targetRoot }),
    request,
    context: [],
    sessionId: 'verification-stage-01',
    modelName: undefined,
    harnessExecution: HarnessExecutionConfigurationSchema.parse({ modelRetry: 'disabled' }),
    modelCacheRoutingKey: undefined,
    modelPricing: {},
    cacheRoutingEnabled: false,
    route: 'independent',
  } as const;
  const result = await runVerificationStage({ modelProvider: provider, ...stageInput });

  expect(result).toMatchObject({
    decision: 'incomplete',
    terminalLane: 'stage-failed',
    claimEvidenceBundles: null,
    verifiedPlanObligations: [],
    modelObservation: {
      stage: 'verification',
      route: 'independent',
      status: 'failed',
      errorCode: 'coverage-incomplete',
      usage: { modelCallCount: 1, inputTokens: 4, outputTokens: 3 },
      toolUsage: { readFileCallCount: 0, grepFilesCallCount: 0 },
    },
  });
  expect(result).not.toHaveProperty('reason');

  provider.enqueueObject({
    object: {},
    toolCalls: [
      {
        id: 'verification-scoped-read',
        name: 'repo_read',
        arguments: { path: 'reviewed.unknown' },
      },
    ],
    usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
    finishReason: 'tool_calls',
  });
  provider.enqueueObject({
    object: { result: acceptedVerifierResult },
    usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 },
    finishReason: 'stop',
  });

  const inspectedResult = await runVerificationStage({ modelProvider: provider, ...stageInput });
  expect(inspectedResult).toMatchObject({
    decision: 'accepted',
    terminalLane: 'accepted',
    modelObservation: {
      status: 'completed',
      toolUsage: { readFileCallCount: 1, grepFilesCallCount: 0 },
    },
  });
});
