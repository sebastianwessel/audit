# Independent verifier diversity

Status: implemented as an evaluation-only CAP-063 experiment. This is a language-neutral response to measured same-route confirmation bias. It neither changes current production behavior nor claims a quality improvement before a qualified evaluation proves one.

## Problem and decision

The five-repeat `reviewed-plan-tool-guided-language-neutral-20260729` diagnostic completed every model call but admitted all 27 hypotheses through the same configured model route, including repeated patched false positives. Repeating the same route is not independent verification. The rejected two-observation experiment showed that another same-route observation is not sufficient evidence of a general improvement.

CAP-063 introduces an optional **independent verifier route**. Planning and investigation remain on the primary route. Only verification may use a separately resolved provider/model route. It has the same bounded vector scope, tools, schema, retry policy, and source-evidence duties as the current verifier. It may accept, reject, or return incomplete for the existing hypothesis; it can never create a hypothesis, widen scope, add classification, urgency, impact, remediation, or make a dynamic attack.

The default remains `same-route`. `independent-route` is experimental until it meets the promotion rule below.

## Capability contract

| ID | Actor | Trigger | Preconditions | Final state | Owner | Verification |
| --- | --- | --- | --- | --- | --- | --- |
| CAP-063 | Authorized operator / evaluation runner | Explicit `independent-route` verifier configuration | Approved plan; primary and verifier routes are complete and distinct; both provider adapters are available | Accepted, rejected, incomplete, or explicit route/configuration failure with isolated stage ledger | configuration, harness, review-workflow, model-operations | Strict configuration, scope, route-separation, telemetry, retry, resume, and qualified-corpus comparison tests. |

### Route policy

1. `same-route` is the only default and preserves the current behavior exactly.
2. `independent-route` requires a complete verifier route: provider, model, and secret-environment-variable name. Its cost resolves from the bundled exact-model catalogue or is explicitly unavailable.
3. Its normalized `(provider, model)` pair must differ from the primary pair. A different credential for the same pair is not independence and fails configuration validation.
4. A provider difference is permitted but not required. It is an evaluation variable, never a claim that one provider is more accurate.
5. The planner and investigator always use the primary route. A provider outage in the independent verifier produces an `incomplete` verification outcome for only that hypothesis/vector; it never falls back to the primary route, a parser, a static rule, or a finding.
6. Route selection occurs before constructing the Purista harness. Agent instruction, Zod contract, sandbox, built-in-tool policy, scoped tool handlers, and execution limits are identical across routes.

## Configuration and boundary contracts

The configuration adapter owns all environment loading with existing precedence. `independent-route` adds these optional values:

| Value | Meaning | Validation |
| --- | --- | --- |
| `SECURITY_REVIEWER_VERIFICATION_MODE` | `same-route` or `independent-route` | Default `same-route`; closed enum. |
| `SECURITY_REVIEWER_VERIFIER_PROVIDER` | Verifier adapter name | Required only for `independent-route`; supported optional adapter. |
| `SECURITY_REVIEWER_VERIFIER_MODEL` | Verifier model identifier | Required only for `independent-route`; normalized pair must differ. |
| `SECURITY_REVIEWER_VERIFIER_API_KEY_ENV` | Name of the environment variable holding the secret | Required only for `independent-route`; the secret value never enters the configuration shape, artifacts, or logs. |

CLI flags, if later exposed, override the matching verification-route values after `.env`. Incomplete verifier-route configuration, unavailable adapter packages, same normalized route, unsupported capability, or missing named secret are preflight failures before a target jail, provider call, or checkpoint is opened. The product never reads a secret outside the provider-resolution adapter. Price values are never accepted from `.env` or CLI.

`RuntimeConfigurationSchema` owns the strict primary and verifier route shapes. `platform/harness/` owns the provider-resolution port and `review-workflow/agents/verification/` remains the only owner of verifier semantics. No provider or route selection logic belongs in prompts, audit execution, target tools, evaluator answer keys, or reports.

## Execution, recovery, and observability

The workflow creates one harness per invocation using the route selected for that phase, with `defineHarness()` and truthful `object`/`tool_use` capabilities. It retains the existing no-executor in-memory sandbox and `NO_CONTENT` telemetry. Both verifier attempts under default retry use the same independent route, scoped path allowlist, and model route; retries must not silently switch routes.

The checkpoint binding gains a non-secret `verificationRouteFingerprint`, derived from normalized provider/model identifiers and the verifier instruction/tool-contract fingerprint. A checkpoint from `same-route` is never reusable by `independent-route`, and a verifier-route change cannot reuse a prior verifier result. Investigation drafts remain reusable only to retry verification when all existing binding fields plus the verifier route fingerprint match.

Every model stage gains a closed `route` token: `primary` or `independent`. Request observations remain numeric-only. They continue to exclude provider request identifiers, prompt text, source, tool arguments/results, credentials, model identifiers, and raw output. Route identities are recorded only in the run configuration/fingerprint needed for comparability, never in a request observation or target report.

Each route resolves its own pricing object from the same versioned bundled catalogue. A run aggregate may state `mixed` cost source only when every stage has a non-null calculated cost; otherwise its aggregate cost is null and `unavailable`. A report retains the existing stage table and adds the route token so operators can compare verification cost/latency/token/cache usage without content retention.

## Evaluation and promotion

`same-route` and `independent-route` runs are non-comparable unless both have the same corpus identity/version/split, reviewed-plan profile, provider and model for the primary route, execution configuration, evidence-delivery mode, prompt/tool fingerprints, repeat count, and pricing-snapshot identity. The verifier-route fingerprint is a mandatory additional comparison key.

Promotion requires a preregistered five-or-more-repeat comparison on a corpus that first passes the independent real-world readiness gate. It must separately report vulnerable recall, patched/benign false positives, agreement, incompletes, safety violations, completion, per-route stages, tokens, cache routing, latency, and cost. It may be promoted from experimental only if it meets the existing safety/completion gates and improves the declared patched-negative precision outcome without a declared vulnerable critical/high recall regression or disproportionate cost/latency breach. A single seed, synthetic fixture, semantic-regression case, benchmark label, model anecdote, or unreviewed candidate registry entry cannot satisfy promotion.

Until promotion, `independent-route` is opt-in evaluation-only. Product commands must reject it rather than silently enable an experimental mode. The experiment may not alter finding admission, CI thresholds, answer keys, prompts, candidate discovery, or human plan approval.

## Required implementation structure and acceptance

The implementation uses only these ownership areas:

~~~text
src/
  platform/configuration/                 strict route configuration
  platform/harness/                       provider-resolution and route harness mounting
  features/model-operations/              route-aware, numeric-only stage and aggregate accounting
  features/review-workflow/runtime/       route selection and checkpoint binding adaptation
  features/evaluation/                    route-comparability and preregistered evaluation reporting
~~~

Unit tests remain colocated. No new shared module is permitted unless at least two features need the exact same route invariant. Generated Zod schemas, capability inventory, implementation guidance, agent guidance, public operator documentation, and migration records must change together. The report schema version must advance before adding `mixed` cost source or a persisted route token; readers must reject an incompatible legacy version rather than silently reinterpret it.

Acceptance is met only when strict configuration rejects every partial/same route; route selection occurs before target I/O; tool scope and retry budget are unchanged; route mismatch prevents checkpoint reuse; every route stage has isolated numeric telemetry; aggregate cost does not invent a value; product default remains same-route; experimental product invocation is rejected; and a qualified preregistered evaluation exists before any production promotion.
