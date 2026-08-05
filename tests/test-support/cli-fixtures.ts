import { createPlan } from '../../src/features/attack-planning/index.js';
import { sha256 } from '../../src/shared/contracts/core.js';

/** Shared immutable plan fixture for command-run binding tests. */
export function createDiscardPlan(targetFingerprintSeed: string) {
  return createPlan({
    targetFingerprint: sha256(targetFingerprintSeed),
    contextDigest: 'b'.repeat(64),
    targetDisplayName: 'discard fixture',
    createdAt: '2026-08-04T12:00:00.000Z',
    inventorySummary: { fileCount: 1, totalBytes: 1, languageHints: [] },
    vectors: [
      {
        title: 'Review discard fixture',
        rationale: 'Private work needs an exact immutable binding.',
        enabled: true,
        scopeGlobs: ['source.unknown'],
        reviewObligations: [
          {
            obligationId: `discard-obligation-${targetFingerprintSeed}`,
            riskStatement: 'The private run must not be removed by another run.',
            evidenceRequirement: 'The immutable plan binding must match.',
          },
        ],
        limitations: [],
      },
    ],
  });
}
