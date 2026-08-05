# Reliability remediation action plan

Status: active. Waves 1–4 completed on 2026-07-31; Waves 4.1–4.2 close live-run safety defects and Wave 5 is the remaining corpus-evidence work. Source: five-repeat reviewed-plan diagnostic `reliability-wave-reviewed-plan-20260731`, source-only corpus review, the 2026-07-31 provider-quota attempt, and the current audit/evaluation contracts. User approval: explicit blanket approval for plans and specs.

## Outcome

Audit becomes a truthful, resumable static-review workflow before another provider-quality baseline is taken. The work fixes protocol and measurement root causes; it must not add a language parser, AST dependency, regex/API finding rule, source cap, benchmark-specific heuristic, or model ensemble workaround.

## Evidence that drives this plan

| Finding | Consequence | Required response |
| --- | --- | --- |
| Returned audits were recorded as completed even with failed posture, incomplete verifier, or null grounding work. | Scores treated unknown coverage as a clean result. | REL-001, REL-002, EVAL-084, EVAL-085. |
| Closure reduced verifier-incomplete and rejected candidates to the same `candidate-not-admitted` state. | A vector could be completed with unclosed obligations. | Replace the closure enum and derive it from actual terminal phase disposition. |
| Evaluator reran whole trials and reused any `completed` wrapper. | Costly work could repeat and failed work could be permanently misclassified. | Reuse phase checkpoints and retry only incomplete/failed phases. |
| Plan questions mixed “is the control present?” with “is risk present?”. | Candidate-blind posture polarity was ambiguous, notably for patched controls. | Replace question/criterion pairs with one risk-positive obligation identity. |
| Current corpus keys are provisional and targeted; a scorer counted all unmatched outputs as false positives. | It overstates precision and cannot distinguish mislabeled/novel findings. | Add answer-key coverage class, role ranges, and unadjudicated output state. |
| Exact line-based paired persistence changed after patches. | Stable issues could look unrelated solely from line shifts. | Compare evaluator-owned expected-finding ids. |
| Exhaustive final keys could not match two independent reviews because review coverage silently defaulted to `targeted`. | A valid exhaustive case could never satisfy the dual-review gate. | Require coverage class in each review and include it in the matching judgment. |
| Evaluation runs, checkpoints, baselines, and comparisons accepted omitted identity fields. | Missing protocol, concurrency, qualification, or verifier-route data could make a measurement ambiguous. | Require all comparison identity fields and reject incomplete artifacts. |
| A persisted proposed finding could omit its approved-plan obligations. | A report item could lose its traceable link to the human-approved review request. | Require non-empty plan-obligation references in the single-owned finding schema. |
| Cost telemetry retained an ad-hoc `configured` price source. | A cost result could appear comparable without a bundled exact-model rate. | Accept priced telemetry only from the bundled exact-model catalogue; otherwise record `unavailable`. |
| A reused candidate-grounding checkpoint retained candidates but omitted earlier-stage funnels, rejection counts, and grounding telemetry from its terminal retry. | A resumed report and its derived run cost could silently lose completed phase evidence. | Version the grounding draft, persist the complete source-free ledgers/observations, and regression-test their exact terminal projection. |
| A terminal vector checkpoint allowed its human-review queue to be omitted. | A resumed aggregate could silently treat a missing queue as no human-review work. | Require the collection at the vector and report boundaries; emit an empty collection only when there are no items. |
| A live provider quota failure was written by the generic harness JSON logger with provider diagnostic fields. | Provider error bodies, headers, request identifiers, or source-adjacent diagnostics could reach the terminal. | Replace the generic logger with a no-content harness logger; retain only strict content-free stage error codes and observations. |
| A provider's default active-retry policy multiplied the application-owned fresh retry. | A permanent provider failure could make up to six calls per stage before a checkpointed incomplete result. | Make each provider call one-shot; keep the existing scoped lifecycle as the single generic retry owner. |

## Waves

### Wave 1 — truthful terminal state and phase preservation — completed

1. Introduce the single audit phase ledger from REL-002 and contract-test every transition.
2. Refactor all audit early returns and catches through the ledger finalizer; preserve reached observations/counts.
3. Replace closure collapse with the REL-001 terminal closure matrix.
4. Derive `EvaluationTrial.status` from coverage and make ineligible scores null.
5. Verify with fake-provider failures before refactoring prompts or corpus data.

### Wave 2 — one canonical obligation identity — completed

Execution ticket: `specs/plans/reliability-remediation/wave-02-risk-positive-obligations/tickets/TICKET-201-risk-positive-obligation-contract.md` (completed). This is a phase-gated horizontal contract foundation; no later resume/scoring ticket may introduce a second obligation identity.

1. Replace question/criterion index pairs with strict `obligationId`, `riskStatement`, and `evidenceRequirement` owned by the plan schema.
2. Change map, posture, discovery, grounding, verification, checkpoints, reviewed plans, fixtures, and reports to use only `obligationId`.
3. Rename posture conclusions to risk-positive tokens and keep deterministic code limited to reference/state validation.
4. Reject old plan/checkpoint/report formats; regenerate schema artifacts.

### Wave 3 — resumable evaluation and honest scoring — completed

Execution ticket: `specs/plans/reliability-remediation/wave-03-evaluator-recovery/tickets/TICKET-301-evaluator-phase-recovery.md` (completed).

1. Reuse existing audit checkpoint contracts from a private ignored evaluation work root and resume the earliest unfinished phase.
2. Version the corpus/evaluation contracts for coverage class and role-specific accepted ranges.
3. Implement detection, localization, adjudicated FP, and unadjudicated-outcome metrics without source semantics.
4. Update provisional keys through source-only adjudication records; do not claim dual review or qualification.
5. Keep both ends of the runner lifecycle under fake-provider coverage: retained incomplete trials must not become scores, and a complete non-adjudicated protocol fixture must resume without dispatching another model request or becoming a quality claim.

### Wave 4 — hardening and deterministic verification — completed

1. Update AGENTS/Claude guidance, feature READMEs, and public docs (without linking internal specs) to explain resume and metric limits.
2. Run `spec:check`, schema generation/check, typecheck, lint, unit/coverage, deterministic evaluation, and corpus evaluation.
3. Remove the targeted seed baseline because a false-positive threshold requires exhaustive labels. Persist coverage class in every new run and comparison identity; report patched matches, adjudicated false positives, and unadjudicated outputs separately.
4. Route any remaining issue to one of: structural/protocol, corpus/adjudication, or model-quality. Do not compensate for model misses with static rules.
5. Require evaluation qualification, prompt protocol, vector concurrency, and verifier-route identities in all current run/checkpoint/baseline/comparison artifacts; reject omissions instead of interpreting them as legacy state.
6. Require the answer-key coverage class in each independent human review and require every persisted finding to retain its non-empty approved-obligation references.
7. Remove the retired ad-hoc model-pricing source; priced telemetry is catalogue-backed only and unavailable otherwise.
8. Version candidate-grounding recovery artifacts and carry their exact source-free discovery/grounding funnels, candidate-rejection ledger, and stage observations through verifier-only retry into terminal coverage and the derived cost ledger. Reject prior draft versions rather than silently reconstructing omitted telemetry.
9. Require the terminal vector result's human-review collection and remove empty-list fallback aggregation.

### Wave 4.1 — content-free provider failure handling — completed

1. Replace generic harness JSON error logging with one platform-owned no-content logger. It must discard every message, field, binding, provider body, provider header, request identifier, prompt, source/tool value, and raw model output.
2. Preserve operational diagnosis only through existing strict content-free stage observations, normalized error codes, and checkpoint state.
3. Regression-test the logger contract and run the focused evaluation command tests before another credential-gated provider attempt.

### Wave 4.2 — single-owned retry budget — completed

1. Disable provider-internal retries without naming provider error codes or interpreting provider error text.
2. Retain the existing one fresh same-scope invocation in the scoped lifecycle as the only default retry path.
3. Regression-test the resolved provider retry policy and preserve checkpointed incomplete terminal state for failed live calls.

### Wave 4.3 — evaluator terminal telemetry preservation — completed

1. Preserve every reached content-free planning and audit observation when a later evaluator persistence or scoring operation fails.
2. Retain any already-returned source-free audit projection while leaving failed-trial scores ineligible.
3. Regression-test a successful generated plan followed by evaluator checkpoint persistence failure; its terminal failed trial must still expose the completed planning stage.

### Wave 4.4 — provider-neutral terminal stops — completed

1. Map only Purista's normalized timeout/cancellation categories to one stable `provider-cancelled` code; do not inspect provider text.
2. Stop application-owned same-input retry for those terminal conditions and preserve cancelled vector/trial state through explicit unfinished recovery.
3. Regression-test stage retry, audit coverage, and evaluation planning cancellation separately.

### Wave 4.5 — resumed observed-cost integrity — completed

1. Register the exact content-free planning-stage observation from an orphaned generated-plan checkpoint before resumed audit dispatch.
2. Deduplicate only exact stage observations so normal trial wrappers cannot double count the same call.
3. Regression-test that a recovered checkpoint cost reaches the existing shared ceiling before another request starts.

### Wave 5 — qualified corpus acquisition and measurement governance — active

Readiness on 2026-07-31 is `0/30` dual-reviewed development real-world paired projects, `0/6` required control families with five pairs each, `0/100` reliability pairs, `0/25` patched-negative pairs, `0/3` dual-reviewed language families, and `0/1` dual-reviewed private-holdout pair. The acquisition track has 44 validated metadata leads (30 OpenSSF JavaScript/TypeScript, 12 CWE-Bench-Java, one OSV Python Git-range lead, and one OSV Go Git-range lead) and four complete acquired source pairs across Go, JavaScript, Java, and Python; all remain zero-readiness until pinned source evidence has two independent reviews and a separately imported case. This is an evidence gap, not a product, parser, prompt, or provider retry defect.

**Single-source handoff decision.** The metadata-only candidate registry remains a lead tracker only. It must not gain expected categories, locations, source excerpts, source-snapshot state, reviewer judgments, or a second review-state machine. The closed source-pair workspace is the sole source of acquired-snapshot state. Once a complete local vulnerable/patched workspace is selected, its two independent human records and any resolution are written directly into the strict corpus answer key, which is the sole source of finalized adjudication. The existing corpus loader keeps that answer key outside the agent jail. This prevents source/label duplication and prevents an acquisition lead from becoming model-visible evidence.

1. Turn the 44 OpenSSF/CWE-Bench-Java/OSV leads and future lanes into no more than thirty repository-disjoint local candidate workspaces. Use the CAP-089 local source-pair command to verify pinned upstream revisions and complete vulnerable/patched regular-file digests before any provider call. The Spark Java, decamelize JavaScript, urllib3 Python, and go-git Go pairs are acquired and byte-verified; none carries a source label or truth claim. Never execute target code, invoke a target build, or mount acquisition metadata into the target jail.
2. For each selected candidate, create two independent human source-only adjudications. They must agree on statically reviewable applicability, finding-label coverage class, exact expected finding ids/categories/priorities, role-specific accepted ranges, relevant paths, control families, and patched negative expectation. Record disagreement without promotion.
3. Keep each new answer key `targeted` unless the reviewers explicitly establish exhaustive matching coverage over its declared paths. Do not create a precision baseline from targeted or provisional cases.
4. Import accepted packs only through the existing offline local importer. Confirm source/answer-key/plan isolation and re-run readiness after every batch. Reserve at least one repository-disjoint dual-reviewed real-world pair for the steward-controlled private holdout.
5. Only after the development pilot reaches 30 dual-reviewed real-world pairs and every control family has five pairs, run a five-repeat reviewed-plan provider diagnostic. It reports completion, detection, localization, patched matches, adjudicated false positives, unadjudicated outputs, cost, and qualification. It remains non-reliability evidence until the 100-pair, 25-patched-negative, three-language-family, and attested private-holdout gates are met.

## Dependency and acceptance matrix

| Wave | Depends on | Done when |
| --- | --- | --- |
| 1 | Existing audit/evaluation schemas | No incomplete vector/trial is reported completed; phase telemetry survives every failure path. |
| 2 | Wave 1 ledger tests | Every product reference uses one risk-positive obligation id; no index-pair compatibility remains. |
| 3 | Waves 1–2 contracts | Resume skips completed provider stages; targeted/exhaustive scoring and role localization are truthful. |
| 4 | Waves 1–3 | Full checks pass; coverage-class report/comparison/baseline rules, strict artifact identities, finding provenance, catalogue-only costs, recovery telemetry, and public explanations are aligned. |
| 5 | Waves 1–4 and the existing offline importer/readiness contracts | Readiness records dual-reviewed real-world evidence before any provider-quality baseline is attempted. |

## Guardrails

- Keep production admission language-neutral and model-judged.
- Keep target and evaluator data isolated; no source, key, prompt, raw output, or work checkpoint enters a public report.
- Keep Zod schemas single-owned and derive types with `z.infer`.
- Put unit tests beside changed modules; use fake providers by default.
- Make breaking changes cleanly; remove legacy paths instead of adapters or fallbacks.
