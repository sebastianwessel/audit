import { createStableId } from '../../src/shared/contracts/core.js';
import {
  type StageIsolatedProductStageOutput,
  StageIsolatedProductStageOutputSchema,
  type StageIsolatedProductStageRoleLocalization,
  stageIsolatedProductOutputFingerprint,
} from './stage-isolated-adjudication-agent.contract.js';

/**
 * Converts already-validated product fields into the evaluator's ephemeral,
 * source-free semantic view. It deliberately omits source evidence, paths,
 * ranges, snippets, tool data, and terminal admission decisions.
 */
export function projectStageIsolatedProductResult(input: {
  stage: StageIsolatedProductStageOutput['stage'];
  stageResultId: string;
  semanticClaims: readonly Readonly<{
    claim: string;
    roles: readonly StageIsolatedProductStageRoleLocalization['role'][];
  }>[];
}): StageIsolatedProductStageOutput {
  const outputs = input.semanticClaims.map((entry, index) => {
    const productOutputId = createStableId(
      'stage-output',
      JSON.stringify([input.stage, input.stageResultId, index, entry.claim]),
    );
    return { productOutputId, semanticClaim: entry.claim };
  });
  const roleLocalizations = input.semanticClaims.flatMap((entry, index) => {
    const productOutputId = outputs[index]?.productOutputId;
    if (productOutputId === undefined) return [];
    return entry.roles.map((role) => ({
      localizationId: createStableId(
        'stage-localization',
        JSON.stringify([input.stage, input.stageResultId, index, role]),
      ),
      productOutputId,
      role,
    }));
  });
  return StageIsolatedProductStageOutputSchema.parse({
    stage: input.stage,
    stageResultId: input.stageResultId,
    stageResultFingerprint: stageIsolatedProductOutputFingerprint({
      stage: input.stage,
      stageResultId: input.stageResultId,
      outputs,
      roleLocalizations,
    }),
    outputs,
    roleLocalizations,
  });
}
