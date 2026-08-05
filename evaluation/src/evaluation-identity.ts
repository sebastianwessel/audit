import type { VerificationMode } from '../../src/platform/configuration/environment.js';
import type { HarnessExecutionConfiguration } from '../../src/platform/harness/audit-harness.js';
import { canonicalJson, sha256 } from '../../src/shared/contracts/core.js';

import type { LoadedCorpusPack } from './corpus.js';
import type { CorpusSplit, PlanEvaluationProfile } from './corpus.schema.js';
import type { SemanticPlanEvaluatorIdentity } from './plan-semantic-identity.schema.js';

type EvaluationIdentitySelection = Readonly<{
  pack: LoadedCorpusPack;
  split: CorpusSplit;
  caseIdFilter?: string;
}>;

function selectedCases(input: EvaluationIdentitySelection) {
  return input.pack.cases.filter(
    (loaded) =>
      loaded.case.split === input.split &&
      (input.caseIdFilter === undefined || loaded.case.caseId === input.caseIdFilter),
  );
}

/** Exact selected source population; never derived from a mutable pack label alone. */
export function evaluationPopulationDigest(input: EvaluationIdentitySelection): string {
  const selected = selectedCases(input);
  return sha256(
    canonicalJson(
      selected.map((loaded) => ({
        caseId: loaded.case.caseId,
        projectId: loaded.case.projectId,
        sourceDigests: loaded.case.sourceDigests,
        transformedContentDigest: loaded.case.transformedContentDigest,
      })),
    ),
  );
}

/**
 * Binds evaluator-only material that changes scoring or reviewed-plan audit
 * routing while keeping it outside the agent-visible target population.
 */
function evaluatorFixtureDigest(
  input: EvaluationIdentitySelection & Readonly<{ planProfile: PlanEvaluationProfile }>,
): string {
  return sha256(
    canonicalJson(
      selectedCases(input).map((loaded) => ({
        caseId: loaded.case.caseId,
        answerKeyDigest: sha256(canonicalJson(loaded.answerKey)),
        ...(input.planProfile === 'audit-reviewed-plan'
          ? { reviewedPlanDigest: sha256(canonicalJson(loaded.reviewedPlan)) }
          : {}),
      })),
    ),
  );
}

/**
 * Frozen source-free benchmark configuration. It binds the exact corpus
 * content and selected source population to every factor that can alter a
 * provider evaluation, without including credentials, prompts, or source.
 */
export function evaluationBenchmarkProtocolFingerprint(input: {
  pack: LoadedCorpusPack;
  split: CorpusSplit;
  caseIdFilter?: string;
  mode: 'deterministic' | 'provider';
  provider: string;
  model: string;
  verificationMode: VerificationMode;
  verificationRouteFingerprint: string;
  repetitions: number;
  planProfile: PlanEvaluationProfile;
  executionBudget: HarnessExecutionConfiguration;
  maxParallelVectors: number;
  promptProtocolFingerprint: string;
  semanticPlanEvaluator: SemanticPlanEvaluatorIdentity | null;
}): string {
  return sha256(
    canonicalJson({
      corpusManifestDigest: input.pack.manifest.manifestDigest,
      populationDigest: evaluationPopulationDigest(input),
      evaluatorFixtureDigest: evaluatorFixtureDigest(input),
      mode: input.mode,
      provider: input.provider,
      model: input.model,
      verificationMode: input.verificationMode,
      verificationRouteFingerprint: input.verificationRouteFingerprint,
      repetitions: input.repetitions,
      planProfile: input.planProfile,
      executionBudget: input.executionBudget,
      maxParallelVectors: input.maxParallelVectors,
      promptProtocolFingerprint: input.promptProtocolFingerprint,
      semanticPlanEvaluator: input.semanticPlanEvaluator,
    }),
  );
}
