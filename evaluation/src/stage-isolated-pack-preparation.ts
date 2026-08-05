import { reviewWorkflowPromptProtocolFingerprint } from '../../src/features/review-workflow/prompt-protocol.js';
import type { LoadedCorpusCase, LoadedCorpusPack } from './corpus.js';
import { buildStageIsolatedCanonicalInput } from './stage-isolated.js';
import { stageIsolatedAdjudicationAgentProtocolFingerprint } from './stage-isolated-adjudication-agent.instructions.js';
import { prepareStageIsolatedCanonicalFixture } from './stage-isolated-canonical-fixture.js';
import type { StageIsolatedDiagnosticPackDescriptor } from './stage-isolated-diagnostic-pack.schema.js';
import { stageIsolatedDiagnosticStageProtocolFingerprint } from './stage-isolated-protocol.js';
import {
  type StageIsolatedPreparedDiagnosticPack,
  StageIsolatedPreparedDiagnosticPackSchema,
} from './stage-semantic-pack.schema.js';

/**
 * Rebuilds the sealed identities of an existing evaluator-private diagnostic
 * pack from its checksummed corpus fixture and the currently live protocols.
 * Its rubric stays evaluator-owned input: this operation never derives or
 * changes an expected outcome.
 */
export async function prepareStageIsolatedDiagnosticPack(input: {
  descriptor: StageIsolatedDiagnosticPackDescriptor;
  corpus: LoadedCorpusPack;
  loadedCase: Pick<LoadedCorpusCase, 'case' | 'reviewedPlan'>;
  existingPack: StageIsolatedPreparedDiagnosticPack;
}): Promise<StageIsolatedPreparedDiagnosticPack> {
  const canonical = buildStageIsolatedCanonicalInput(
    await prepareStageIsolatedCanonicalFixture({
      descriptor: input.descriptor,
      corpus: input.corpus,
      loadedCase: input.loadedCase,
    }),
  );
  return StageIsolatedPreparedDiagnosticPackSchema.parse({
    schemaVersion: 1,
    pack: {
      ...input.existingPack.pack,
      packId: input.descriptor.diagnosticId,
      stage: input.descriptor.stage,
      planProfile: input.descriptor.planProfile,
      corpusPackId: input.descriptor.corpusPackId,
      corpusPackVersion: input.descriptor.corpusPackVersion,
      corpusManifestFingerprint: input.descriptor.corpusManifestFingerprint,
      caseId: input.descriptor.caseId,
      variant: input.descriptor.variant,
      corpusSourceDigest: input.descriptor.corpusSourceDigest,
      targetFingerprint: input.descriptor.targetFingerprint,
      workflowProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
      stageProtocolFingerprint: stageIsolatedDiagnosticStageProtocolFingerprint(
        input.descriptor.stage,
      ),
      evaluatorProtocolFingerprint: stageIsolatedAdjudicationAgentProtocolFingerprint,
      productInput: {
        ...input.existingPack.pack.productInput,
        fingerprint: canonical.fingerprint,
      },
    },
    canonicalInputFingerprint: canonical.fingerprint,
    rubric: input.existingPack.rubric,
  });
}
