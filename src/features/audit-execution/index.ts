/** Public cross-feature interface for the audit execution domain. */

export * from './audit.js';
export * from './audit.schema.js';
export { runCandidateGroundingStage } from './candidate-grounding/stage/index.js';
export type { AuditResumeState } from './checkpoints.js';
export * from './cli-persistence.js';
export {
  runEvidenceMapRepairStage,
  runEvidenceMapStage,
} from './evidence-map/stage/index.js';
export * from './evidence-reference.js';
export { selectScopedSourcePaths } from './investigation/scope.js';
export { runInvestigationStage } from './investigation/stage/index.js';
export * from './model-stage-observations.js';
export { modelStagesForAudit } from './model-stage-observations.js';
export type { SourceEvidenceResolver } from './source-evidence-resolver.js';
export { createSourceEvidenceResolver } from './source-evidence-resolver.js';
export { runSourcePostureStage } from './source-posture/stage/index.js';
export * from './terminal-classification.js';
export { runVerificationStage } from './verification/stage/index.js';
