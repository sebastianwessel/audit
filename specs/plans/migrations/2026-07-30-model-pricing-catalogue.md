# Model pricing catalogue migration

Date: 2026-07-30

CAP-064 replaces user-supplied token-price environment variables with a generated, versioned LiteLLM pricing snapshot under `src/features/model-operations/`. It covers the supported OpenAI and Anthropic provider families, resolves only exact normalized provider/model pairs, and retains a documented exact supplemental entry when a current provider model is not yet present upstream. Unknown models yield explicit unavailable cost rather than a guessed sibling-model price.

`bun run update:model-pricing` downloads the upstream catalogue and reports the deterministic snapshot diff without writing. `bun run update:model-pricing:write` is the only refresh action and writes the reviewed snapshot. This contributor operation is outside the audit harness and is never a default CI, plan, audit, report, corpus, or provider-evaluation action. Product runtime remains network-free with respect to pricing.

The configuration adapter no longer reads primary or verifier pricing variables. Existing persisted artifacts using the historical `configured` cost-source enum remain readable, but newly generated artifacts use `catalogue`, `mixed`, or `unavailable` according to the existing aggregation contract. This is an operational accounting migration; it does not affect target access, evidence, prompts, finding admission, model selection, or language-neutral review behavior.
