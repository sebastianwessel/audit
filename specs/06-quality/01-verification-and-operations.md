# Verification and operations

## Gates

Default checks are bun run spec:check, bun run typecheck, bun run lint, and bun test. Release checks add generated-artifact drift, dependency vulnerability/license checks, SBOM generation, and fake-provider CLI end-to-end tests.

## Test layers

| Layer | Required coverage |
| --- | --- |
| Unit | Colocated *.test.ts files for schemas, normalization, jail, ignore rules, grep, dedup, claim admission, exit codes, and redaction. |
| Contract | Colocated *.schema.contract.test.ts files for every Zod boundary and generated JSON Schema. |
| Harness | Fake provider, planner/audit loops, gate, timeout, cancellation, shutdown. |
| Filesystem | Temporary roots, traversal, symlink, output-jail behavior. |
| End-to-end | plan -> validate/reseal fixture -> audit -> report, including partial failure. |
| Live provider | Opt-in smoke only; never default CI. |
| Dynamic target/UI | Not applicable in v1. |
| Evaluation | Trusted scorer over isolated packs; default CI uses deterministic/fake-provider packs. |

## Acceptance

| ID | Evidence |
| --- | --- |
| REQ-001 | Harness has no executor or mutation tools; fixture target is unchanged. |
| REQ-002 | Draft/rejected/missing-metadata plan returns code 2 without model/tool calls. |
| REQ-003 | Extra keys and malformed model/tool values fail. |
| REQ-004 | Traversal, absolute escape, and symlink escape fail. |
| REQ-005 | Mixed-case enum output normalizes; unknown tokens fail. |
| REQ-006 | Persisted findings have valid relative evidence or are rejected/incomplete. |
| REQ-007 | Same validated report produces stable JSON/Markdown projection. |
| REQ-008 | Confirmed claims and incomplete coverage map to distinct exit codes. |
| REQ-009 | Logs/telemetry contain no source/prompt/tool content and redact secrets. |
| REQ-010 | Missing optional provider fails clearly; fake provider works. |
| REQ-011 | Unit and schema contract tests stay in the same folder as the code/schema they verify. |
| REQ-012 | Evaluation packs cannot expose answer keys, scoring code, or external network access to the agent. |
| REQ-013 | The fixture track reports case-and-variant outcomes across repeats, aggregate precision, recall, F1, location accuracy, abstention, and safety violations. Its summary exposes minimum and median finding recall plus total vulnerable false negatives and patched/benign false positives. |
| REQ-014 | Repeated evaluation runs preserve pack/config/model/prompt digests and report a confidence interval for stochastic metrics. |
| REQ-015 | CI fails on any safety violation, contract failure, answer-key exposure, or threshold regression. |
| REQ-016 | Every evaluation fixture has a provenance/license record and a human-adjudicated expected outcome. |
| REQ-017 | Context frontmatter is strict, digest-bound to the plan, advisory-only, and cannot change tool permissions or hide source-backed findings. |
| REQ-018 | Every enabled vector is scope-filtered and has complete eligible source evidence. A language-neutral path manifest is visible for coverage; a static security clue is not part of production evidence delivery. |
| REQ-019 | A finding outside scope, without valid exact source lines, a matching approved vector, valid role shape, deterministic integrity validation, and verifier acceptance never persists. |
| REQ-020 | Scope/path/line integrity, redaction, phase binding, duplicate collapse, and chain construction are deterministic and tested independently of a provider; security semantics are not encoded in deterministic rules. |
| REQ-021 | Every model-backed plan/audit/evaluation records source-free token usage and either a bundled exact-model catalogue cost or explicit cost unavailability; no price environment variable or runtime price fetch exists. |
| REQ-022 | Provider cache routing is stable and provider-specific; no product-managed cache stores prompts, target content, tool data, or raw model output. |
| REQ-023 | Every planning, investigation, verification, and isolated evaluation model stage has one content-free observation; a run aggregate is derived from, and agrees with, every retained stage. A human report renders the individual rows plus a per-stage summary and stable top cost/latency invocations without source, prompt, tool, or model content. |
| REQ-024 | Evaluation-only data and answer keys cannot enter planning, investigation, verification, tool access, checkpoints, or reports. |
| REQ-025 | Source integrity is a deterministic path/line/redaction check only; it never becomes a semantic relationship shortcut. |
| REQ-026 | Every tool-bearing stage records aggregate attempted and successful read/search kind counts plus returned bytes, without a fixed call/result cap that can omit approved evidence. Only a completed scoped read or search that returned a result may satisfy source-inspection coverage; rejected attempts and listing never do. |
| REQ-027 | Production audit code imports no language-specific parser, structural adapter, or static security rule catalogue. |
| REQ-028 | An audit resume reuses only matching verified/redacted vector checkpoints, never reruns a completed/skipped vector, and retries incomplete, failed, or cancelled work only when explicitly requested. |
| REQ-029 | An unavailable language-specific capability may only become a visible coverage limitation; it cannot skip a file or create a language-wide claim. |
| REQ-030 | Every newly written vector result includes a balanced, content-free finding-admission funnel. It accounts for each model candidate and verifier acceptance without exposing source, prompts, model content, or tool data. |
| REQ-031 | Every completed new-format evaluation trial aggregates its vector admission funnels. Evaluation reporting may use those numeric aggregates to diagnose misses, but they cannot affect scoring, labels, planning, or finding admission. |
| REQ-032 | A verifier accepts only an investigator hypothesis for the same approved vector and returns exact valid reconciled evidence locations; neither model may use a deterministic operation/candidate policy as semantic corroboration. |
| REQ-033 | Finding localization and normalized evaluation keys use the declared `operation` evidence first, then the first evidence only when no operation role exists; model evidence-array ordering must not change a score. |
| REQ-034 | Provider evaluation has explicit, non-comparable `generated-plan` and `reviewed-plan` profiles. The latter loads a strict human-reviewed plan fixture outside the agent-visible target tree, binds it to the target/context inventory, and measures audit quality without provider planning calls. Its checkpoint fingerprint, report, and baseline carry the profile; answer keys must never construct or enter a reviewed plan. |
| REQ-035 | A static test pattern or parser result may not be reintroduced as a finding-admission fallback after verifier failure, timeout, or incomplete evidence. |
| REQ-036 | Every successful provider response inside a planning, investigation, or verification stage has one ordered content-free request observation. Stage usage/cost is derived from and equals those request observations; request observations retain no model/provider request id, prompt, source, tool data, credential, or response content. |
| REQ-037 | The model-facing repository tool contract is single-owned by review workflow and mounted by the harness as `repo_list`, `repo_read`, and `repo_grep`; no agent has built-in filesystem, shell, network, or write tools. Scoped service handlers, not prompt text, enforce target-only and vector-only access. |
| REQ-038 | Investigation, verification, and evaluation are tool-guided: each receives only the approved vector's complete path manifest and scoped read/search tools, and a persisted hypothesis requires successful source-access evidence in its own stage. No inline source-delivery mode exists. |
| REQ-039 | Corpus cases declare one evidence origin: `real-world`, `synthetic`, or `semantic-regression`. Only repository-disjoint `real-world` paired projects may satisfy provider-reliability corpus thresholds; the evaluator reports every origin separately and never converts a data-sufficiency gap into a model score. |
| REQ-045 | Candidate acquisition metadata is digest-bound and repository-distinct, but has zero corpus/readiness/provider-gate weight until a separately validated source-only pack and dual human adjudication exist. |
| REQ-046 | An experimental independent verifier route differs from the primary normalized provider/model route, has no primary-route fallback, preserves scope/tools/retry limits, and remains disabled for product admission until a qualified preregistered comparison promotes it. |
| REQ-040 | Production finding admission is language-neutral: no regex clue, parser result, AST node kind, language hint, extension, fixture identity, or answer-key-derived rule may establish a security operation, unsafe condition, data flow, or finding. Deterministic code may only enforce evidence integrity, scope, redaction, phase binding, and state transitions. |
| REQ-041 | Every investigator hypothesis is independently accepted, rejected, or marked incomplete by a scope-bounded, cardinality-unbounded verifier stage before it can persist. The verifier may inspect only the same vector scope, cannot create a finding, and must seek source-local controls that could negate the claim before acceptance. It has separately recorded request/token/cost/tool observations. |
| REQ-042 | A resumable audit persists only validated/redacted phase drafts, per-candidate verifier/countercheck state, and terminal vector results outside the target. Candidate-aware state is exact-identity-bound, transitions from pending through running to completed, and retains the canonical decision/telemetry but never raw model rationale, prompt, source transcript, or tool transcript. |
| REQ-043 | With default retry enabled, a failed investigator or verifier invocation receives exactly one fresh same-input attempt. Both attempts share the original vector scope; only a schema-valid result can continue. A normalized provider context-window error instead starts shared deterministic recovery. Disabled retry makes one attempt. No retry may admit a static clue, widen access, or convert failure into a finding. |
| REQ-047 | The versioned Purista Harness patch preserves the configured agent-loop limit and removes the undocumented 64-step clamp; product configuration uses no fixed loop cap. A future explicit finite limit is recorded as `agent-loop-budget-exceeded`, never as provider failure or completion, and remains incomplete until explicit unfinished recovery. |
| REQ-048 | Context-overflow reduction may deduplicate only byte-identical declared artifacts. Conflicting map identities, mixed null/non-null groundings for one seed, or conflicting not-applicable closure outcomes fail incomplete; no reducer may choose a favourable partition. |
| REQ-049 | Product schemas impose no fixed total cardinality ceiling on approved audit evidence or outcomes. Transaction bounds may preserve memory and retryability only when exact continuation/reassembly represents every eligible item; a provider/schema failure is incomplete, never a truncated clean result. |

## Test locality rule

The acceptance check rejects new tests/unit/ and tests/contracts/ directories. Integration, end-to-end, fixture, and test-support material remain under top-level tests/.

| REQ-044 | Any future syntax-navigation proposal needs a separate multi-language design, supply-chain review, and corpus-independent admission decision before implementation. |
| REQ-045 | The reviewer never runs a parser generator, compiler, native rebuild, target runtime, or target build as part of an audit. |
| REQ-047 | Entry point, root-control, and counterevidence context is optional, source-backed model metadata. Deterministic code may validate an explicit map reference and role shape, but must not require, derive, score, or interpret those roles from language, extension, parser, regex, fixture, or answer key. |
| REQ-048 | Scan lineage consumes only two validated current-report artifacts and the shared exact finding identity. It has no target/provider/model access and emits new, resolved, or persisting only when the relevant vector is completed in both required comparison positions; every other case is unknown. Its persisted projection is source-free. |
| REQ-049 | Target, context, and output roots are pairwise disjoint before artifact I/O, inventory, plan loading, provider construction, or dispatch. Artifact reads have no creation side effect and writes cannot escape through a component or race-time symlink. |
| REQ-050 | Every model-visible source byte comes from one immutable, policy-visible snapshot. A post-inventory target mutation cannot change a tool result in that run. Included UTF-8 regular files have one manifest row; exclusions are explicit and never depend on a source/language/line/match/file-count cap. |
| REQ-051 | Changing any behavior-affecting vector or plan field, target snapshot, context, provider/model/route, phase, or protocol fingerprint rejects checkpoint reuse before dispatch. Legacy artifacts are rejected. |
| REQ-052 | One table-driven terminal reducer conserves vector/obligation states and derives report status, counters, manifest outcome, evaluation status, and exit code. Disabled is visible neutral; incomplete/failed/cancelled/not-reached enabled work cannot be complete. |
| REQ-053 | A source/context/tool transaction page either continues automatically to exact completion or records explicit incomplete coverage; no fixed product evidence/tool/output cap may truncate approved work. |
| REQ-054 | One exclusive run lease and an atomic content-free attempt record protect product and evaluator output. Concurrent, unresolved-stale, interrupted, and report-write-failure paths preserve reached observations and end in one truthful outcome. The application fails closed for an existing lease; only an operator may resolve a known-abandoned lease before explicit resume. |
| REQ-055 | Each product CLI command has a closed, command-specific option contract. Unknown or command-incompatible options fail before configuration, filesystem, artifact, provider, or model work. |
| REQ-056 | Verifier and evaluation-only countercheck transport uses one run-wide pool shared by every vector. Its active dispatch count never exceeds the validated vector-concurrency setting, while every candidate remains scheduled and retains an ordered terminal result; this is not a candidate, evidence, tool, or output cap. |
| REQ-057 | Provider-free stage-wrapper regressions cover an unknown-language file, business-level advisory context, hostile advisory context, neutral source-visible controls, source-backed `not-applicable`, no-source-evidence incompleteness, and a source-backed candidate rejected before admission. They assert only lifecycle, scope, schema, and source-inspection behavior; they never encode a language-specific security conclusion or answer-key-derived rule. |
| REQ-058 | Plan authoring keeps one strict executable JSON contract and a deterministic Markdown projection. A constrained draft binds exactly one sealed base plan, cannot change target/context/inventory or derived identities, and resealing must reject malformed, mismatched, no-op, and destination-replacing edits without target, provider, or model access. YAML and Markdown are never executable plan inputs. |

Every run carries runId, planId, target fingerprint, stage, and vector id. Metrics use a security_reviewer.* prefix. The product harness emits no log records: operational diagnosis is limited to strict content-free observations and artifacts. Artifact writes are atomic. Model-backed observations record calls, tokens, cached-token subset, reasoning tokens, latency, explicit cost state, stage status, stable error code, and aggregate-only file-tool counts/bytes/rejections/budget state without recording request content. Run totals are derived from stage records. Product audit vectors and provider evaluation trials checkpoint outside the target and permit completed work to be reused. Provider calls are one-shot; the scoped lifecycle is the sole retry owner and default retry may make exactly one fresh same-input response attempt under the original scope/budget. Terminal failed work is retried only explicitly. A product audit with a provider outage remains partial and never promotes an unverified claim to a finding.

The configuration loader has contract tests for missing `.env`, strict dotenv parsing, quoted/empty values, and precedence. A local `.env` is ignored by Git and may simplify a developer run, but no test, CI job, report, artifact, telemetry event, or error message may reveal a credential value.

## Evaluation gates

The release evaluation suite has six tracks: contract/safety, seeded source-review integration, benign precision, robustness, plan quality, and operational efficiency. Contract/safety is a hard gate: zero target mutation, target execution, network attempts, path-jail escapes, answer-key exposure, or unvalidated persisted output. The deterministic seed proves wiring, isolation, scoring, and report behavior; it is not a provider-quality gate. A provider-quality gate may use only a readiness-qualified, dual-reviewed real-world corpus and must record its declared threshold in a dated baseline artifact.

AI tracks run each case five times when a live provider is used. Report mean, median, sample standard deviation, and percentile-bootstrap 95% confidence interval; do not claim a deterministic pass from one stochastic run. Report macro and micro averages, per-language/control-family slices, minimum finding recall, false-positive count, vulnerable false-negative count, invalid-output count, abstention count, cost, latency, input/output/cached/reasoning tokens, cache-routing status, and coverage. Aggregate outcomes by case and variant across repeats so repeated rows do not obscure their failure pressure. The numeric admission funnel identifies whether hypotheses were absent, rejected for integrity/tool evidence, rejected or left incomplete by verification, or admitted; it is diagnostic only. A comparison is invalid when pack version, case split, prompt/config digest, provider, model, tool policy, evidence-delivery mode, plan profile, execution budget, or cost configuration differs without being recorded.

The fixture track is executable without a live provider using a fake Purista provider. It validates the runner, scorer, report, and CI gates while keeping model quality separate from product correctness. Live-provider benchmarks are never required for `bun run check`.

## Metric definitions and plan rubric

For one-to-one matched expected findings, `recall = TP / (TP + FN)` is available for completed, statically applicable keys. `precision = TP / (TP + FP)` and `F1 = 2 * precision * recall / (precision + recall)` are available only for exhaustive keys, because targeted unmatched findings are unadjudicated rather than false positives. A zero denominator is reported as `null`, never as an invented zero. Micro metrics pool only comparable coverage classes; macro metrics average case-family metrics within that class. Location accuracy requires each declared evidence role to intersect its adjudicated range; classification and urgency are deliberately not scored. Duplicate reports count once for recall and every extra unmerged duplicate is an adjudicated false positive only on exhaustive keys.

Human plan review may score each applicable vector from 0–2 for source-answerability, scope precision, obligation quality, success criteria, data-protection coverage, and limitation clarity. The product does not store or require plan approval: a user may edit a plan externally, then validate/reseal and execute it. Evaluation-owned reviewed plans are deterministic fixtures, not approval evidence.

Commit package.json and bun.lock. CI uses a pinned Bun version and frozen installs. Optional providers are not imported until configured.
