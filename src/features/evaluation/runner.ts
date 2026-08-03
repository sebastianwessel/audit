import { sha256 } from '../../shared/contracts/core.js';
import { createPlan } from '../attack-planning/plan.js';
import { runAudit } from '../audit-execution/audit.js';
import {
  type EvaluationFixture,
  type EvaluationPack,
  EvaluationPackSchema,
  type EvaluationRun,
  EvaluationRunSchema,
} from './evaluation.schema.js';
import { starterFixturePack } from './fixtures.js';
import { aggregateMetrics, macroMetrics, scoreFixture } from './scorer.js';

const startedAt = '2026-07-27T12:00:00.000Z';
const finishedAt = '2026-07-27T12:00:00.000Z';
const contextDigest = sha256('evaluation-no-context');

function fixtureFingerprint(fixture: EvaluationFixture): string {
  return sha256(fixture.sources.map((source) => `${source.path}\0${source.content}`).join('\0'));
}

async function auditFixture(fixture: EvaluationFixture, index: number) {
  const targetFingerprint = fixtureFingerprint(fixture);
  const plan = createPlan({
    targetFingerprint,
    contextDigest,
    targetDisplayName: fixture.caseId,
    inventorySummary: {
      fileCount: fixture.sources.length,
      totalBytes: fixture.sources.reduce((sum, source) => sum + source.content.length, 0),
      languageHints: [fixture.language],
    },
    createdAt: startedAt,
    vectors: [
      {
        title: 'Review bounded static security evidence',
        rationale: 'Evaluate the fixture through the language-neutral review protocol.',
        enabled: true,
        scopeGlobs: ['**/*'],
        reviewObligations: [
          {
            obligationId: 'fixture-obligation-01',
            riskStatement: 'A source-backed security risk may be present in the approved scope.',
            evidenceRequirement: 'The review must identify bounded source evidence for the risk.',
          },
        ],
        limitations: [],
      },
    ],
  });
  const report = await runAudit({
    plan,
    targetFingerprint,
    contextDigest,
    sources: fixture.sources,
    runId: `evaluation-case-${index + 1}`,
    generatedAt: finishedAt,
    investigate: async (_request) => ({
      seeds: [],
      closures: [],
    }),
    verify: async () => ({
      decision: 'incomplete',
      reason: 'The fixture runner does not simulate a semantic verifier.',
      verifiedEvidence: null,
      verifiedPlanObligations: [],
    }),
    countercheck: async () => ({
      decision: 'incomplete',
      reason: 'The fixture runner does not simulate a semantic countercheck.',
      verifiedEvidence: null,
      verifiedPlanObligations: [],
    }),
  });
  return {
    report,
    metrics: scoreFixture(fixture, report.findings),
  };
}

export async function runFixtureEvaluation(
  pack: EvaluationPack = starterFixturePack,
): Promise<EvaluationRun> {
  const validatedPack = EvaluationPackSchema.parse(pack);
  const caseOutcomes = await Promise.all(
    validatedPack.cases.map(async (fixture, index) => {
      const result = await auditFixture(fixture, index);
      return {
        caseId: fixture.caseId,
        variant: fixture.variant,
        expectedCount: fixture.expectedFindings.length,
        reportedCount: result.report.findings.length,
        metrics: result.metrics,
      };
    }),
  );
  const perCaseMetrics = caseOutcomes.map((outcome) => outcome.metrics);
  const micro = aggregateMetrics(perCaseMetrics);
  return EvaluationRunSchema.parse({
    schemaVersion: 1,
    runId: 'evaluation-run-starter',
    packId: validatedPack.packId,
    packVersion: validatedPack.packVersion,
    mode: 'fixture',
    provider: 'no-provider-contract-runner',
    startedAt,
    finishedAt,
    caseOutcomes,
    micro,
    macro: macroMetrics(perCaseMetrics),
    gatePassed: false,
    safetyViolations: 0,
  });
}
