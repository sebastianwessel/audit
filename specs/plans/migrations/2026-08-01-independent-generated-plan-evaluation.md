# Independent generated-plan evaluation

## Decision

Provider evaluation has two measurement scopes with one unchanged source-free evaluator boundary:

1. `full-workflow` generates a normal draft plan, records its plan score as soon as planning completes, applies the evaluator approval fixture, then measures audit findings separately.
2. `planning-only` runs only the normal planner for each selected isolated case variant and repetition. It scores the generated draft after the planner session closes and does not construct an approval, audit, reviewed plan, verifier route, finding score, or report admission funnel.

Both scopes retain only source-free normalized plan keys, deterministic category/path score, stage observation, cost, duration, terminal status, and stable error code. The answer key remains evaluator-only and never enters a target jail, planner prompt, repository tool, output, checkpoint visible to the agent, or product path. `planning-only` is diagnostic on the current corpus and does not create a provider-quality or release claim.

## Acceptance

- Each generated-plan trial records whether its human-adjudicated expected categories and relevant paths were fully covered, even when later full-workflow audit coverage is incomplete.
- Planning-only retries/resumes only exact-bound planning checkpoints and never dispatches audit work.
- Reports show plan coverage separately from finding coverage; planning-only clearly marks finding metrics not applicable.
- Plan metrics remain deterministic provenance checks, not a language rule or semantic security conclusion.
