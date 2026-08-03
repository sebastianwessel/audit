# Scenario-level planning evaluation migration

## Decision

`CorpusAnswerKeySchema` advances from v3 to v4. It removes the independent `expectedPlanCategories` and `relevantPaths` fields and replaces them with evaluator-only `expectedPlanScenarios`.

Each scenario has a stable identifier, exactly one feature-owned language-neutral attack category, and one-or-more relevant source paths. It must bind a same-category expected finding on one of its paths. A dual review compares the exact sorted scenario set as part of its judgment.

## Scoring contract

The scorer assigns generated enabled vectors to expected scenarios one-to-one. A match requires the vector's declared category to equal the scenario category and its scope globs to cover every scenario path. One broad vector may not satisfy several scenarios. Metrics are scenario precision, recall, F1, matched/missed scenario counts, matched-path coverage, and unnecessary-vector count.

The scorer does not inspect source, parse code, compare model prose, use answer keys in product workflows, or infer a security property. It only compares evaluator-owned scenario metadata to the generated vector's declared category and scope after the planner session has closed.

## Taxonomy and corpus impact

The central product taxonomy adds `memory-safety`, `resource-exhaustion`, and `object-integrity`. The current source-only corpus migrates prototype-pollution cases to `object-integrity`, the Juliet bounds case to `memory-safety`, and image-allocation exhaustion to `resource-exhaustion`. Reviewed-plan fixtures and expected findings use the same taxonomy so audit-only measurement remains coherent.

All previously persisted v3 answer keys and provider evaluation artifacts are intentionally incompatible. The corpus pack versions advance, prompt protocol changes through taxonomy guidance, and provider comparisons must use fresh artifacts. This is a development-stage breaking change; no compatibility or migration reader is retained.

## Verification

- Strict v4 schema rejects legacy category/path keys, duplicate scenarios, ungrounded scenarios, and nonmatching dual reviews.
- Offline scorer tests prove one vector cannot cover multiple scenarios.
- Deterministic corpus and full test/spec/schema checks remain provider-free.
- A real-provider run is deferred until these checks pass; it is one separately capped planning-only confirmation and is not a provider-quality claim.
