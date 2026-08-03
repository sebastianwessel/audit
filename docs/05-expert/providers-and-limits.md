# Providers and limits

Purista provides one application-facing harness shape while provider adapters remain optional. This means domain and filesystem tests do not need credentials, and a team can choose a supported provider at runtime.

## Important limits

- Model output is non-deterministic.
- Static analysis cannot prove runtime behavior.
- Large repositories may require more provider recovery work and therefore more time and cost.
- AI calls can be expensive and can fail independently.
- A report with incomplete coverage is not a clean report.
- The bundled Purista Harness patch preserves the configured agent-loop limit. Security Reviewer configures no fixed loop cap or default deadline. An operator-selected non-zero deadline or cancellation is recorded as an operational stop; it is never relabelled as a provider failure or a clean result.

Vector concurrency and parallel tool dispatch are rate-limit queues, not work limits: they bound only simultaneous provider/file operations, and queued work still runs. The reviewer has no total tool-call, agent-round, source-file, source-size, grep-match, result, or applicable-context limit. It does not pre-trim evidence based on estimated context size. This also applies to the evaluation-only countercheck. If the provider explicitly reports that its context window was exceeded, the reviewer retries with deterministic source paths, source ranges, then applicable Markdown context partitions. Context recovery preserves the exact Markdown text and line endings across its partitions. A resumable run stores opaque recovery topology and aggregate child-call telemetry. Evidence mapping, candidate-blind source posture, and candidate grounding store an already validated, redacted child result before recording that child as complete, so an exact restart can continue without repeating it. A saved grounding outcome contains only whether the ephemeral lead was grounded, declined, or structurally rejected plus a validated candidate when one exists; it never stores the lead or raw model response. Other phases never reuse a successful child merely because it appears in recovery telemetry; they repeat it until they have an equally strict validated-artifact contract. If a result cannot be merged without guessing—most importantly, a verifier verdict—the vector is marked incomplete rather than silently losing evidence or inventing a conclusion. Normal retries never broaden file access or admit an invalid response.

## Usage and cost visibility

Every model-backed plan, audit, and provider evaluation records the number of calls plus input, output, cached-input, and reasoning tokens when the provider reports them. The plan is one ledger stage; each vector investigation and independent verification are separate stages, so expensive, slow, or failed work can be located without recording prompts or source. Each stage is labelled with its route (`primary` or the evaluation-only `independent` verifier route), and totals remain separate by route. The JSON run manifest and the report’s **Operational ledger** expose those individual rows. The report also includes an **Operational summary** and a complete **Cost and latency hotspots** table, sorted so the largest optimization opportunities appear first.

For a specific evaluation case, open `case-results.jsonl` beside the report and select its `caseId`, `variant`, and `repetition`. Its ordered trace records every model response and every `repo_list`, `repo_read`, or `repo_grep` call with its operation, completion/rejection state, duration, returned-byte count, stable error code, token use, and cost. This lets you see the exact execution flow behind a score. The trace deliberately excludes prompts, source paths/content, context, tool arguments/results, provider request identifiers, credentials, and raw model output. Cached input is already part of input tokens, not an extra amount.

Cost estimates use a versioned, bundled provider catalogue. You never put token prices in `.env`, and an audit never fetches a price. A contributor can check for price changes or refresh the reviewed snapshot:

```bash
bun run update:model-pricing
bun run update:model-pricing:write
```

The refresh command downloads LiteLLM's public price catalogue, prints its diff, and writes the deterministic snapshot only with `:write`. It supports the project's configured provider families and resolves only an exact normalized provider/model pair. An unlisted model remains explicitly unavailable rather than borrowing a sibling model's price or pretending that it was free.

For an operational stop point, set `SECURITY_REVIEWER_MAX_ESTIMATED_COST_USD` in `.env` or pass `--max-estimated-cost-usd <amount>` to `plan`, `audit`, or `eval:provider`. The command-line value wins. This is an observed-cost dispatch ceiling: after the recorded estimate reaches it, the reviewer starts no later model request and marks remaining work with a visible non-clean status rather than presenting a clean report. The response that crosses the amount is still recorded because providers report usage after responding, so this is not an exact billing guarantee. It requires a known exact-model catalogue price and serial vector execution. Resume the same audit or provider evaluation with `--retry-unfinished true` and a higher ceiling (or no ceiling) to continue from its saved work. The product run manifest records the configured amount, observed total, and whether it was reached.

For OpenAI-compatible configured runs, Security Reviewer supplies a stable provider cache-routing key based only on the product name and model. This can help the provider reuse a repeated prompt prefix. Security Reviewer does not keep its own prompt cache and never writes prompts, source code, tool data, or raw responses to a cache.

Cache routing is not a cache-hit guarantee. Check the reported cached-input token count when measuring the effect for a provider and model.

## Independent verifier experiment

Provider evaluation can optionally use a different configured provider/model pair for verification while planning and investigation remain on the primary route. Set `SECURITY_REVIEWER_VERIFICATION_MODE=independent-route` and provide the verifier provider, model, and API-key variable name in `.env`. The pair must differ from the primary provider/model pair; incomplete or same-route configuration stops before any repository is opened. Both routes resolve their prices from the same bundled catalogue.

This mode is deliberately unavailable to normal `plan` and `audit` commands. It is an experiment for comparing verification diversity on a human-reviewed corpus, not an assurance that a target is safer.
