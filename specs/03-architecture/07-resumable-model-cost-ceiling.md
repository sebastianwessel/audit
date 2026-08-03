# Resumable model-cost ceiling

## Purpose

CAP-081 adds an optional operator-selected ceiling for *known estimated* model cost. It limits future model-request dispatch; it is not a source, context, tool, output, or quality limit. It neither changes the executable plan nor drops eligible evidence.

The product must never claim an exact billing guarantee. Provider usage arrives after a response, so the request that takes recorded spend from below the ceiling to at-or-above it is retained and accounted for. No later request may begin. The resulting stage/vector is visibly stopped and non-passing; it can be resumed from its existing checkpoints.

## Operator contract

`plan`, `audit`, and `eval:provider` accept the optional positive decimal `--max-estimated-cost-usd <value>`. The project-local `.env` may set the same default as `SECURITY_REVIEWER_MAX_ESTIMATED_COST_USD`; CLI takes precedence. The value is a ceiling, not a price: model prices still resolve only from the checked-in exact-model catalogue. The default is disabled. There is no product-imposed upper amount: a value is rejected only when it is non-finite, zero, or negative.

When enabled:

1. The selected route must have an exact known catalogue price before target inventory or a provider request. Unknown or unavailable pricing fails preflight without target I/O or a provider call.
2. Product audit execution is serial (`maxParallelVectors` must be `1`). This prevents multiple vector stages being in flight while the ceiling decision is made. A request already in flight can still cross the value; its final observed cost remains the authoritative record.
3. The shared provider boundary checks the run ledger immediately before every model request, including agent-loop calls, normal retry, and provider-signalled context-recovery attempts. It rejects dispatch when accumulated known estimated cost is greater than or equal to the configured ceiling.
4. After each successful provider response, the same boundary records its exact catalogue estimate using the canonical usage/cost functions. Failed requests with no usage do not add an invented cost. A response that crosses the ceiling remains in its stage request ledger.
5. The stable terminal error token is `model-cost-ceiling-reached`. It contains no price, source, prompt, provider body, or request identifier. A stopped stage has a normal content-free observation; a stopped vector is `failed`, has the terminal token, and cannot be treated as a clean no-finding result or a CI pass.

The ceiling does not pre-split, pre-trim, skip, change scopes, change models, or restrict file tools. It must not be used to optimize benchmark output or conceal incomplete coverage.

## Offline provider-evaluation preflight

`bun run eval:provider:preflight` accepts the exact `eval:provider` option grammar and validates the resolved primary and, when selected, independent route before a paid evaluation. It performs no provider construction, network request, artifact write, target execution, or target mutation. It validates credential **presence** only inside the provider-resolution adapter; key values never leave that adapter or appear in its output.

The command fails before corpus work when a selected route lacks its credential or an exact bundled catalogue price. It then validates the corpus manifest, all selected source digests, case selection, measurement-profile restrictions, independent-route distinction, benchmark/config fingerprints, and private-holdout attestation where applicable. Its sole result is a content-free JSON readiness record containing route identities, boolean credential and pricing readiness, selected-case count, corpus identity, and protocol/config fingerprints. It neither creates a resumable checkpoint nor reserves cost. `eval:provider` reuses this same preparation path before it constructs a provider, so preflight and paid execution cannot drift.

## Single ownership and accounting

`features/model-operations/` owns the strict ceiling schema, finite-decimal validation, aggregate-from-observation logic, and the shared pre-dispatch/post-response ledger. It reuses `ModelPricingSchema`, `summarizeModelCost`, and `ModelStageObservationSchema`; it must not duplicate token or cost arithmetic. `review-workflow/stages/scoped-model-stage` mounts that one ledger around every provider request. Product and provider-evaluation runners compose an initial ledger from their reusable checkpoints/drafts or prior trials, and the product CLI writes its source-free terminal state. No other stage, agent, tool, or provider adapter owns a separate budget counter.

The initial ledger includes each previously persisted stage observation exactly once. A terminal vector result supersedes any prior map, posture, or grounding draft for its vector; otherwise the newest reusable phase observations are included. A resumed run may raise, lower, add, or remove the ceiling because the ceiling does not alter semantic evidence or checkpoint compatibility. It always counts retained prior request observations before dispatching further work.

Every new evaluation trial, checkpoint, and final run artifact records the configured ceiling, known accumulated estimated cost, and whether it was reached. A disabled guard is recorded explicitly. Terminal vector coverage retains every completed stage observation before a later stage fails, together with the actual failed phase and stable error token. The report-level aggregate must reconcile exactly to that retained ledger; it never estimates, drops, or substitutes cost data.

## Failure, recovery, and privacy

A ceiling stop is not retryable within the same invocation. `audit --resume --run-id <id> --retry-unfinished true` may continue its exact-bound checkpoints when the operator selects a larger ceiling or disables it. Completed map/posture/grounding and terminal vector checkpoints remain reusable; no completed provider work repeats merely because the ceiling was reached.

The ledger retains only configured ceiling state, boolean reached state, numeric known estimate, and the existing content-free request observations. It never stores a target path, source/context bytes, prompt, tool input/output, raw model output, provider request identifier, secret, or provider error body.

The design deliberately does not promise a charge cap: provider-side billing, retries that return usage only after completion, and the crossing request make that claim false. It promises a deterministic no-further-dispatch point from the observed ledger.

## Acceptance

Acceptance requires colocated tests proving all of the following:

- invalid, zero, non-finite, unavailable-price, and concurrent-vector ceiling configurations fail before target/provider work;
- the guard is shared by planning and every scoped audit stage, including normal retries and context-overflow recovery;
- one crossing response is retained, then no later request starts, with exact content-free accounting;
- a stopped vector is failed and cannot produce an accepted finding or clean CI outcome;
- checkpoint/draft reuse initializes the ledger exactly once and a resumed run can proceed under a changed ceiling;
- manifests surface only the specified source-free fields, while reports retain their existing stage ledger; and
- the no-network preflight rejects missing credentials, absent exact pricing, invalid corpus/selection/attestation, and invalid route configuration without creating a provider, checkpoint, or artifact; and
- full language-neutral scope, file-tool behavior, source/context recovery, pricing provenance, and model-output contracts remain unchanged.
