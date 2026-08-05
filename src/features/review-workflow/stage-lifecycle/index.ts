/** Shared runtime lifecycle for semantic model stages. */
export * from '../runtime/context-overflow.js';
export * from '../runtime/retry-guidance.js';
export * from '../stages/scoped-evidence.js';
export {
  type EvaluatorFailureDiagnosticSink,
  projectScopedModelOutput,
  runScopedModelStage,
  type ScopedModelStageOverflowTopologyBase,
} from '../stages/scoped-model-stage.js';
export { scopedInspectionRequirement } from '../tools/contract.js';
