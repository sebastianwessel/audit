import { describe, expect, test } from 'bun:test';
import type { Finding } from '../audit-execution/audit.schema.js';
import { starterFixturePack } from './fixtures.js';
import { scoreFixture } from './scorer.js';

describe('evaluation scorer', () => {
  test('scores the vulnerable fixture as a true positive', () => {
    const fixture = starterFixturePack.cases[0];
    if (fixture === undefined) throw new Error('Missing vulnerable fixture.');
    const finding: Finding = {
      findingId: 'finding-test',
      vectorId: 'vector-injection-test',
      statement: 'query',
      evidence: [
        { path: 'src/query.ts', startLine: 1, endLine: 1, snippet: 'query', kind: 'source' },
      ],
      planObligations: [{ obligationId: 'fixture-obligation-01' }],
      limitations: [],
      status: 'accepted',
      verification: {
        status: 'verified',
        reason: 'Fixture source evidence is valid.',
        checks: ['approved-obligation', 'scope', 'source-path', 'line-range', 'source-snippet'],
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
