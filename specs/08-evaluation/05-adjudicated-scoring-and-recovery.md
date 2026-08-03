# Adjudicated scoring and resumable evaluation

## Decision

Evaluation measures bounded, human-adjudicated claims. It must report what the answer key can establish and what the workflow actually completed; it must not manufacture precision, recall, localization, or provider-quality conclusions from incomplete runs or non-exhaustive labels.

## Requirements

| ID | Requirement | Owner | Acceptance |
| --- | --- | --- |
| EVAL-084 | Persist a source-free per-vector coverage projection for every evaluation trial. | `evaluation` | Trial status follows audited coverage rather than merely a returned audit object. |
| EVAL-085 | Score only a fully completed trial; incomplete/failed/cancelled trials retain diagnostic outcomes but no clean score. | `evaluation/real-world-scorer` | An incomplete patched trial is neither a true negative nor a false positive. |
| EVAL-086 | Separate expected-issue detection, role localization, adjudicated false positives, and unadjudicated findings. | `evaluation/real-world-scorer` | A finding near a declared issue is not silently treated as a different issue or exact localization. |
| EVAL-087 | Declare answer-key finding coverage explicitly. | `evaluation/corpus` | Targeted keys cannot make whole-repository precision claims; exhaustive keys may. |
| EVAL-088 | Support one-or-more role-specific accepted source ranges per expected finding. | `evaluation/corpus` | Equivalent operation locations can be adjudicated without lowering issue-detection recall. |
| EVAL-089 | Bind the derived coverage class into every run, baseline, and comparison identity. | `evaluation` | A report, baseline, or comparison cannot reinterpret targeted output as exhaustive precision evidence. |
| EVAL-090 | Measure semantic generated-plan coverage through explicit human adjudication. | `evaluation/plan-semantic-adjudication` | A strict evaluator-only artifact binds the exact generated plan and answer-key scenario set; deterministic code validates closure and derives metrics without using wording, category, source, parser, or benchmark heuristics. |
| EVAL-091 | Treat static-review-inapplicable expectations as neutral. | `evaluation/real-world-scorer` | Inapplicable scenarios and expected findings are counted and reported, but never become a plan miss, finding false negative, false positive, or pass. |
| EVAL-092 | Diagnose loss across evidence-processing stages safely. | `evaluation/stage-evidence-coverage` | A trial stores source-free counts of expected-role overlaps at neutral mapping, canonical grounding, and verifier output; the counts never enter model input, a score, a finding rule, or product admission. |
| EVAL-093 | Close a provider-evaluation command checkpoint after orchestration stops. | `evaluation/run-provider` | A post-checkpoint exception records `failed` or `cancelled` plus one stable source-free code; it never leaves a known stopped command as `running` or rewrites its trial states. |
| EVAL-094 | Bind a provider smoke run id before audit dispatch. | `evaluation/run-provider-smoke` | A fresh run refuses an existing checkpoint; resume accepts only the exact source-free target, plan, protocol, route, provider/model, and budget identity. |

## Trial state and score eligibility

`EvaluationTrial.status` is derived after the audit closes:

| Status | Condition | Score |
| --- | --- | --- |
| `completed` | Every enabled vector has `coverage.completed: true`; no audit failure/cancellation occurred. | eligible |
| `incomplete` | Audit returned but an enabled vector is incomplete, not reached, or skipped contrary to the reviewed plan. | ineligible |
| `failed` | Audit invocation failed before a complete terminal projection. | ineligible |
| `cancelled` | Invocation was cancelled or timed out. | ineligible |

The trial retains a `score: null` and source-free coverage projection when ineligible. Aggregates report attempted, completed, incomplete, failed, and cancelled counts separately; these are distinct terminal states, never a combined “failed” bucket. They calculate detection and precision metrics only across completed trials and must show the denominator. A run with any non-completed trial fails its workflow-completion gate and cannot be a provider-quality result, even if a diagnostic score is otherwise present.

An ineligible trial still retains every source-free phase observation and returned audit projection reached before its terminal error. For example, if model planning succeeds but checkpoint persistence fails before audit starts, the failed trial records its completed planning observation while its scores remain `null`. A `null` model observation means no model stage was reached, not that a later error erased one.

The evaluator records a harness-normalized model timeout or cancellation as `cancelled`, not `failed` or `incomplete`, and retains the stable `provider-cancelled` code. It does not inspect provider text or use a provider-specific timeout list. This status is recoverable only through the existing explicit unfinished-retry option.

## Answer-key coverage and matching

Every answer key declares `findingCoverage` as either:

- `targeted`: the key adjudicates only the listed known issue(s); unmatched findings are `unadjudicated`, never automatic false positives;
- `exhaustive`: the key asserts that all statically reviewable matching findings in declared relevant paths are represented; unmatched findings are adjudicated false positives.

An expected finding has a stable id, static-review applicability, and one-or-more accepted source ranges for each required evidence role. An expected planning scenario binds its stable id and relevant paths to explicit expected-finding ids. v1–v4 answer keys are rejected; no migration adapter is provided. The required roles are `operation` and `unsafe-condition`. A range may be empty only when the human adjudicator explicitly records the role as `not-applicable`; static-review-inapplicable scenarios and findings are excluded from plan and detection denominators and reported as neutral counts. Finding scores never derive path coverage from matched findings; path scope belongs only to the plan score.

The scorer uses a one-to-one expected-finding match and declared role ranges. It emits four separate outcomes:

| Outcome | Meaning | Metric effect |
| --- | --- | --- |
| `matched-localized` | One finding matches one expected issue and every required role. | detection true positive; role localization true |
| `matched-mislocalized` | One finding matches an expected issue through at least one declared role but misses another required role. | detection true positive; missed role localization |
| `unmatched-adjudicated-false-positive` | No expected issue matches and the key is exhaustive. | false positive |
| `unmatched-unadjudicated` | No expected issue matches and the key is targeted. | visible investigation queue; excluded from precision |

The scorer must not infer semantic equivalence from source text, language, parser output, corpus labels, answer-key wording, or a benchmark-specific rule. Human answer-key authors declare alternate valid ranges. A `matched-mislocalized` result is a quality signal, not an automatic source-location repair.

## Generated-plan semantic adjudication

The immediate `PlanScore` is explicitly a path-scope observation. It must not be renamed, displayed, or used as semantic plan recall, scenario precision, or plan understanding.

A separate evaluator-only `PlanSemanticAdjudication` may be recorded after a generated-plan trial, including a benign variant. It binds run id, case id, variant, repetition, exact generated plan id/digest, target/context fingerprints, and answer-key digest. It contains exactly one outcome for every expected scenario and every enabled vector in that plan. A scenario is `covered` with one-or-more semantically relevant vector ids or `uncovered` with none. A vector is `relevant` with one-or-more covered scenario ids or `unrelated` with none. References are bidirectional, unique, and must close over exactly the bound plan and scenario set. An eligible human reviewer records identity, timestamp, and an optional source-free rationale; a reviewer is the semantic authority, not the product or an evaluator model.

The evaluator provides a strict source-free template for that adjudication. Its reviewer/time and every scenario/vector outcome are `null`, so it is intentionally unscoreable. The human completes it only after inspecting the exact evaluator-private plan checkpoint and case material. The final command accepts the completed strict adjudication, never the template, and writes a separate source-free JSON/Markdown semantic evaluation artifact.

`PlanSemanticRunEvaluation` v1 aggregates only completed per-trial semantic artifacts for one generated-plan run. It binds run id, pack id/version, split, and prompt protocol; exposes eligible, adjudicated, and missing-adjudication trial counts; and derives global scenario recall, relevant-vector precision, unrelated vectors, and duplicate relevant vectors from adjudicated trials only. v1 carries the explicit `single-human-review` qualification: it is diagnostic evidence only. An absent per-trial artifact is unavailable human evidence, never a zero score. Independently agreeing human reviewers are required before semantic plan evidence can support a provider-quality claim. The aggregate cannot alter product admission or a workflow gate.

The scorer derives scenario recall from covered scenarios and vector precision from relevant enabled vectors. It reports unrelated-vector count and duplicate relevant-vector count separately. An incomplete, absent, or mismatched adjudication leaves semantic metrics unavailable; it is never converted into a zero or used to pass a planning/workflow/provider-quality gate. The adjudication may be used for offline analysis only after the provider run closes. It is not mounted in a target jail, passed to a model, used to create a reviewed plan, used by audit admission, or used to tune product behavior from a benchmark.

Patched variants retain `no-matching-finding`. A completed patched matching finding is a patched false positive. A completed nonmatching patched finding is adjudicated only when its key is exhaustive; otherwise it is unadjudicated. Paired persistence compares source-free expected-finding ids, not exact line-number finding identities, so harmless patch line shifts do not erase the comparison.

## Corpus integrity and claims

The current OpenSSF and Juliet keys are targeted provisional records. They may measure known-issue detection/localization and patched matching-finding behavior, but they may not support whole-repository precision, new-issue, or general provider-quality claims. Their alternative operation/control ranges must be authored through source-only human adjudication and remain provisional until the existing dual-review rule is met.

The existing seed and private mixed-language packs remain diagnostic/provisional. No private or provisional result satisfies readiness, baseline, independent-route promotion, or model-selection claims. The evaluator keeps an acquisition queue for unmatched targeted findings; it never feeds that queue, answer key, paired relationship, or labels into a model prompt or product admission.

Every new evaluation run persists the derived pack class: `targeted`, `exhaustive`, or `mixed`. A Markdown report reads this persisted class rather than reconstructing it from a later pack load. Every run, checkpoint, baseline, and comparison also persists the exact corpus-manifest digest, selected-population digest, and benchmark-protocol fingerprint; an old or mismatched shape is rejected. Comparison identities include the class and all three immutable identities, and reject a difference. A reviewed baseline declares `exhaustive` only; it cannot set an aggregate false-positive threshold for a targeted or mixed run.

## Evaluation checkpointing

Each provider trial writes reusable audit-phase predecessors to the evaluator work root described by REL-003. Trial checkpoint metadata contains case/variant ids, configuration fingerprint, exact sealed plan/vector digests when audit work was reached, target snapshot/context identity, retry state, phase protocol fingerprints, and source-free coverage status. A run report contains only the final trial projection and aggregate metrics. The enclosing command checkpoint is `running` only while orchestration is active; an exception after it is written closes it as `failed` with `evaluation-run-failed`, or as `cancelled` with `provider-cancelled`, without altering retained trial states. Checkpoint locking, atomicity, fail-closed unresolved-lease handling, command-attempt record, and terminal classification use the shared Wave 1 lease/reducer contract. Incomplete, failed, or cancelled work may supply an exact predecessor only after explicit retry; it cannot become a completed trial, a score denominator, or a baseline observation.

## Report requirements

The JSON and Markdown reports must show:

- attempted/completed/incomplete/failed/cancelled trial counts and completion rate;
- completed-trial denominators for each metric;
- expected-issue detection recall separately from role localization;
- patched matching findings, adjudicated false positives, and unadjudicated findings separately;
- per-vector source-free closure/phase outcome counts;
- evaluator-only expected-evidence overlap counts at mapping, grounding, and verifier output, clearly labelled diagnostic rather than a security conclusion or score;
- immediate plan path-scope metrics separately from available human-adjudicated semantic plan metrics, with the adjudication completeness denominator;
- qualification and corpus coverage class beside every metric.

Comparison output calls false-positive deltas `adjudicated false positives` and publishes unadjudicated findings as a separate diagnostic delta. It never labels either aggregate as general precision unless both compared artifacts are exhaustive.

No report calls a targeted-key result “precision” without the qualifier `adjudicated-targeted precision unavailable`. No report calls a provisional corpus reliable, validated, or model quality.

## Verification

- Schema contracts reject legacy keys/trials, missing coverage class, missing role ranges, duplicate ids/ranges, and source-bearing projections.
- Golden scorer tests cover alternate locations, role mislocalization, targeted unmatched findings, exhaustive false positives, patched persistence across shifted lines, and score-ineligible trials.
- Fake-provider integration tests prove trial resume, source-free report projection, and non-completed aggregate denominators.
- Corpus validator and report snapshot tests demonstrate no answer-key or work-root leakage.
