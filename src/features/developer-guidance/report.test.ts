import { expect, test } from 'bun:test';

import { renderDeveloperGuidanceMarkdown } from './report.js';

test('renders source-minimal advisory guidance', () => {
  const markdown = renderDeveloperGuidanceMarkdown({
    schemaVersion: 3,
    guidanceId: 'guidance-001',
    runId: 'run-001',
    reportId: 'report-001',
    reportDigest: 'a'.repeat(64),
    planId: 'plan-001',
    planDigest: 'b'.repeat(64),
    targetFingerprint: 'c'.repeat(64),
    contextDigest: 'd'.repeat(64),
    generatedAt: '2026-08-03T12:00:00.000Z',
    items: [
      {
        findingId: 'finding-001',
        findingFingerprint: 'e'.repeat(64),
        vectorId: 'vector-001',
        status: 'completed',
        recommendedPriority: 'high',
      },
    ],
    modelObservation: {
      usage: {
        modelCallCount: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
      },
      cost: { estimatedCostUsd: null, totalTokens: 0, source: 'unavailable' },
      toolUsage: {
        toolCallCount: 0,
        listFilesCallCount: 0,
        readFileCallCount: 0,
        grepFilesCallCount: 0,
        successfulReadFileCallCount: 0,
        successfulGrepFilesCallCount: 0,
        rejectedCallCount: 0,
        returnedBytes: 0,
      },
      cacheRoutingEnabled: false,
      stages: [],
    },
  });
  expect(markdown).toContain('Recommended priority (advisory): **high**');
  expect(markdown).toContain('does not change the audit result');
  expect(markdown).not.toContain('The boundary is security-sensitive.');
});
