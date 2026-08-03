import { describe, expect, test } from 'bun:test';
import { EvaluationFixtureSchema } from './evaluation.schema.js';
import { starterFixturePack } from './fixtures.js';
import { runFixtureEvaluation } from './runner.js';

describe('fixture evaluation runner', () => {
  test('reports the fixture harness without inventing a semantic detection score', async () => {
    const first = await runFixtureEvaluation(starterFixturePack);
    const second = await runFixtureEvaluation(starterFixturePack);
    expect(first).toEqual(second);
    expect(first.micro).toMatchObject({
      truePositives: 0,
      falsePositives: 0,
      falseNegatives: 11,
      precision: null,
      recall: 0,
      f1: null,
    });
    expect(first.gatePassed).toBe(false);
    expect(first.caseOutcomes).toHaveLength(13);
    expect(new Set(first.caseOutcomes.map((outcome) => outcome.variant))).toEqual(
      new Set(['vulnerable', 'fixed', 'benign']),
    );
  });

  test('accepts a normalized target language without making the reviewer language-specific', () => {
    const fixture = EvaluationFixtureSchema.parse({
      ...starterFixturePack.cases[0],
      caseId: 'java-query-case',
      language: 'Java',
    });
    expect(fixture.language).toBe('java');
  });
});
