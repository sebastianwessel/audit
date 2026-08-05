# Resumable model-cost ceiling

## Purpose

CAP-081 adds an optional operator-selected ceiling for *known estimated* model cost. It limits future model-request dispatch; it is not a source, context, tool, output, or quality limit. It neither changes the executable plan nor drops eligible evidence.

The product must never claim an exact billing guarantee. Provider usage arrives after a response, so the request that takes recorded spend from below the ceiling to at-or-above it is retained and accounted for. No later request may begin. The resulting stage/vector is visibly stopped and non-passing; it can be resumed from its existing checkpoints.

## Operator contract

The project-local `.env` may set the optional positive decimal `AUDIT_MAX_ESTIMATED_COST_USD`. It is resolved once by the configuration adapter and applies consistently to `plan`, `audit`, and provider evaluation; no CLI flag can override it. The value is a ceiling, not a price: model prices still resolve only from the checked-in exact-model catalogue. The default is disabled. There is no product-imposed upper amount: a value is rejected only when it is non-finite, zero, or negative.

When enabled:

1. The selected route must have an exact known catalogue price before target inventory or a provider request. Unknown or unavailable pricing fails preflight without target I/O or a provider call.
2. `maxParallelVectors` is a positive queue-concurrency setting, never an audit-work limit. Every model route shares the same cost guard. Several in-flight requests can cross the value before their observations are recorded; their final observed cost remains authoritative, and later dispatch stops once the shared ledger reaches the ceiling.
3. The shared provider boundary checks the run ledger immediately before every model request, including agent-loop calls, normal retry, and provider-signalled context-recovery attempts. It rejects dispatch when accumulated known estimated cost is greater than or equal to the configured ceiling.
4. After each successful provider response, the same boundary records its exact catalogue estimate using the canonical usage/cost functions. Failed requests with no usage do not add an invented cost. A response that crosses the ceiling remains in its stage request ledger.
5. The stable terminal error token is `model-cost-ceiling-reached`. It contains no price, source, prompt, provider body, or request identifier. A stopped stage has a normal content-free observation; a stopped vector is `failed`, has the terminal token, and cannot be treated as a clean no-finding result or a CI pass.

The ceiling does not pre-split, pre-trim, skip, change scopes, change models, or restrict file tools. It must not be used to optimize benchmark output or conceal incomplete coverage.

## Offline provider-evaluation preflight

`bun run eval:provider:preflight` accepts the exact `eval:provider` option grammar and validates the resolved primary and, when selected, independent route before a paid evaluation. It performs no provider construction, network request, artifact write, target execution, or target mutation. It validates credential **presence** only inside the provider-resolution adapter; key values never leave that adapter or appear in its output.

The command fails before corpus work when a selected route lacks its credential, exact bundled catalogue price, declared structured-output compatibility profile, or compatible live output contract. It then validates the corpus manifest, all selected source digests, case selection, measurement-profile restrictions, independent-route distinction, benchmark/config fingerprints, and private-holdout attestation where applicable. Its sole result is a content-free JSON readiness record containing route identities, boolean credential/pricing/transport readiness, stable transport failure code when applicable, selected-case count, corpus identity, and protocol/config fingerprints. It neither creates a resumable checkpoint nor reserves cost. `eval:provider` reuses this same preparation path before it constructs a provider, opens a target, writes an artifact, or dispatches a model call, so preflight and paid execution cannot drift.

## Provider-output transport compatibility

Every selected provider route declares one versioned structural output profile. The platform validates each live agent's JSON Schema exactly as the harness will send it. A profile may inspect only JSON-Schema root keywords and fails closed when it is undeclared or unsupported. For an OpenAI Responses profile, the root must be `type: object` and must not use root `oneOf`, `anyOf`, or `allOf`. The resulting source-free compatibility fingerprint is part of the workflow/configuration identity: a profile or contract change rejects checkpoint reuse instead of retrying under different transport semantics.

The feature-owned canonical semantic result remains the only decision contract. When a provider requires an object root, the owning agent may use one strict transport-only envelope with a required canonical result field. The corresponding feature stage unwraps that field exactly once before canonical validation/materialization. No envelope, raw transport schema, provider message, or model rationale is persisted in a checkpoint, report, score, baseline, or product artifact.

## Single ownership and accounting

`features/model-operations/` owns the strict ceiling schema, finite-decimal validation, aggregate-from-observation logic, and the shared pre-dispatch/post-response ledger. It reuses `ModelPricingSchema`, `summarizeModelCost`, and `ModelStageObservationSchema`; it must not duplicate token or cost arithmetic. `review-workflow/stages/scoped-model-stage` mounts that one ledger around every provider request. Product and provider-evaluation runners compose an initial ledger from their reusable checkpoints/drafts or prior trials, and the product CLI writes its source-free terminal state. No other stage, agent, tool, or provider adapter owns a separate budget counter.

The initial ledger includes each previously persisted stage observation exactly once. A terminal vector result supersedes any prior map, posture, or grounding draft for its vector; otherwise the newest reusable phase observations are included. A resumed run may raise, lower, add, or remove the ceiling because the ceiling does not alter semantic evidence or checkpoint compatibility. It always counts retained prior request observations before dispatching further work.

Every new evaluation trial, checkpoint, and final run artifact records the configured ceiling, known accumulated estimated cost, and whether it was reached. A disabled guard is recorded explicitly. Terminal vector coverage retains every completed or failed stage observation before a later stage or required checkpoint write fails, together with the actual operational phase and stable error token. The report-level aggregate must reconcile exactly to the complete retained ledger, including a completed model stage that precedes `checkpoint-persistence-failed`; it never estimates, drops, or substitutes cost data. A new-format artifact that cannot establish this conservation is invalid and cannot be selected, compared, scored, or presented as provider evidence.

## Failure, recovery, and privacy

A ceiling stop is not retryable within the same invocation. `audit --resume --run-id <id> --retry-unfinished true` may continue its exact-bound checkpoints when the operator selects a larger ceiling or disables it. Completed map/posture/grounding and terminal vector checkpoints remain reusable; no completed provider work repeats merely because the ceiling was reached.

The ledger retains only configured ceiling state, boolean reached state, numeric known estimate, and the existing content-free request observations. It never stores a target path, source/context bytes, prompt, tool input/output, raw model output, provider request identifier, secret, or provider error body.

An explicitly enabled private evaluator diagnostic is separate from the ledger and ordinary evaluator artifacts. It may retain only allowlisted run/route/stage/retry timing, protocol/schema fingerprints, stable application/harness error tokens, and closed normalized provider metadata (provider, model, method, reason, HTTP status, provider code). It never retains provider messages, request identifiers, headers, bodies, prompts, source, tool payloads, credentials, or raw model output. It is absent by default, is written atomically only below ignored evaluator-private work, and cannot alter outcome, retry, scoring, baseline comparison, checkpoint reuse, product telemetry, or public publication. Its write is best-effort: when private diagnostic storage itself fails, no durable marker is guaranteed and the underlying audit/evaluation result remains unchanged.

The design deliberately does not promise a charge cap: provider-side billing, retries that return usage only after completion, and the crossing request make that claim false. It promises a deterministic no-further-dispatch point from the observed ledger.

## Acceptance

Acceptance requires colocated tests proving all of the following:

- invalid, zero, non-finite, and unavailable-price ceiling configurations fail before target/provider work; concurrent vectors instead share one guard without suppressing queued audit work;
- the guard is shared by planning and every scoped audit stage, including normal retries and context-overflow recovery;
- one crossing response is retained, then no later request starts, with exact content-free accounting;
- a stopped vector is failed and cannot produce an accepted finding or clean CI outcome;
- checkpoint/draft reuse initializes the ledger exactly once and a resumed run can proceed under a changed ceiling;
- manifests surface only the specified source-free fields, while reports retain their existing stage ledger; and
- the no-network preflight rejects missing credentials, absent exact pricing, invalid corpus/selection/attestation, and invalid route configuration without creating a provider, checkpoint, or artifact; and
- preflight rejects an incompatible or undeclared transport profile before corpus/target access, provider construction, artifact work, or dispatch; and
- evaluator diagnostics are absent by default and, when explicitly enabled, remain private, recursively redacted, source-free, non-scoring, and irrelevant to checkpoint reuse; and
- full language-neutral scope, file-tool behavior, source/context recovery, pricing provenance, and model-output contracts remain unchanged.
