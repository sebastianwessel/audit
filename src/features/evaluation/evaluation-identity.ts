import type { VerificationMode } from '../../platform/configuration/environment.js';
import type { HarnessExecutionConfiguration } from '../../platform/harness/security-reviewer-harness.js';
import { canonicalJson, sha256 } from '../../shared/contracts/core.js';

import type { LoadedCorpusPack } from './corpus.js';
import type {
  CorpusSplit,
  EvaluationMeasurementScope,
  PlanEvaluationProfile,
} from './corpus.schema.js';

/** Exact selected source population; never derived from a mutable pack label alone. */
export function evaluationPopulationDigest(input: {
  pack: LoadedCorpusPack;
  split: CorpusSplit;
  caseIdFilter?: string;
}): string {
  const selected = input.pack.cases.filter(
    (loaded) =>
      loaded.case.split === input.split &&
      (input.caseIdFilter === undefined || loaded.case.caseId === input.caseIdFilter),
  );
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
  measurementScope: EvaluationMeasurementScope;
  executionBudget: HarnessExecutionConfiguration;
  maxParallelVectors: number;
  promptProtocolFingerprint: string;
}): string {
  return sha256(
    canonicalJson({
      corpusManifestDigest: input.pack.manifest.manifestDigest,
      populationDigest: evaluationPopulationDigest(input),
      mode: input.mode,
      provider: input.provider,
      model: input.model,
      verificationMode: input.verificationMode,
      verificationRouteFingerprint: input.verificationRouteFingerprint,
      repetitions: input.repetitions,
      planProfile: input.planProfile,
      measurementScope: input.measurementScope,
      executionBudget: input.executionBudget,
      maxParallelVectors: input.maxParallelVectors,
      promptProtocolFingerprint: input.promptProtocolFingerprint,
    }),
  );
}
