# Adjudicated scoring and resumable evaluation

## Decision

Evaluation measures bounded, evaluator-adjudicated claims. It must report what the answer key can establish and what the workflow actually completed; it must not manufacture precision, recall, localization, or provider-quality conclusions from incomplete runs or non-exhaustive labels.

## Requirements

| ID | Requirement | Owner | Acceptance |
| --- | --- | --- |
| EVAL-084 | Persist a source-free per-vector coverage projection for every evaluation trial. | `evaluation` | Trial status follows audited coverage rather than merely a returned audit object. |
| EVAL-085 | Score only a fully completed trial; incomplete/failed/cancelled trials retain diagnostic outcomes but no clean score. | `evaluation/real-world-scorer` | An incomplete patched trial is neither a true negative nor a false positive. |
| EVAL-086 | Separate all-role terminal-evidence expected-issue detection, partial terminal recognition, adjudicated false positives, and unadjudicated findings. | `evaluation/real-world-scorer` | A finding near a declared issue is neither silently treated as a different issue nor presented as a complete terminal match. |
| EVAL-087 | Declare answer-key finding coverage explicitly. | `evaluation/corpus` | Targeted keys cannot make whole-repository precision claims; exhaustive keys may. |
| EVAL-088 | Support one-or-more role-specific accepted source ranges per expected finding. | `evaluation/corpus` | Equivalent operation locations can be adjudicated without lowering issue-detection recall. |
| EVAL-089 | Bind the derived coverage class into every run, baseline, and comparison identity. | `evaluation` | A report, baseline, or comparison cannot reinterpret targeted output as exhaustive precision evidence. |
| EVAL-090 | Measure semantic generated-plan coverage through one explicit AI-assisted development adjudication. | `evaluation/plan-semantic-adjudication` | A strict evaluator-only model stage binds the exact generated plan and answer-key scenario rubric; deterministic code validates closure and derives metrics without using wording, category, source, parser, or benchmark heuristics. It is diagnostic only. |
| EVAL-091 | Treat static-review-inapplicable expectations as neutral. | `evaluation/real-world-scorer` | Inapplicable scenarios and expected findings are counted and reported, but never become a plan miss, finding false negative, false positive, or pass. |
| EVAL-092 | Diagnose loss across evidence-processing stages safely. | `evaluation/stage-evidence-coverage` | A trial stores source-free counts of expected-role overlaps at neutral mapping, canonical grounding, and verifier output; the counts never enter model input, a score, a finding rule, or product admission. |
| EVAL-093 | Close a provider-evaluation command checkpoint after orchestration stops. | `evaluation/run-provider` | A post-checkpoint exception records `failed` or `cancelled` plus one stable source-free code; it never leaves a known stopped command as `running` or rewrites its trial states. |
| EVAL-094 | Bind a provider smoke run id before audit dispatch. | `evaluation/run-provider-smoke` | A fresh run refuses an existing checkpoint; resume accepts only the exact source-free target, plan, protocol, route, provider/model, and budget identity. |
| EVAL-109 | Retain score-ineligible audit outcomes without scoring them. | `evaluation/real-world-report` | Each incomplete, failed, or cancelled trial preserves reached accepted/review-required identities and its own source-free funnel in a distinct `retainedUnscored` projection; completed-trial metrics never consume it. |
| EVAL-110 | Distinguish pragmatic internal calibration evidence from readiness and model claims. | `evaluation/corpus-readiness` | A `development-calibration` qualification requires a verified real-world pair plus AI-assisted review and causal-patch record; it is unavailable for unresolved/high-uncertainty cases and never changes pilot or reliability readiness. |
| EVAL-111 | Measure whether generated plans place work in the executable or optional lane. | `evaluation/plan-semantic-adjudication` | The evaluator sees every enabled vector and additional observation only after planning closes; it reports misplaced observations separately from unrelated executable vectors without changing product behavior. |

## Trial state and score eligibility

`EvaluationTrial.status` is derived after the audit closes:

| Status | Condition | Score |
| --- | --- | --- |
| `completed` | Every enabled vector has `coverage.completed: true`; no audit failure/cancellation occurred. | eligible |
| `incomplete` | Audit returned but an enabled vector is incomplete, not reached, or skipped contrary to the reviewed plan. | ineligible |
| `failed` | Audit invocation failed before a complete terminal projection. | ineligible |
| `cancelled` | Invocation was cancelled or timed out. | ineligible |

The trial retains a `score: null` and source-free coverage projection when ineligible. Aggregates report attempted, completed, incomplete, failed, and cancelled counts separately; these are distinct terminal states, never a combined “failed” bucket. They calculate detection and precision metrics only across completed trials and must show the denominator. A run with any non-completed trial fails its workflow-completion gate and cannot be a provider-quality result, even if a diagnostic score is otherwise present.

For every score-ineligible trial, the evaluator retains a separate
`retainedUnscored` row containing only the trial identity, terminal status,
accepted-finding identities, review-required identities, and that trial's
source-free admission/terminal funnel. Aggregate reports expose completed and
non-completed funnels separately. These rows are additional observations for
later adjudication; they never become true positives, false positives,
precision inputs, or a surrogate clean result.

An ineligible trial still retains every source-free phase observation and returned audit projection reached before its terminal error. For example, if model planning succeeds but checkpoint persistence fails before audit starts, the failed trial records its completed planning observation while its scores remain `null`. A `null` model observation means no model stage was reached, not that a later error erased one.

The evaluator records a harness-normalized model timeout or cancellation as `cancelled`, not `failed` or `incomplete`, and retains the stable `provider-cancelled` code. It does not inspect provider text or use a provider-specific timeout list. This status is recoverable only through the existing explicit unfinished-retry option.

## Answer-key coverage and matching

Every answer key declares `findingCoverage` as either:

- `targeted`: the key adjudicates only the listed known issue(s); unmatched findings are `unadjudicated`, never automatic false positives;
- `exhaustive`: the key asserts that all statically reviewable matching findings in declared relevant paths are represented; unmatched findings are adjudicated false positives.

An expected finding has a stable id, static-review applicability, and one-or-more accepted source ranges for each required evidence role. An expected planning scenario binds its stable id and relevant paths to explicit expected-finding ids plus an evaluator-only objective, required risk condition, evidence requirements, and source-only applicability declaration. A reviewed-plan pair is valid only when the plan's obligation can discriminate the declared vulnerable behavior from its patched counterpart by naming the protected consequence plus the source relations and controls to inspect; this plan-quality check does not alter the answer key or infer a finding. v1–v5 answer keys are rejected; no migration adapter is provided. The required roles are `operation` and `unsafe-condition`. A range may be empty only when the evaluator review explicitly records the role as `not-applicable`; static-review-inapplicable scenarios and findings are excluded from plan and detection denominators and reported as neutral counts. Finding scores never derive path coverage from matched findings; path scope belongs only to the reachability observation.

The evaluator owns one source-free terminal evidence projection. It applies a one-to-one expected-finding match to terminal findings and records one boolean selection for every applicable expected role. Finding scores and terminal trace rows both derive from that same projection. Its strict persisted schema requires an exact terminal trace row for every projected role and rejects a completed vulnerable true positive unless every applicable terminal role is selected. Earlier-stage loss remains a diagnostic: it may explain where an earlier candidate lost a role, but it does not contradict or replace the final terminal selection.

The strict persisted score schema derives and validates the count equations: true positives equal complete terminal matches; false positives equal patched matches plus adjudicated unmatched findings; every partial terminal association remains a false negative; matched expected identities equal complete vulnerable or patched matches; and every available recall, precision, F1, and localization value equals its count-derived equation. An artifact that violates an equation is rejected before report rendering, comparison, baseline, or resume. It emits four separate outcomes:

| Outcome | Meaning | Metric effect |
| --- | --- | --- |
| `matched-localized` | One terminal finding matches one expected issue and selects every required role. | complete terminal match; true positive; role localization true |
| `matched-mislocalized` | One terminal finding matches an expected issue through at least one declared role but misses another required role. | partial terminal recognition only; true positive false; role localization false |
| `unmatched-adjudicated-false-positive` | No expected issue matches and the key is exhaustive. | false positive |
| `unmatched-unadjudicated` | No expected issue matches and the key is targeted. | visible investigation queue; excluded from precision |

The scorer must not infer semantic equivalence from source text, language, parser output, corpus labels, answer-key wording, or a benchmark-specific rule. Human answer-key authors declare alternate valid ranges. A `matched-mislocalized` result is a quality signal and a partial recognition, not an automatic source-location repair or a complete terminal match.

## Generated-plan semantic adjudication

The immediate `PathReachabilityScore` is explicitly a path-scope observation. It must be named and displayed as reachability only; it is never semantic plan recall, scenario precision, or plan understanding.

A separate evaluator-only `PlanSemanticAdjudication` v5 is created by one explicit AI-assisted development-review stage after a planning-generated or end-to-end-generated trial closes. It binds run id, case id, variant, repetition, exact generated plan id/digest, target/context fingerprints, complete evaluator-visible semantic-rubric digest, reviewer protocol fingerprint, and model route. The rubric digest and model input cover only scenario id, objective, source-only applicability, required risk condition, and evidence requirements. They exclude relevant paths, expected-finding identifiers, source ranges, and every location-equivalent answer-key field. Deterministic path reachability and terminal finding scoring use those answer-key fields only after product work closes and outside the semantic evaluator. It receives the generated plan and evaluator-only semantic rubric only after the product session has closed. It contains exactly one outcome for every expected scenario, enabled vector, and additional observation in that plan. A scenario is `covered` with one-or-more semantically relevant vector ids or `uncovered` with none. A vector is `relevant` with one-or-more covered scenario ids or `unrelated` with none. An observation is `appropriate` with no scenario binding, or `misplaced` with one-or-more declared uncovered scenario ids: this identifies source-supported executable work that was left optional. Scenario/vector references are bidirectional and unique; observation references are unique and close over exactly the bound observation set. The evaluator's observation mapping is diagnostic only: it never promotes, suppresses, dispatches, or changes an observation. It persists only the validated canonical scenario/vector/observation identity projection and derived counts; it never persists explanations, prompts, source, answer-key locations, raw model output, or provider request identifiers.

The reusable evaluator operation owns a strict source-free checkpoint v4 with `running`, `completed`, `incomplete`, and `cancelled` states. Every state binds every v5 identity field. A completed checkpoint retains the validated v5 evaluation and its model-stage observation; an incomplete checkpoint retains the normalized source-free error code and the same failed stage observation; a cancelled checkpoint requires the normalized `provider-cancelled` code and its cancellation observation. The operation reads and validates an exact completed checkpoint before invoking its lazy evaluator factory, so completed reuse cannot construct a provider or repeat product work. Any changed identity rejects reuse before evaluator dispatch, and every non-completed prior checkpoint requires explicit retry. A completed checkpoint may rematerialize its JSON and Markdown projections without another provider call. This evaluator checkpoint is diagnostic-only and does not alter product recovery or admission. An optional shared observed-cost guard is passed only to the evaluator usage recorder, so a normal provider run can retain one cost ceiling across product and semantic-evaluation stages.

The normal evaluation run owns semantic-plan aggregation. It derives report totals only from the semantic states persisted on its exact selected trials; it has no separate aggregate artifact or command. A completed measurement contributes its scenario recall, relevant-vector precision, unrelated-vector count, duplicate-relevance count, and appropriate/misplaced optional-observation counts. An incomplete, cancelled, or not-reached measurement is unavailable evidence, never a zero score. One AI-assisted development measurement remains diagnostic evidence only and cannot support external reliability, independent validation, provider selection, product admission, or a workflow gate.

The scorer derives scenario recall from covered scenarios and vector precision from relevant enabled vectors. It reports unrelated-vector count, duplicate relevant-vector count, and appropriate/misplaced observation counts separately. Audit coverage reports only enabled vectors: an unclosed executable obligation remains incomplete, while an intentionally unpromoted observation is excluded from dispatch and remains neutral. An incomplete, absent, or mismatched adjudication leaves semantic metrics unavailable; it is never converted into a zero or used to pass a planning/workflow/provider-quality gate. The adjudication may be used for offline analysis only after the provider run closes. It is not mounted in a target jail, passed to a model, used to create a reviewed plan, used by audit admission, or used to tune product behavior from a benchmark.

Patched variants retain `no-matching-finding`. A completed patched matching finding is a patched false positive. A completed nonmatching patched finding is adjudicated only when its key is exhaustive; otherwise it is unadjudicated. Paired persistence compares source-free expected-finding ids, not exact line-number finding identities, so harmless patch line shifts do not erase the comparison.

## Corpus integrity and claims

The current development keys are targeted AI-assisted records. They may measure known-issue detection/localization and patched matching-finding behavior, but they may not support whole-repository precision, new-issue, or general provider-quality claims. One traceable source-only AI review creates an `ai-assisted` key, preserves its exact evidence ranges, planned scenario rubric, and patched expectation, and runs once by default. It is internal development evidence only and is never presented as independent validation, general precision, external reliability, or provider-selection evidence. A second review is optional corroboration, never an implementation or diagnostic-measurement prerequisite.

An `ai-assisted` real-world paired key may additionally carry the strict `developmentCalibration` record defined by the corpus specification. When a selected development population contains an eligible record, its evaluation evidence qualification is `development-calibration`. This means only that the exact source-pinned pair, declared source-only review, and recorded causal-patch check are suitable for internal workflow calibration. It makes no recall, precision, robustness, comparative-model, or provider-quality claim; it does not make a baseline or workflow gate pass; and it cannot satisfy pilot, reliability, private-holdout, or independent-validation readiness. Missing, high-uncertainty, causally unconfirmed, or open-conflict records remain `diagnostic`.

The existing seed and private mixed-language packs remain diagnostic/provisional. No private or provisional result satisfies readiness, baseline, independent-route promotion, or model-selection claims. The evaluator keeps an acquisition queue for unmatched targeted findings; it never feeds that queue, answer key, paired relationship, or labels into a model prompt or product admission.

Every new evaluation run persists the derived pack class: `targeted`, `exhaustive`, or `mixed`. A Markdown report reads this persisted class rather than reconstructing it from a later pack load. Every run, checkpoint, baseline, and comparison also persists the exact corpus-manifest digest, selected-population digest, and benchmark-protocol fingerprint; an old or mismatched shape is rejected. Comparison identities include the class and all three immutable identities, and reject a difference. A reviewed baseline declares `exhaustive` only; it cannot set an aggregate false-positive threshold for a targeted or mixed run.

### Selected-trial population closure

Evaluation run schema v13 and provider-checkpoint schema v13 supersede earlier version references. Both persist one exact evaluator-selected `(caseId, variant, repetition)` population. A run's terminal trial identities must be unique and equal that population exactly; a duplicate, missing, or invented trial rejects the artifact before reporting, scoring, baselining, or comparison. Resume compares the persisted checkpoint population to the current selection before any provider construction or dispatch. Every v13 trial carries a semantic-plan measurement state, and the run carries the exact derived measurement state: workflow completion, semantic-plan completion or non-applicability, and finding-measurement completion or non-applicability. No caller may supply either aggregate state independently. Reliability summaries persist both all-terminal duration median/p95 and completed-only duration median/p95. Reports must display both with explicit labels; a completed-only duration is availability telemetry and never hides incomplete, failed, or cancelled work.

## Evaluation checkpointing

### Isolated diagnostic packs

Before another paid full-workflow evaluation, evaluator-private stage packs may
isolate one observed failure class. The registry contains exactly four
source-pinned diagnostic packs: evidence mapping, candidate grounding,
verification, and planning speculation. Each prepared pack separately binds the
local corpus directory digest and product inventory target fingerprint,
case/profile/stage identity, exact workflow, stage, and evaluator protocols,
canonical product-input fingerprint, and source-free rubric. A prepared pack
contains no product result or projection. Only a product stage that has actually
closed may create a source-free projection and invoke the semantic evaluator.
Offline loading rejects any checksum, inventory, profile, stage, protocol, or
canonical-input mismatch before provider construction. These packs are
development diagnostics only: their result cannot establish recall, precision,
reliability, or provider quality and cannot alter product admission.

`bun run eval:stage-isolated:prepare --write` is the sole contributor
resealing route for an existing diagnostic pack after a live workflow, stage,
or evaluator protocol changes. It rebuilds the canonical fixture from the
locally checksummed corpus and reviewed plan, then replaces only the derived
protocol and canonical-input identities through same-directory atomic output.
It retains the source-free rubric byte-for-byte: it cannot create, change, or
infer an expected outcome, answer key, product result, or projection. The
command is local and provider-free; it rejects a missing, symlinked, or
non-regular pack instead of creating a new one.

Each provider trial writes reusable audit-phase predecessors to the evaluator work root described by REL-003. Trial checkpoint metadata contains case/variant ids, configuration fingerprint, exact sealed plan/vector digests when audit work was reached, target snapshot/context identity, retry state, phase protocol fingerprints, source-free coverage status, and all required provider observations. A run report contains only the final trial projection and aggregate metrics. The enclosing command checkpoint moves monotonically through `created`, `running`, `finalizing`, and `completed`; `finalizing` contains the immutable run/report/digest payload and cannot dispatch a model. Failed and cancelled terminals retain a typed source-free failure envelope and append an attempt record without changing retained trial states. The command writes and validates the complete terminal artifact set plus its digest manifest before it marks the checkpoint completed. A missing `--resume` target, a completed target, an occupied fresh terminal destination or run-local staging directory, or a mismatched selected population fails before provider construction. Checkpoint locking, atomicity, fail-closed unresolved-lease handling, command-attempt record, and terminal classification use the shared Wave 1 lease/reducer contract. Incomplete, failed, or cancelled work may supply an exact predecessor only after explicit retry; it cannot become a completed trial, a score denominator, or a baseline observation. Recovery ledgers and validation-repair signatures remain source-free diagnostic metadata; they never alter score labels or enter product prompts except the closed correction descriptor required for the next exact-scope attempt.

A completed command checkpoint is immutable by default. `--resume true --retry-unfinished true` is the sole exception: it is valid only when the frozen run retains an incomplete, failed, or cancelled trial. Before reopening, the command revalidates and atomically moves the former public terminal set to `.provider-evaluations/<runId>/published-attempts/<attemptId>`. It then reuses completed trials and exact compatible phase predecessors, dispatches only unfinished work, and atomically republishes the same logical run id. If interruption occurs after the move but before the reopened checkpoint persists, the same explicit command detects the retained attempt and continues safely. Retention contains only the existing source-free artifact set; it never adds source, prompts, tool payloads, model output, credentials, or provider messages.

## Report requirements

The JSON and Markdown reports must show:

- attempted/completed/incomplete/failed/cancelled trial counts and completion rate;
- completed-trial denominators for each metric;
- all-role terminal-evidence expected-issue recall separately from partial terminal recognition and role localization;
- patched matching findings, adjudicated false positives, and unadjudicated findings separately;
- per-vector source-free closure/phase outcome counts;
- evaluator-only expected-evidence overlap counts at mapping, grounding, and verifier output, clearly labelled diagnostic rather than a security conclusion or score;
- immediate plan path-reachability metrics separately from available AI-assisted semantic plan metrics, with the adjudication completeness denominator;
- a retained-unscored section with accepted/review-required identities and a
  separate incomplete-trial funnel;
- qualification and corpus coverage class beside every metric, including an explicit internal-only explanation when the qualification is `development-calibration`.

Comparison output calls false-positive deltas `adjudicated false positives` and publishes unadjudicated findings as a separate diagnostic delta. It never labels either aggregate as general precision unless both compared artifacts are exhaustive.

No report calls a targeted-key result “precision” without the qualifier `adjudicated-targeted precision unavailable`. No report calls a provisional corpus reliable, validated, or model quality.

## Verification

- Schema contracts reject legacy keys/trials, missing coverage class, missing role ranges, duplicate ids/ranges, source-bearing projections, malformed development-calibration records, and a paired case whose vulnerable/patched revision or digest is identical.
- Golden scorer tests cover alternate locations, role mislocalization, targeted unmatched findings, exhaustive false positives, patched persistence across shifted lines, and score-ineligible trials.
- Fake-provider integration tests prove trial resume, source-free report projection, and non-completed aggregate denominators.
- Corpus validator and report snapshot tests demonstrate no answer-key or work-root leakage.
