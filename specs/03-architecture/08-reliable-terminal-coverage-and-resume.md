# Reliable terminal coverage and resumable audit execution

## Decision

This is a contract-first, breaking refactor of the audit-result and evaluation-trial boundary. Legacy report, checkpoint, plan, and evaluation artifacts are rejected rather than translated. The purpose is to make the workflow truthful and restartable without changing the language-neutral security judgment boundary.

## Requirements

| ID | Requirement | Owner | Acceptance |
| --- | --- | --- | --- |
| REL-001 | An enabled vector is `completed` only when every approved obligation has a terminal closure and no phase is incomplete, failed, cancelled, or not reached. | `audit-execution/coverage-closure` | A verifier-incomplete or grounding-interrupted obligation makes vector coverage incomplete. |
| REL-002 | A terminal vector or evaluation trial preserves all earlier reached phase observations, map/posture counts, funnels, and closure state. | `audit-execution`, `evaluation` | An evidence-map, posture, investigation, grounding, verification, evaluator-persistence, or catch-path failure cannot replace earlier data with zeroes, `null`, or another phase's observation. |
| REL-003 | A phase or candidate-aware work checkpoint is reusable only at its exact phase boundary and resumes from the earliest unfinished unit. | `audit-execution/checkpoints`, `evaluation` | A retry never repeats a matching completed generated plan, map, posture, grounding, verifier/countercheck unit, or terminal vector. |
| REL-004 | A required source-inspection stage that remains uninspected after its normal retry is explicitly incomplete and retryable from its predecessor checkpoint. | `review-workflow/stages`, `audit-execution` | No tool-skipped source-deciding stage is treated as clean or silently retried from scratch. |
| REL-005 | Audit and evaluation persist one source-free phase-status projection for every vector/trial. | `audit-execution`, `evaluation` | A report can distinguish completed, incomplete, failed, cancelled, excluded-by-plan, not-applicable, and review-required work without source/model content. |
| REL-006 | One terminal reducer is the sole owner of report status, counters, CLI exit code, manifest outcome, and evaluation status. | `audit-execution/terminal-classification` | No incomplete, failed, cancelled, or not-reached enabled obligation can yield complete/exit 0 or 1. |
| REL-007 | Product runs have one exclusive owner and an atomic attempt record. | `artifact-store` | Concurrent writers cannot share a run; an interrupted attempt retains reached observations and exactly one terminal outcome. |
| REL-008 | Candidate-aware verifier and evaluation-only countercheck dispatches use one audit-run-owned transport pool and durable work records. | `audit-execution/candidate-aware-dispatch`, `audit-execution/checkpoints` | The configured vector concurrency is also the maximum number of simultaneous candidate-aware provider calls across all vectors; every work item records `pending`, `running`, or `completed`, and no candidate-count cap or evidence reduction is introduced. |

## Canonical phase ledger

`audit-execution` owns one append-only per-vector phase ledger. It is the only input to terminal-result construction. Its entries are ordered by the fixed lifecycle:

1. evidence mapping;
2. source posture;
3. investigation;
4. candidate grounding;
5. verification for each grounded hypothesis;
6. optional evaluation-only countercheck.

Each phase entry has one of `not-reached`, `reused`, `completed`, `incomplete`, `failed`, or `cancelled`, plus its own content-free observation when a provider request was attempted. A phase may add validated redacted artifacts only through its existing feature-owned schema. It never stores prompts, source, tool arguments/results, raw model output, credentials, answer keys, or evaluator labels. A reducible scoped phase additionally owns one exact-binding, source-free context-overflow topology ledger. It records only deterministic scope hashes, parent/child identities, normalized overflow transitions, stable terminal codes, timestamps, and a per-terminal-child content-free usage/tool observation. It never caches a child model output. `evidence-mapping` and `source-posture` additionally own validated redacted leaf artifacts: the atomic writer persists the artifact before its matching `completed` topology transition, and restart reuses it only when the immutable binding, phase, recovery protocol, root scope, child identity, and child scope hash all match. Other phases do not yet have a leaf artifact contract and must re-run a completed child rather than retain raw output.

Candidate-aware work is transport-scheduled, not evidence-limited. The audit creates one FIFO pool per run with capacity equal to the validated `maxParallelVectors` setting. Every verifier and optional evaluation-only countercheck enters that same pool, including work from concurrently executing vectors. The pool preserves input/result order and terminal outcomes; it has no candidate, result, source, context, or tool-call ceiling. Before dispatch, each exact candidate phase writes `pending`, then `running`, then a redacted `completed` result. Its identity binds the sealed run/vector, provider/model, verifier route, complete workflow protocol, candidate-grounding protocol, phase, ordinal, and opaque digest of the exact canonical candidate input. Interrupted work is rescheduled; only an exact completed result is reusable. Parsed model rationale is never checkpointed.

The finalizer derives coverage, errors, observations, admission funnels, and closure matrix from this ledger. It must not receive positional observation arguments or construct a second phase summary. A catch path finalizes the ledger it has, records the stable failure code, and leaves unreached work visible.

Before opening recovery state, a run obtains an exclusive output-root lease. It writes an atomic content-free attempt record after root/configuration identity validation and transitions it from `starting` to exactly one terminal outcome in `finally`. A pre-existing lease fails closed: portable PID-file locking has no race-free stale-owner takeover, so the application never deletes a lease based on process or time inference. An operator may resolve a known-abandoned lease outside a running reviewer process and then use normal explicit resume against the retained immutable snapshot. Artifact reads never create directories. Artifact writes create only containment-proven missing components, use a temporary sibling plus atomic rename, and revalidate containment immediately before rename.

## Obligation closure

For each approved obligation, closure is exactly one of:

| Closure | Meaning | Vector completion effect |
| --- | --- | --- |
| `no-source-backed-candidate` | Discovery completed and declared no valid seed for the obligation. This is not a deterministic safety conclusion. | terminal |
| `candidate-rejected` | A map/posture-bound candidate completed verifier rejection for the obligation. | terminal |
| `candidate-admitted` | A candidate completed verification and report admission. | terminal |
| `review-required` | A structurally valid candidate conflicted with candidate-blind posture and entered the human queue. | terminal but separately visible |
| `incomplete` | Required map, posture, discovery, grounding, verification, or reconciliation did not complete. | non-terminal |
| `not-reached` | A predecessor stopped before this obligation could be closed. | non-terminal |
| `not-applicable` | The workflow completed a crisp source- or separately labelled context-backed reason that the exact obligation does not apply. | terminal and neutral |

`candidate-not-admitted` is removed because it conflates terminal rejection with incomplete verification. A candidate's verifier disposition determines the closure; deterministic code may only check declared state, identity, scope, and schema integrity.

Disabled vectors are `excluded-by-plan`, visible, neutral, and outside the denominator. Enabled vectors with no matched admitted paths are not automatically clean or not-applicable. A complete run requires a terminal closure for every enabled obligation and no reached phase with `incomplete`, `failed`, or `cancelled`. If a valid partial report exists and any enabled obligation is incomplete, failed, cancelled, or not-reached, the result is partial/exit 3. Only complete runs reach exit 0 (no confirmed findings) or 1 (one or more confirmed findings). Invalid/safety/contract input is exit 2. Provider or infrastructure failure that prevents a valid report is exit 4.

## Checkpoint and retry protocol

Product checkpoints remain beneath the configured separate output root. Evaluation uses a separate ignored evaluator work root with the same strict checkpoint schemas and atomic writer; its published run JSON and Markdown remain source-free and never contain checkpoint artifacts.

On retry or resume, the evaluator first re-inventories the selected variant, then reuses a matching generated-plan draft only when its run configuration, trial id, target fingerprint, and context digest match exactly. It starts audit with that same approved-plan projection. Inside audit, the runner chooses the newest exact reusable terminal result, otherwise grounding draft, posture draft, or map draft, and then reuses each exact completed verifier/countercheck unit independently. It does not regenerate completed model work merely because the vector, trial, or prior invocation was incomplete. Incomplete map/posture output is never checkpointed as a reusable predecessor. A changed run id, plan/configuration identity, target fingerprint, provider/model, verifier route, complete workflow protocol, candidate-grounding protocol, vector id, candidate identity, or phase rejects reuse. On explicit resume, an exact persisted normalized-overflow topology may skip only the already-rejected parent and reconstruct the same children from the retained immutable snapshot. A changed recovery protocol or reconstructed scope hash rejects the topology before provider dispatch. Completed evidence-mapping and source-posture children are reusable only when their matching validated leaf artifact exists; every other completed child is re-run until that phase gains its own validated leaf contract. A topology event alone never makes child output reusable.

Before dispatching resumed audit work, the shared observed-cost guard registers every matching generated-plan and audit-checkpoint content-free stage observation, including incomplete, failed, and cancelled terminal vectors that are excluded from execution reuse during explicit unfinished recovery. It adds an exact observation once even when a successor, terminal vector, or enclosing trial checkpoint also retained it. Thus a process stop between any checkpoint write and its enclosing trial artifact cannot make already-observed cost disappear from a configured ceiling. The one-case provider smoke follows this same checkpoint-derived accounting path before it may dispatch unfinished work.

An evaluator trial may be resumed only while its configuration fingerprint and case-variant target fingerprint match. A previous `completed` trial is immutable and reusable. Previous `incomplete`, `failed`, or `cancelled` trials are reusable only as phase predecessors when retry is requested; they are never reused as a completed score. If a planning call or audit report was reached before a later evaluator failure, the failed trial retains those exact source-free stage observations and any returned source-free audit projection; it never replaces reached usage/cost telemetry with `null` merely because the score is ineligible. The enclosing provider-evaluation command checkpoint independently closes as `failed` or `cancelled` after an orchestration exception; no known stopped command remains `running`.

## Required-inspection semantics

Evidence mapping and candidate-blind posture already require source inspection for a non-empty manifest. Investigation, grounding, and verification must declare in their feature contract whether source inspection is required for their returned disposition. An inspection is satisfied only by a completed scoped `repo_read` or `repo_grep` call that returned a result to the model. An attempted, rejected, or `repo_list` call never satisfies it. A required stage may return `incomplete` after the same-scope normal retry; it cannot become a clean absence/rejection solely because no successful source tool result was available. This is a protocol state rule, not a parser, regex, language hint, benchmark, or security detector.

Harness-normalized timeout and cancellation categories are terminal provider-neutral stops. The shared stage boundary maps either to the stable `provider-cancelled` code without reading provider text and does not apply the normal fresh retry. Candidate-aware cancellation closes the shared dispatch pool so queued work cannot spend more provider calls. Audit derives `cancelled` vector coverage from that code; evaluation derives a `cancelled` trial when any returned vector is cancelled or when planning stops that way before audit. Explicit unfinished recovery is the only path that may reattempt it.

The versioned Bun patch for the installed Purista Harness removes its undocumented 64-step clamp and preserves the caller's configured agent-loop limit. Product harness configuration uses no fixed loop cap; run timeout and cancellation are the operational stops. If a future explicit finite Harness limit is reached, the shared boundary preserves the distinct `agent-loop-budget-exceeded` code. It is never rewritten as a provider failure or clean completion, and the affected work remains incomplete until explicit unfinished recovery.

Overflow reduction may deduplicate only byte-identical stage artifacts with the same declared identity. Conflicting evidence-map facts, mixed null/non-null groundings for one seed, or conflicting `not-applicable` closure results make the reduced stage incomplete; a reducer must not choose one partition's candidate, neutral result, or fact over another's. This conservative rule preserves ambiguity for explicit recovery instead of converting it into a source-backed conclusion.

Product contracts impose no fixed total cardinality ceiling on approved plan vectors, obligations, scope globs, source evidence, map facts, posture assessments, discovery seeds, grounded candidates, verifier reconciliations, findings, review-required items, or audit errors. A transport/work-unit implementation may bound one I/O transaction, but it must continue exact work until all eligible items are represented. If a provider cannot produce a valid complete response, the stage is incomplete and uses the existing provider-signalled recovery path; it may not truncate or discard items to satisfy a schema limit.

## Data protection and operations

The phase ledger and evaluator work root are sensitive local operational data. They use the existing output jail, atomic writes, exact binding checks, redaction, and no-content telemetry. Logs and public reports may expose only identifiers, closed outcome tokens, counts, hashes, timings, token/cost observations, and stable redacted error codes. Operators resume with the normal explicit retry/resume command; they do not edit checkpoints.

## Verification

- Unit and contract tests cover every ledger transition, all early and catch-path finalizers, closure conservation, and legacy-artifact rejection.
- Integration tests prove phase reuse starts at the earliest unfinished stage and does not repeat an observed completed request.
- Fake-provider tests prove a repeated uninspected completion, verifier `incomplete`, cancellation, and provider failure remain incomplete rather than completed.
- Privacy tests prove evaluator reports and telemetry contain no source, prompts, tools, raw output, answer keys, or work-root contents.
