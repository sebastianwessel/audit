import type {
  JsonValue,
  ModelProvider,
  ObjectRequest,
  ObjectResponse,
  ToolCallSpec,
} from '@purista/harness';

import type { DeterministicCorpusFixturePack } from './corpus.js';
import type { CorpusSplit, PlanEvaluationProfile } from './corpus.schema.js';

/**
 * Builds a known-good in-product provider for pipeline regression checks.
 * It is deliberately labeled deterministic: it proves evaluator wiring, never model quality.
 */
export async function createDeterministicCorpusProvider(
  pack: DeterministicCorpusFixturePack,
  split: CorpusSplit,
  repetitions: number,
): Promise<DeterministicCorpusProvider> {
  const provider = new DeterministicCorpusProvider();
  await enqueueDeterministicCorpusResponses(pack, split, repetitions, provider);
  return provider;
}

export async function enqueueDeterministicCorpusResponses(
  pack: DeterministicCorpusFixturePack,
  split: CorpusSplit,
  repetitions: number,
  sink: Readonly<{ enqueue: (response: ObjectResponse<JsonValue>) => void }>,
  planProfile: PlanEvaluationProfile = 'end-to-end-generated',
): Promise<void> {
  for (const loaded of pack.cases.filter((entry) => entry.case.split === split)) {
    for (const _variant of variantsFor(loaded.case.sourceDirectories)) {
      const reviewedVector = loaded.reviewedPlan.vectors[0];
      if (planProfile === 'audit-reviewed-plan' && reviewedVector === undefined) {
        throw new Error(`Missing deterministic vector fixture for ${loaded.case.caseId}.`);
      }
      const draft =
        planProfile === 'audit-reviewed-plan'
          ? reviewedVector
          : {
              title: 'Evaluate bounded reviewed security evidence',
              rationale:
                'Deterministic evaluation fixture covers an adjudicated source-bound risk.',
              enabled: true,
              scopeGlobs: ['**/*'],
              reviewObligations: [
                {
                  obligationId: 'deterministic-obligation-01',
                  riskStatement:
                    'A source-backed security risk may be present in the approved scope.',
                  evidenceRequirement:
                    'The review must identify bounded source evidence for the risk.',
                },
              ],
              limitations: ['Deterministic fixture output; not a model-quality result.'],
            };
      if (draft === undefined)
        throw new Error(`Missing deterministic vector for ${loaded.case.caseId}.`);
      for (let repetition = 0; repetition < repetitions; repetition += 1) {
        if (planProfile !== 'audit-reviewed-plan') {
          sink.enqueue(toolInspectionResponse());
          sink.enqueue(
            response({
              vectors: [
                {
                  title: draft.title,
                  rationale: draft.rationale,
                  enabled: draft.enabled,
                  scopeGlobs: draft.scopeGlobs,
                  reviewObligations: draft.reviewObligations,
                  limitations: draft.limitations,
                },
              ],
            }),
          );
        }
        if (planProfile !== 'planning-generated') {
          sink.enqueue(toolInspectionResponse());
          sink.enqueue(
            response({
              facts: [],
              controlCoverage: draft.reviewObligations.map((obligation) => ({
                obligationId: obligation.obligationId,
                controlFactIds: [],
              })),
              unansweredPlanObligations: [],
              limitations: [
                'Deterministic provider makes no semantic claim after scoped inspection.',
              ],
            }),
          );
        }
      }
    }
  }
}

/** Minimal provider avoids importing harness testing internals into a runnable command. */
export class DeterministicCorpusProvider implements ModelProvider {
  public readonly id = 'deterministic-corpus-fixture';
  public readonly genAiSystem = 'deterministic-corpus-fixture';
  private readonly queue: ObjectResponse<JsonValue>[] = [];

  public enqueue(response: ObjectResponse<JsonValue>): void {
    this.queue.push(response);
  }

  public async object<T extends JsonValue = JsonValue>(
    _request: ObjectRequest<T>,
  ): Promise<ObjectResponse<T>> {
    const response = this.queue.shift();
    if (response === undefined)
      throw new Error('Deterministic corpus provider response queue is empty.');
    return response as ObjectResponse<T>;
  }
}

function response(object: JsonValue): ObjectResponse<JsonValue> {
  return {
    object,
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: 'stop',
  };
}

function toolInspectionResponse(): ObjectResponse<JsonValue> {
  const toolCall: ToolCallSpec = {
    id: 'deterministic-source-inspection',
    name: 'repo_grep',
    arguments: {
      pattern: '__audit_deterministic_no_match__',
      mode: 'literal',
      caseSensitive: true,
    },
  };
  return { ...response({}), toolCalls: [toolCall] };
}

function variantsFor(sourceDirectories: {
  vulnerable: string;
  patched?: string;
  benign?: string;
}): Array<'vulnerable' | 'patched' | 'benign'> {
  return [
    'vulnerable',
    ...(sourceDirectories.patched === undefined ? [] : (['patched'] as const)),
    ...(sourceDirectories.benign === undefined ? [] : (['benign'] as const)),
  ];
}
