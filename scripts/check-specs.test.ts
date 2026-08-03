import { expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const required = [
  'docs/README.md',
  'docs/01-overview/README.md',
  'src/features/attack-planning/README.md',
  'src/features/evaluation/README.md',
  'src/platform/filesystem/README.md',
  'tests/integration/README.md',
  'evaluation/fixtures/cases/ts-unsafe-query/case.json',
];

test('bootstrap keeps public docs and the vertical-slice structure', async () => {
  for (const path of required) {
    expect(await Bun.file(path).exists()).toBe(true);
  }
});

test('normative contracts use only the canonical obligation and posture vocabulary', async () => {
  const paths = [
    'AGENTS.md',
    '.agent/IMPLEMENTATION.md',
    'specs/01-product/01-scope-and-workflow.md',
    'specs/03-architecture/01-system-architecture.md',
    'specs/03-architecture/02-evidence-fact-pipeline.md',
    'specs/03-architecture/03-plan-anchored-semantic-review.md',
    'specs/03-architecture/05-evidence-first-review.md',
    'specs/03-architecture/06-candidate-blind-source-posture.md',
    'specs/04-contracts/01-artifact-contracts.md',
  ];
  const retiredTerms = [
    'evidenceQuestionIndex',
    'successCriterionIndex',
    'question-and-success-criterion',
    'one candidate-blind conclusion (`supported`, `contradicted`, or `inconclusive`)',
    'one supported, contradicted, or inconclusive assessment for every vector question',
  ];

  for (const path of paths) {
    const content = await Bun.file(path).text();
    for (const term of retiredTerms) expect(content).not.toContain(term);
  }
});

test('acquisition specifications preserve single-owner state boundaries', async () => {
  const expectations = [
    [
      'specs/02-capabilities/capability-inventory.md',
      'observed upstream source-license status, single-owner state isolation',
    ],
    [
      'specs/08-evaluation/05-control-and-state-corpus-expansion.md',
      'contains no source-snapshot state, human-adjudication state',
    ],
    [
      'specs/04-contracts/01-artifact-contracts.md',
      'contain no target source, source-snapshot state, human-adjudication state',
    ],
  ] as const;
  for (const [path, marker] of expectations) {
    expect(await Bun.file(path).text()).toContain(marker);
  }
  expect(await Bun.file('specs/02-capabilities/capability-inventory.md').text()).not.toContain(
    'license/adjudication-state',
  );
});

test('public documentation does not link to internal repository guidance', async () => {
  const internalPublicDocLink =
    /\]\((?:(?:\.\.?\/)*)(?:specs|\.agent|\.claude)(?:\/|[)#])|\]\((?:(?:\.\.?\/)*)?(?:AGENTS|CLAUDE)\.md(?:[)#])/u;
  const entries = await readdir('docs', { recursive: true });
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const path = join('docs', entry);
    expect(await Bun.file(path).text()).not.toMatch(internalPublicDocLink);
  }
});
