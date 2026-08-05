import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readJsonArtifact } from '../../platform/artifact-store/json-artifact-store.js';
import { createPlan } from '../attack-planning/index.js';
import { observeModelStage } from '../model-operations/model-operations.js';
import { AuditContextOverflowLedgerSchema } from './audit.schema.js';
import { auditContextOverflowLedgerPath } from './checkpoints.js';
import {
  createAuditPersistenceAdapter,
  createAuditPersistenceBindingFactory,
} from './cli-persistence.js';

test('derives every vector checkpoint binding from one immutable audit base binding', () => {
  const plan = createPlan({
    targetFingerprint: 'a'.repeat(64),
    contextDigest: 'b'.repeat(64),
    targetDisplayName: 'fixture',
    inventorySummary: { fileCount: 1, totalBytes: 1, languageHints: [] },
    vectors: [
      {
        title: 'Review the bounded fixture',
        rationale: 'A bounded fixture can exercise checkpoint identity.',
        enabled: true,
        scopeGlobs: ['fixture.unknown'],
        reviewObligations: [
          {
            obligationId: 'fixture-obligation-01',
            riskStatement: 'The bounded fixture could expose an unsafe condition.',
            evidenceRequirement: 'Inspect the approved scoped source before any conclusion.',
          },
        ],
        limitations: [],
      },
    ],
    createdAt: '2026-08-04T00:00:00.000Z',
  });
  const vector = plan.vectors[0];
  if (vector === undefined) throw new Error('Expected the sealed fixture vector.');

  const bindings = createAuditPersistenceBindingFactory({
    runId: 'audit-run-001',
    plan,
    provider: 'openai',
    model: 'gpt-5.6-terra',
    verificationRouteFingerprint: 'c'.repeat(64),
    evidenceMapProtocolFingerprint: 'd'.repeat(64),
    reviewWorkflowProtocolFingerprint: 'e'.repeat(64),
  });

  expect(bindings.base).toEqual({
    runId: 'audit-run-001',
    planId: plan.planId,
    targetFingerprint: plan.targetFingerprint,
    provider: 'openai',
    model: 'gpt-5.6-terra',
    verificationRouteFingerprint: 'c'.repeat(64),
    evidenceMapProtocolFingerprint: 'd'.repeat(64),
    reviewWorkflowProtocolFingerprint: 'e'.repeat(64),
  });
  expect(bindings.forVector(vector.vectorId)).toMatchObject({
    ...bindings.base,
    vectorId: vector.vectorId,
    vectorDigest: vector.vectorDigest,
  });
  expect(Object.isFrozen(bindings.base)).toBe(true);
});

test('appends resumed context-overflow transitions to the exact persisted ledger', async () => {
  const privateWork = await mkdtemp(join(tmpdir(), 'audit-persistence-'));
  const plan = createPlan({
    targetFingerprint: 'a'.repeat(64),
    contextDigest: 'b'.repeat(64),
    targetDisplayName: 'fixture',
    inventorySummary: { fileCount: 1, totalBytes: 1, languageHints: [] },
    vectors: [
      {
        title: 'Review the bounded fixture',
        rationale: 'A bounded fixture can exercise checkpoint identity.',
        enabled: true,
        scopeGlobs: ['fixture.unknown'],
        reviewObligations: [
          {
            obligationId: 'fixture-obligation-01',
            riskStatement: 'The bounded fixture could expose an unsafe condition.',
            evidenceRequirement: 'Inspect the approved scoped source before any conclusion.',
          },
        ],
        limitations: [],
      },
    ],
    createdAt: '2026-08-04T00:00:00.000Z',
  });
  const vector = plan.vectors[0];
  if (vector === undefined) throw new Error('Expected the sealed fixture vector.');
  const adapter = () =>
    createAuditPersistenceAdapter({
      privateWork,
      runId: 'audit-run-001',
      plan,
      provider: 'openai',
      model: 'gpt-5.6-terra',
      verificationRouteFingerprint: 'c'.repeat(64),
      evidenceMapProtocolFingerprint: 'd'.repeat(64),
      reviewWorkflowProtocolFingerprint: 'e'.repeat(64),
    });
  const transition = (attempt: number) => ({
    vectorId: vector.vectorId,
    phase: 'evidence-mapping' as const,
    parentStageId: vector.vectorId,
    phaseInputFingerprint: 'f'.repeat(64),
    recoveryProtocolFingerprint: '1'.repeat(64),
    rootScopeFingerprint: '2'.repeat(64),
    event: {
      childKey: 'root',
      attempt,
      scopeFingerprint: '3'.repeat(64),
      state: 'overflowed' as const,
      errorCode: 'provider-context-overflow' as const,
      execution: {
        kind: 'provider' as const,
        modelObservation: observeModelStage({
          stage: 'evidence-mapping',
          route: 'primary',
          stageId: `overflow-transition-${attempt}`,
          status: 'failed',
          durationMs: 1,
          errorCode: 'provider-context-overflow',
          requests: [],
          pricing: {},
          cacheRoutingEnabled: false,
        }),
      },
    },
  });

  try {
    const firstSession = await adapter().loadSession({ resume: false, retryUnfinished: false });
    await firstSession.callbacks.onContextOverflowTransition?.(transition(1));
    const resumedSession = await adapter().loadSession({ resume: true, retryUnfinished: false });
    await resumedSession.callbacks.onContextOverflowTransition?.(transition(2));

    const ledger = await readJsonArtifact(
      privateWork,
      auditContextOverflowLedgerPath({
        runId: 'audit-run-001',
        vectorId: vector.vectorId,
        phase: 'evidence-mapping',
      }),
      AuditContextOverflowLedgerSchema,
    );
    expect(ledger.events.map((event) => event.ordinal)).toEqual([1, 2]);
  } finally {
    await rm(privateWork, { recursive: true, force: true });
  }
});
