import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { observeModelStage } from '../../src/features/model-operations/model-operations.js';
import { sha256 } from '../../src/shared/contracts/core.js';
import { RealWorldEvaluationRunSchema } from './corpus.schema.js';
import { inspectEvaluationArtifacts } from './evaluation-artifact-inspector.js';

const temporaryRoots: string[] = [];
const protocol = 'd'.repeat(64);
const semanticPlanEvaluator = { protocolFingerprint: 'f'.repeat(64), route: 'primary' as const };
const semanticObservation = observeModelStage({
  stage: 'plan-semantic-adjudication',
  route: 'primary',
  stageId: 'inspector-semantic-stage',
  status: 'completed',
  durationMs: 1,
  errorCode: null,
  requests: [],
  pricing: {},
  trace: [],
  cacheRoutingEnabled: false,
});

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

function completeRun(runId: string) {
  return RealWorldEvaluationRunSchema.parse({
    schemaVersion: 15,
    runId,
    packId: 'inspector-pack',
    packVersion: '1.0.0',
    corpusManifestDigest: 'b'.repeat(64),
    populationDigest: 'c'.repeat(64),
    benchmarkProtocolFingerprint: protocol,
    mode: 'provider',
    provider: 'fixture',
    model: 'fixture',
    verificationMode: 'same-route',
    verificationRouteFingerprint: 'a'.repeat(64),
    selectedSplit: 'development',
    findingCoverage: 'targeted',
    evidenceQualification: 'diagnostic',
    repetitions: 1,
    planProfile: 'planning-generated',
    semanticPlanEvaluator,
    executionBudget: { modelTimeoutMs: 20_000, runTimeoutMs: 30_000, modelRetry: 'default' },
    maxParallelVectors: 1,
    promptProtocolFingerprint: 'e'.repeat(64),
    startedAt: '2026-08-04T12:00:00.000Z',
    finishedAt: '2026-08-04T12:00:01.000Z',
    selectedTrialPopulation: [{ caseId: 'case-001', variant: 'vulnerable', repetition: 1 }],
    trials: [
      {
        caseId: 'case-001',
        variant: 'vulnerable',
        repetition: 1,
        status: 'completed',
        reviewedPlanFingerprint: null,
        pathReachability: {
          eligibleScenarioCount: 1,
          pathReachableScenarioCount: 1,
          notApplicableScenarioCount: 0,
          relevantPathCoverage: 1,
          enabledVectorCount: 1,
        },
        semanticPlanMeasurement: {
          status: 'completed',
          identity: {
            planDigest: '1'.repeat(64),
            answerKeyScenarioDigest: '2'.repeat(64),
            ...semanticPlanEvaluator,
          },
          score: {
            expectedScenarioCount: 1,
            coveredScenarioCount: 1,
            scenarioRecall: 1,
            enabledVectorCount: 1,
            relevantVectorCount: 1,
            unrelatedVectorCount: 0,
            relevantVectorPrecision: 1,
            duplicateRelevantVectorCount: 0,
            additionalObservationCount: 0,
            appropriateObservationCount: 0,
            misplacedObservationCount: 0,
          },
          modelObservation: semanticObservation,
        },
        findingScore: null,
        planKeys: ['a'.repeat(64)],
        findingKeys: [],
        durationMs: 1,
        errorCode: null,
      },
    ],
    reliability: {
      completedTrials: 1,
      incompleteTrials: 0,
      failedTrials: 0,
      cancelledTrials: 0,
      completionRate: 1,
      planJaccard: null,
      findingJaccard: null,
      findingRecallMedian: null,
      findingRecallMinimum: null,
      allTerminalDurationMsMedian: 1,
      allTerminalDurationMsP95: 1,
      completedDurationMsMedian: 1,
      completedDurationMsP95: 1,
    },
    measurementState: { workflow: 'complete', semanticPlan: 'complete', finding: 'not-applicable' },
    safetyViolations: 0,
    diagnosticGatePassed: true,
  });
}

async function writeArtifact(root: string, run: ReturnType<typeof completeRun>, terminal: boolean) {
  const directory = join(root, run.runId);
  await mkdir(directory, { recursive: true });
  const runBytes = Buffer.from(`${JSON.stringify(run)}\n`);
  const reportBytes = Buffer.from('# source-free fixture report\n');
  const traceBytes = Buffer.from(
    `${run.trials.map((trial) => JSON.stringify(trial)).join('\n')}\n`,
  );
  await writeFile(join(directory, 'evaluation-run.json'), runBytes);
  await writeFile(join(directory, 'evaluation-report.md'), reportBytes);
  await writeFile(join(directory, 'case-results.jsonl'), traceBytes);
  if (!terminal) return;
  await writeFile(
    join(directory, 'terminal-manifest.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      runId: run.runId,
      configFingerprint: '9'.repeat(64),
      packId: run.packId,
      packVersion: run.packVersion,
      corpusManifestDigest: run.corpusManifestDigest,
      populationDigest: run.populationDigest,
      benchmarkProtocolFingerprint: run.benchmarkProtocolFingerprint,
      provider: run.provider,
      model: run.model,
      planProfile: run.planProfile,
      semanticPlanEvaluator: run.semanticPlanEvaluator,
      requiredArtifacts: [
        {
          name: 'evaluation-run.json',
          schemaVersion: run.schemaVersion,
          sha256: sha256(runBytes),
          byteLength: runBytes.byteLength,
        },
        {
          name: 'evaluation-report.md',
          schemaVersion: null,
          sha256: sha256(reportBytes),
          byteLength: reportBytes.byteLength,
        },
        {
          name: 'case-results.jsonl',
          schemaVersion: null,
          sha256: sha256(traceBytes),
          byteLength: traceBytes.byteLength,
        },
      ],
      frozenTrialIds: run.selectedTrialPopulation,
      aggregateDigest: '8'.repeat(64),
      publishedAt: run.finishedAt,
      attemptId: 'attempt-001',
      terminalStatus: 'completed',
    })}\n`,
  );
}

test('selects only a current complete terminal provider artifact for the headline', async () => {
  const root = await mkdtemp(join(tmpdir(), 'audit-evaluation-inspector-'));
  temporaryRoots.push(root);
  await writeArtifact(root, completeRun('complete-run'), true);
  const inspection = await inspectEvaluationArtifacts({
    outputRoot: root,
    expectedBenchmarkProtocolFingerprint: protocol,
  });
  expect(inspection.headlines).toContainEqual(
    expect.objectContaining({
      planProfile: 'planning-generated',
      status: 'scoreable-completed',
      runId: 'complete-run',
    }),
  );
});

test('reports protocol mismatch rather than using a stale result', async () => {
  const root = await mkdtemp(join(tmpdir(), 'audit-evaluation-inspector-mismatch-'));
  temporaryRoots.push(root);
  await writeArtifact(root, completeRun('stale-run'), true);
  const inspection = await inspectEvaluationArtifacts({
    outputRoot: root,
    expectedBenchmarkProtocolFingerprint: '7'.repeat(64),
  });
  expect(inspection.headlines).toContainEqual(
    expect.objectContaining({ planProfile: 'planning-generated', status: 'protocol-mismatch' }),
  );
});

test('distinguishes an orphaned semantic checkpoint from a provider-network failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'audit-evaluation-inspector-stopped-'));
  temporaryRoots.push(root);
  const orphaned = RealWorldEvaluationRunSchema.parse({
    ...completeRun('orphaned-semantic'),
    trials: completeRun('orphaned-semantic-trial').trials.map((trial) => ({
      ...trial,
      semanticPlanMeasurement: {
        status: 'incomplete',
        identity:
          trial.semanticPlanMeasurement?.status === 'completed'
            ? trial.semanticPlanMeasurement.identity
            : undefined,
        errorCode: 'provider-failure',
        modelObservation: semanticObservation,
      },
    })),
    measurementState: {
      workflow: 'complete',
      semanticPlan: 'incomplete',
      finding: 'not-applicable',
    },
    diagnosticGatePassed: false,
  });
  await writeArtifact(root, orphaned, false);
  const orphanedInspection = await inspectEvaluationArtifacts({
    outputRoot: root,
    expectedBenchmarkProtocolFingerprint: protocol,
  });
  expect(orphanedInspection.headlines).toContainEqual(
    expect.objectContaining({
      planProfile: 'planning-generated',
      status: 'orphaned-semantic-checkpoint',
      runId: 'orphaned-semantic',
    }),
  );
  const failed = RealWorldEvaluationRunSchema.parse({
    ...completeRun('provider-network'),
    finishedAt: '2026-08-04T12:00:02.000Z',
    trials: completeRun('provider-network-trial').trials.map((trial) => ({
      ...trial,
      status: 'failed',
      semanticPlanMeasurement: { status: 'not-reached', reason: 'product-not-closed' },
      pathReachability: null,
      planKeys: [],
      errorCode: 'provider-network',
    })),
    reliability: {
      ...completeRun('provider-network-reliability').reliability,
      completedTrials: 0,
      failedTrials: 1,
      completionRate: 0,
      allTerminalDurationMsMedian: 1,
      allTerminalDurationMsP95: 1,
      completedDurationMsMedian: null,
      completedDurationMsP95: null,
    },
    measurementState: {
      workflow: 'incomplete',
      semanticPlan: 'incomplete',
      finding: 'not-applicable',
    },
    diagnosticGatePassed: false,
  });
  await writeArtifact(root, failed, false);
  const inspection = await inspectEvaluationArtifacts({
    outputRoot: root,
    expectedBenchmarkProtocolFingerprint: protocol,
  });
  expect(inspection.headlines).toContainEqual(
    expect.objectContaining({
      planProfile: 'planning-generated',
      status: 'failed',
      runId: 'provider-network',
    }),
  );
});
