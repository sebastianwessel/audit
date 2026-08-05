import { createStableId, sha256 } from '../../../shared/contracts/core.js';
import type { SourcePosture } from './contract.js';

/** The feature, never a model, owns canonical posture assessment identities. */
export function sourcePostureAssessmentId(vectorId: string, obligationId: string): string {
  return createStableId('posture', `${vectorId}\0${obligationId}`);
}

/** Exact identity of canonical candidate-blind posture for checkpoint dependency binding. */
export function sourcePostureFingerprint(sourcePosture: SourcePosture): string {
  return sha256(
    JSON.stringify({
      assessments: sourcePosture.assessments.map((assessment) => ({
        assessmentId: assessment.assessmentId,
        obligationId: assessment.obligationId,
        conclusion: assessment.conclusion,
        summary: assessment.summary,
        evidenceMapFactIds: assessment.evidenceMapFactIds,
        notApplicableReason: assessment.notApplicableReason,
        limitations: assessment.limitations,
      })),
      limitations: sourcePosture.limitations,
    }),
  );
}
