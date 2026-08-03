# Plan 006: Complete lossless audit execution and trustworthy evaluation

> **Historical planning snapshot — superseded for implementation decisions.** The
> recovery/checkpoint, source-tool continuation, report-evidence, lineage, and
> large-evaluation-collection items listed below were completed during the
> 2026-08-03 remediation. Generated-plan path scope is now explicitly distinct
> from semantic plan quality; the latter is measured only by the newer
> evaluator-only human adjudication contract. Read the canonical specs and
> current agent guidance for current behavior; do not use the “Current state
> and evidence” section below as a defect list.

> **Executor instructions**: This plan is a follow-up to the existing
> production-readiness waves. It is deliberately contract-first: update the
> canonical specs before changing behavior, then regenerate schemas, update
> agent guidance and end-user documentation, and add the stated tests. Do not
> add a parser, language-specific detector, fixture rule, output cap, or
> answer-key-informed product behavior. If any STOP condition occurs, stop and
> report rather than inventing a fallback.

## Status

- **Priority**: P0 for reliable enterprise audits; P1 for measurement and DX
- **Effort**: XL program split into four independently reviewable tickets
- **Risk**: High for the workflow refactor; medium for evaluation-contract changes
- **Depends on**: plans/001-trust-boundaries-terminal-state-and-resume.md
- **Planned at**: uncommitted workspace snapshot, 2026-08-03 (the repository has no `HEAD`)

## Why this matters

The product has the right security boundary: it is static, target-language
agnostic, uses a scoped read-only snapshot, and starts context recovery only
after Purista reports `context_length_exceeded`. Those properties must remain.

It is not yet robust at enterprise scale. Recovery partitions repository access,
but later phases keep resending the full map, posture, seed collection, or
verification package. A provider can therefore overflow forever without any
lossless route to completion. Recovered child work also lives only in memory,
so a restart can repeat paid work. Separately, evaluation currently measures
plan path scope rather than whether the generated plan contains the expected
review scenarios, and several scorer/pack defects can make reported metrics
incorrect.

## Current state and evidence

- `src/features/review-workflow/runtime/context-overflow.ts:58-99` collects
  recovered leaves in memory and reduces only after every child completes.
- `src/features/review-workflow/stages/scoped-model-stage.ts:91-156` changes
  only `sourcePaths`, line ranges, and context in a recovered invocation.
  `source-posture`, `investigation`, `candidate-grounding`, and `verification`
  still spread their complete original request into the model call.
- `src/features/review-workflow/tools/contract.ts:5-48` has non-paged
  `repo_list`, `repo_read`, and `repo_grep` results; a large valid response is
  returned as one model-tool transaction.
- `src/features/audit-execution/evidence-map/verify.ts:36-80` retains a
  model-authored fact statement and limitations without applying the evidence
  redactor. `src/features/audit-report/report.ts:199-239` places several
  model-derived fields in Markdown without a single safe projection.
- `src/features/evaluation/real-world-scorer.ts:16-34` awards plan coverage
  solely when generated scopes cover expected paths. It does not compare an
  expected planning scenario to generated review obligations.
- `src/features/evaluation/real-world-scorer.ts:53-80` uses greedy
  order-sensitive finding matching and emits precision/F1 for targeted keys.
- `src/features/evaluation/real-world-runner.ts:172-279` selects cases but
  records a coverage class derived from the full pack.
- `src/features/evaluation/corpus.schema.ts:446-452` rejects legitimate
  large report projections with fixed vector/finding cardinality ceilings.
- `src/features/evaluation/corpus.ts:75-85` follows linked evaluator metadata,
  while `src/features/evaluation/importer.ts:63-82` omits reviewed plans from
  imported packs.
- `src/platform/filesystem/text-lines.ts:42-58` treats CR-only source text as
  one line; `src/features/audit-execution/evidence-map/verify.ts:42` has a
  separate incompatible splitter.
- `src/features/audit-execution/checkpoints.ts:303-308` validates a candidate
  fingerprint only for verifier checkpoints, although resumed cost accounting
  consumes countercheck observations too.

## Commands you will need

| Purpose | Command | Expected result |
| --- | --- | --- |
| Specs | `bun run spec:check` | exit 0 |
| Schemas | `bun run schema:generate && bun run schema:check` | generated artifacts current; exit 0 |
| Types | `bun run typecheck` | exit 0 |
| Lint | `bun run lint` | exit 0 |
| Tests | `bun test` | all tests pass |
| Coverage | `bun run test:coverage` | threshold passes |
| Offline evaluation | `bun run eval && bun run eval:corpus` | exit 0; no provider call |
| Full local gate | `bun run check` | exit 0 |

## Scope

**In scope**

- `specs/03-architecture/01-system-architecture.md`
- `specs/03-architecture/08-reliable-terminal-coverage-and-resume.md`
- `specs/03-architecture/09-immutable-evidence-and-terminal-truth.md`
- `specs/04-contracts/01-artifact-contracts.md`
- `specs/05-security/01-security-model.md`
- `specs/08-evaluation/01-evaluation-strategy.md`
- `specs/08-evaluation/04-real-world-corpus-and-reliability.md`
- `specs/08-evaluation/05-adjudicated-scoring-and-recovery.md`
- `src/features/review-workflow/`, `src/features/audit-execution/`,
  `src/features/evaluation/`, `src/features/audit-report/`,
  `src/features/target-inventory/`, and their side-by-side tests
- `src/platform/filesystem/`, evaluator import/loading code, `AGENTS.md`,
  `.agent/IMPLEMENTATION.md`, and directly affected public docs

**Out of scope**

- Target execution, network/MCP/shell tools, active attacks, or patch application.
- Static vulnerability rules, AST/parser admission, language-specific routing,
  or using evaluation labels in product prompts or admission.
- A mandatory second model or a product prompt cache.
- Changing historical run artifacts to make them appear compliant.

## Ticket 1: Durable lossless work ledger and transport continuation

1. Specify a strict, feature-owned `stage-work-ledger` below
   `src/features/audit-execution/`. A work unit must bind run, sealed
   plan/vector digest, target/context identity, phase, route/provider/model,
   protocol fingerprint, and exact scope/page digest. Its only states are
   `pending`, `running`, and terminal completed/failed/cancelled/incomplete.
2. Dispatch the full approved scope once. Only a normalized
   `context_length_exceeded` may create deterministic child work. Persist each
   completed child atomically before starting later siblings; a parent is
   terminal only when every child is terminal and an exact lossless reassembly
   succeeds. Resume only unfinished children and retain prior observations once.
3. Introduce opaque, snapshot-bound continuation tokens and `complete` markers
   for list/read/grep transactions. They must preserve exact content and line
   ending semantics, work for unknown extensions, never expose an out-of-scope
   path, and never act as an estimated-size pre-split. Continuation is completed
   automatically below the model boundary; the model never manages pages. The
   workflow retains a source-free acknowledgement of whether a required source
   inspection was complete.
4. Page model-facing derived artifacts by immutable work-unit identity:
   evidence-map facts, posture assessments, discovery seeds, grounded
   candidates, verification bases, reconciliations, and report projections.
   The recovery coordinator must partition the *actual overflowing model
   package*, not merely the source path manifest. A parent reassembly conflict
   becomes explicit incomplete coverage; it never chooses a winner.
5. Preserve map/posture/phase state when a later phase fails. Replace the
   positional early-return accounting in `audit.ts` with one finalizer that
   derives closure, error, telemetry, checkpoint eligibility, and report state
   from the ledger.

**Tests**

- First request contains the whole scope; a fake provider then forces a
  multi-level `context_length_exceeded` recovery.
- Kill/restart after each child; assert completed children cause no new model
  call and their observed cost appears exactly once.
- Verify byte-exact concatenation for list/read/grep pages, including CRLF,
  CR-only, an unknown extension, and an exhaustive zero-result grep.
- Exercise 65 vectors, 13 obligations, 129 facts, 257 candidates, and more
  than 1,000 report items without data loss or a product cardinality ceiling.
- Force a derived-artifact-only overflow to prove the new coordinator makes
  progress without dropping the map, posture, candidate, or context.

## Ticket 2: Single safe artifact-text boundary and exact evidence identity

1. Define one feature-owned safe text projection shared by evidence mapping,
   source posture, investigation/verification materialization, checkpoints,
   reports, and Markdown rendering. It must redact known secret/PII forms,
   remove control/terminal escape characters, and safely encode Markdown.
   It must not truncate source merely to fit a product limit.
2. Apply that projection before every persisted model-derived statement,
   reason, limitation, and source-derived snippet. Keep raw prompts, tool
   arguments/results, credentials, and raw model output out of all product
   artifacts.
3. Centralize verifier and countercheck acceptance/reconciliation so the same
   candidate-evidence, control, obligation, posture, and terminal rules cannot
   drift. Validate a countercheck checkpoint fingerprint before adding its
   observation to resumed cost accounting.
4. Move all physical-line handling to one tested utility that accepts LF,
   CRLF, and CR. Reuse it for file ranges, grep, evidence selection, context
   recovery, and source snapshots.

**Tests**

- Secret-like values, email-like values, control sequences, and Markdown
  metacharacters never reach JSON/Markdown artifacts unprojected.
- A long source line remains complete after redaction; a CR-only file has
  correct ranges and can recover from a source-range overflow.
- Identical verifier/countercheck inputs have identical materialized admission
  behavior; mismatched countercheck checkpoints cannot consume cost budget.

## Ticket 3: Make plan and finding evaluation semantically truthful

1. Change the evaluator-only answer-key/scoring contract so every expected
   planning scenario has a stable identity and an adjudicated semantic match
   predicate against a generated vector’s obligations, rationale, and scope.
   It must measure scenario precision, recall, and F1 one-to-one. The product
   planner never sees this data, and the evaluator must not derive semantic
   equivalence from a regex, parser, language, or answer-key wording.
2. Replace greedy finding matching with deterministic maximum-cardinality
   bipartite matching, with complete role localization as a documented
   tie-breaker. Preserve true positives, false negatives, localization, patched
   persistence, adjudicated false positives, and unadjudicated outputs.
3. Make precision/F1 `null` for targeted keys. Derive coverage class from the
   selected cases, bind it into every report/baseline/comparison, and reject
   cross-coverage comparisons.
4. Remove evaluation output ceilings that can reject an otherwise valid product
   report. Use source-free continuation pages/work units when a single record
   cannot be safely validated at once. Keep small categorical limits only where
   they encode a protocol invariant rather than evidence volume.
5. Extend repeated-run reliability output to include completed-repeat count,
   mean, standard deviation, and a deterministic seeded bootstrap 95% interval,
   as the specs require. One-run evaluation reports point estimates and must
   explicitly say that stability is not measured.

**Tests**

- Generated plan with correct paths but wrong obligations fails scenario match;
  equivalent human-adjudicated alternate scenario matches.
- Reordering findings/keys does not change matches or scores.
- Targeted coverage yields null precision/F1, and a filtered exhaustive split
  retains exhaustive coverage.
- Large report projection is retained/reassembled exactly, not schema-rejected.

## Ticket 4: Repair evaluator isolation, import completeness, and documentation

1. Require answer keys, reviewed plans, context metadata, and all other
   evaluator files to be regular non-symlinks whose canonical paths remain
   below the canonical corpus root. Preserve the existing source-tree checks.
2. Include `reviewedPlanPath` in the isolated importer and prove a round-trip
   imported pack can run the reviewed-plan profile.
3. Reconcile every changed artifact schema version in the canonical contract,
   schema generator, specs, AGENTS/implementation guidance, and public docs.
   Explicitly correct the abandoned-lease guide: operators resolve a stale
   lease; the program does not reclaim it.
4. Restore a clean verification baseline. At the snapshot reviewed for this
   plan, `bun run lint` fails only because
   `src/features/audit-execution/candidate-grounding/identity.test.ts` needs
   formatting; fix it as part of the next implementation ticket, not by
   weakening lint.

## Done criteria

- [ ] Every recovery child and artifact page has an exact durable identity;
  forced restart repeats no completed paid work.
- [ ] No product/evaluation report loses valid evidence because of a fixed
  cardinality, file, line, match, tool-call, byte, or estimated-token ceiling.
- [ ] All persisted text crosses the one safe projection boundary; no raw
  source/prompt/tool/model content is logged or stored outside its permitted
  private snapshot.
- [ ] Plan-scenario and finding metrics are deterministic, coverage-aware, and
  never make precision claims from targeted keys.
- [ ] Evaluator metadata cannot escape its root, reviewed-plan imports work,
  and docs describe actual lock behavior.
- [ ] All commands in "Commands you will need" pass; provider calls remain
  opt-in and are unnecessary for the acceptance suite.

## STOP conditions

- A proposed continuation requires dropping source, applicable context, a map
  fact, an assessment, a seed, a candidate, a reconciliation, or a report item.
- A change would make a language hint, extension, parser, corpus label, or
  evaluation answer key determine plan scope, admission, priority, or a
  security conclusion.
- A raw provider response, prompt, secret, target source body, or tool result
  would need to be persisted to make resume work.
- The next change requires a migration/compatibility adapter for legacy
  artifacts; this development repository accepts clean breaking versions.

## Maintenance notes

- The durable ledger is the sole owner of recovery progress. New model stages
  must use it rather than create an independent splitting or checkpoint loop.
- Keep evaluation contracts evaluator-only. Improving a metric must never feed
  labels or expected scenarios back into product prompts or deterministic
  admission.
- Review every future schema `.max()` as either a categorical protocol bound or
  an evidence-loss risk. The latter needs exact continuation, not rejection.
