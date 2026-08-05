import { describe, expect, test } from 'bun:test';
import type { Finding } from '../../src/features/audit-execution/audit.schema.js';
import { starterFixturePack } from './fixtures.js';
import { scoreFixture } from './scorer.js';

describe('evaluation scorer', () => {
  test('scores the vulnerable fixture as a true positive', () => {
    const fixture = starterFixturePack.cases[0];
    if (fixture === undefined) throw new Error('Missing vulnerable fixture.');
    const finding: Finding = {
      findingId: 'finding-test',
      vectorId: 'vector-injection-test',
      narrative: {
        statement: 'The reviewed operation may be reached with an unsafe condition.',
        roleExplanations: [
          { role: 'operation', explanation: 'The operation evidence identifies the action.' },
          {
            role: 'unsafe-condition',
            explanation: 'The condition evidence identifies the unsafe state.',
          },
        ],
        limitations: [],
      },
      claimEvidenceBundles: [
        {
          role: 'operation',
          evidence: [
            {
              path: 'src/query.ts',
              startLine: 1,
              endLine: 1,
              contentDigest: 'a'.repeat(64),
              kind: 'source',
              role: 'operation',
            },
          ],
        },
        {
          role: 'unsafe-condition',
          evidence: [
            {
              path: 'src/query.ts',
              startLine: 1,
              endLine: 1,
              contentDigest: 'a'.repeat(64),
              kind: 'source',
              role: 'unsafe-condition',
            },
          ],
        },
      ],
      planObligations: [{ obligationId: 'fixture-obligation-01' }],
      status: 'accepted',
      verification: {
        status: 'verified',
        checks: [
          'approved-obligation',
          'scope',
          'source-path',
          'line-range',
          'source-content-digest',
        ],
      },
    };
    expect(scoreFixture(fixture, [finding])).toMatchObject({
      truePositives: 1,
      falsePositives: 0,
      falseNegatives: 0,
      precision: 1,
      recall: 1,
      f1: 1,
    });
  });

  test('returns null for undefined metrics', () => {
    const fixture = starterFixturePack.cases[1];
    if (fixture === undefined) throw new Error('Missing fixed fixture.');
    expect(scoreFixture(fixture, []).precision).toBeNull();
    expect(scoreFixture(fixture, []).recall).toBeNull();
  });
});
