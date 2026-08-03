# Plan 007: Make every evaluator recovery path lossless and diagnosable

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. The repository currently has no `HEAD` commit and its files are untracked. First create or obtain an immutable baseline commit; if the current code differs from the excerpts below, stop and report rather than adapting this plan silently.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/006-production-readiness-follow-up.md
- **Category**: bug
- **Planned at**: no `HEAD` available, 2026-08-03

## Why this matters

The evaluator already writes exact-bound context-overflow recovery leaves, but its artifact reader chooses the terminal-vector schema for all three leaf paths. The read fails closed to `undefined`, so a resumed provider evaluation silently re-runs completed recovery work instead of reusing it. The inexpensive provider-smoke command has the same incomplete wiring: it loads all recovery artifacts but passes only a subset into `service.audit` and never checkpoints candidate-aware or overflow transitions.

When an audit throws after mapping or grounding, the evaluator also drops its newly collected stage-overlap counts. That is precisely the failure mode where the report must show where work was lost. These repairs preserve existing language-neutral semantics; they add no parser, rule, model call, answer-key input, or score behavior.

## Current state

- `src/features/evaluation/real-world-artifacts.ts` owns the evaluator-private adapter for the shared audit checkpoint contract. It writes each leaf with its strict schema at lines 318–394, but `readOptionalAuditArtifact` at lines 447–469 only recognizes candidate-aware, ledger, draft, posture, and terminal paths. Paths such as `*.evidence-map-recovery.<hash>.json` therefore fall through to `AuditVectorCheckpointSchema` and are treated as absent.
- `src/features/evaluation/run-provider-smoke.ts` is an opt-in one-case diagnostic. At lines 187–214 it loads the full reusable checkpoint shape but forwards only `vectorResults`, `candidateGroundingDrafts`, `evidenceMapDrafts`, and `sourcePostureDrafts`. Unlike the normal evaluator call in `real-world-runner.ts:567-635`, it omits candidate-aware checkpoints, overflow ledgers, all three recovery leaves, and their persistence callbacks.
- `src/features/evaluation/real-world-runner.ts` retains `evidenceMaps` and `groundedSourceEvidence` before invoking the audit (lines 534–599), then calculates `stageEvidenceCoverage` only after `service.audit` returns (lines 647–654). The error return at lines 681–702 does not contain `stageEvidenceCoverage`, even when mapping/grounding completed and was checkpointed.
- `selectedCasesForEvaluation` in `real-world-runner.ts:210-264` returns an empty list for a split with no cases. The runner then creates a review service and finally fails the strict `.min(1)` run schema. In `run-provider.ts:129-184`, a configured provider route is built before the corpus selection is checked. `--resume true` and `--retry-unfinished true` also lack the explicit run-id/paired-flag checks already enforced by the smoke parser at `run-provider-smoke.ts:76-84`.
- `AGENTS.md:30`, `.agent/IMPLEMENTATION.md:21`, and `specs/03-architecture/08-reliable-terminal-coverage-and-resume.md:61` already require exact, lossless recovery. `AGENTS.md:72` permits evaluator-only aggregate stage overlap counts and forbids them from affecting product semantics. These are implementation defects, not a new product decision.
- Tests live beside their implementation. `src/features/evaluation/real-world-artifacts.test.ts` currently proves terminal and ledger reuse but not recovery-leaf reuse. `run-provider-smoke.test.ts` proves a terminal resume only. `real-world-runner.test.ts` covers completed and incomplete trial reuse but not a thrown audit retaining evaluator-only stage evidence.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Focused artifact tests | `bun test src/features/evaluation/real-world-artifacts.test.ts` | exit 0 |
| Focused smoke tests | `bun test src/features/evaluation/run-provider-smoke.test.ts` | exit 0 |
| Focused runner tests | `bun test src/features/evaluation/real-world-runner.test.ts` | exit 0 |
| Contract checks | `bun run schema:check && bun run typecheck && bun run lint` | all exit 0 |
| Full regression suite | `bun test && bun run check` | all exit 0 |

## Scope

**In scope**

- `src/features/evaluation/real-world-artifacts.ts`
- `src/features/evaluation/real-world-artifacts.test.ts`
- `src/features/evaluation/run-provider-smoke.ts`
- `src/features/evaluation/run-provider-smoke.test.ts`
- `src/features/evaluation/real-world-runner.ts`
- `src/features/evaluation/real-world-runner.test.ts`
- `src/features/evaluation/run-provider.ts`
- `src/features/evaluation/run-provider.test.ts`

**Out of scope**

- Product audit semantics, prompts, agent contracts, finding admission, priority, or remediation text.
- New static analysis, language-specific parsers, regex detection, answer-key-informed behavior, or provider calls.
- Persisting source, prompts, tool inputs/results, raw model output, credentials, paths, or source locations in evaluator artifacts.
- Changing schema versions or public documentation unless a strict existing schema cannot express the repaired behavior. If that happens, stop and open a separate spec-alignment change first.

## Steps

### Step 1: Make recovery-leaf reads schema-exact

In `real-world-artifacts.ts`, replace the path-to-schema fall-through in `readOptionalAuditArtifact` with a single exhaustive classifier that recognizes all artifact paths the evaluation checkpoint store writes: terminal vector, candidate-aware, candidate-grounding draft, evidence-map draft, source-posture draft, overflow ledger, evidence-map recovery leaf, source-posture recovery leaf, and candidate-grounding recovery leaf. Keep the result typed as the existing `AuditCheckpointReader` union. Unknown paths must fail closed; do not default unknown paths to the terminal-vector schema.

Extend `real-world-artifacts.test.ts` to create completed topology entries and one valid recovery leaf for each of the three phases, then call `store.load`. Assert that all three loaded leaf collections contain exactly the saved item and that an incompatible binding still rejects. Use existing checkpoint builders and source-free fixture data; do not hand-roll parallel schemas.

**Verify**: `bun test src/features/evaluation/real-world-artifacts.test.ts` → exit 0, including recovery-leaf reuse assertions.

### Step 2: Give provider smoke the complete shared checkpoint lifecycle

In `run-provider-smoke.ts`, pass every currently supported reusable input and callback from `createEvaluationAuditCheckpointStore` through to `service.audit`, matching the normal evaluator wiring in `real-world-runner.ts:567-635` exactly: candidate-aware checkpoints, context-overflow ledgers, the three recovery-leaf collections, candidate-aware persistence, overflow-transition persistence, and each recovery-leaf persistence callback. Preserve the smoke command's fixed reviewed-plan, one-case, one-variant scope and source-free terminal artifact. Do not duplicate schemas or introduce a smoke-only recovery model.

Extend `run-provider-smoke.test.ts` with a fixture that produces an interrupted/recoverable path and validates that a same-id `--resume true --retry-unfinished true` call uses saved recovery state rather than issuing duplicate provider requests. If the current fake provider cannot produce a normalized overflow without source/model content, add the smallest test-only adapter at the existing test boundary; do not weaken production recovery checks.

**Verify**: `bun test src/features/evaluation/run-provider-smoke.test.ts` → exit 0, including exact resume with no duplicate completed child dispatch.

### Step 3: Retain evaluator-only stage diagnostics on failed trials

In `real-world-runner.ts`, calculate `stageEvidenceCoverage` from the already-collected arrays in both the normal and error return paths. For an error path, verifier evidence is the empty collection unless a complete audit report was actually returned; do not infer findings, locations, or evidence from an exception. Reuse the one `stageEvidenceCoverage` function and existing strict `EvaluationTrial` field. Do not alter `trialStatusFromError`, score calculation, gate logic, or model input.

Add a focused runner test that makes an audit fail after a valid mapping callback (and, if practical, after grounding) and asserts: `status` is failed/cancelled as appropriate, score fields remain null, and `stageEvidenceCoverage` retains the expected and reached counts while verifier count is zero. The test must also prove no answer-key content enters the provider request.

Remove the duplicate `maxParallelVectors` property currently passed to `evaluationBenchmarkProtocolFingerprint` in `runCorpusEvaluation` as a mechanical cleanup while touching the function; retain the same effective value and add no new configuration field.

**Verify**: `bun test src/features/evaluation/real-world-runner.test.ts` → exit 0 with the failed-stage diagnostic assertion.

### Step 4: Reject empty or non-resumable provider evaluations before route setup

Make the selected-case operation a single evaluator-owned helper that rejects an empty split and an unknown/cross-split selector with the stable `invalid-input` error before a review service or configured provider route is constructed. Use that same helper for `runCorpusEvaluation` and the provider command preflight after `loadCorpusPack`, so the selected population cannot drift between validation, fingerprinting, checkpoint creation, and execution. Do not load an answer key into a model-facing view.

Make `parseProviderEvaluationArguments` enforce the same CLI invariants as smoke: `--resume true` requires an explicit `--run-id`, and `--retry-unfinished true` requires `--resume true`. Keep a fresh provider evaluation legal with one diagnostic repetition. Do not change the cost ceiling, plan profile, holdout, or comparison contracts.

Add parser tests for both invalid flag combinations. Add runner/preflight tests for a pack/split with no selectable case, asserting a stable input error and zero fake-provider requests. Where command construction cannot be injected without credentials, test the extracted selection/preflight helper directly rather than adding a live route test.

**Verify**: `bun test src/features/evaluation/run-provider.test.ts src/features/evaluation/real-world-runner.test.ts` → exit 0; invalid selection and invalid resume options fail before any provider request.

## Test plan

- Recovery leaf round-trip: each phase leaf is persisted, selected by the correct strict schema, and reused only with the exact immutable binding.
- Smoke recovery parity: smoke forwards the same shared checkpoint channels as the normal evaluator and cannot re-dispatch a completed recoverable child on explicit unfinished recovery.
- Failed-trial observability: a post-map failure retains source-free aggregate stage counts only; it produces no finding score, report finding, source content, or additional provider call.
- Command preflight: an empty selected split and invalid resume combination fail before provider-route setup or any model request.
- Regression: run the focused commands, then schema/type/lint and full `bun test && bun run check`.

## Done criteria

- [ ] No evaluation checkpoint reader treats an unknown or recovery-leaf path as a terminal vector by default.
- [ ] All three recovery-leaf kinds round-trip through `createEvaluationAuditCheckpointStore.load` under their exact binding.
- [ ] Provider smoke and normal evaluator forward the same checkpoint/recovery lifecycle inputs and callbacks available from the shared store.
- [ ] Failed evaluator trials retain only the permitted aggregate stage-evidence diagnostic.
- [ ] Empty split/case selection and invalid resume flags fail as input errors before configured-route setup, checkpoint creation, or provider dispatch.
- [ ] No product security conclusion, score, prompt, source artifact, or schema version changes.
- [ ] Focused tests, `bun run schema:check`, `bun run typecheck`, `bun run lint`, `bun test`, and `bun run check` pass.

## STOP conditions

- The current artifact paths or checkpoint-store contract differs from the excerpts above.
- Exact recovery requires storing raw model output, source, tool payloads, prompts, credentials, paths, or answer-key labels.
- A fix requires changing audit semantics, candidate admission, or a schema version rather than restoring the existing contract.
- A focused test cannot produce the required state without a live provider call.
- Any verification command fails twice after a narrowly scoped fix.

## Maintenance notes

- Whenever a new persisted audit artifact is added, its path classifier and a round-trip reuse test must be updated in the same change. The safer design is one centrally owned exhaustive artifact registry, not independent write/read conditionals.
- The smoke command must remain a low-cost protocol diagnostic. It shares recovery mechanics with a provider evaluation but never becomes a quality, precision, recall, or release-readiness measurement.
- Stage-overlap counts are a debugging funnel only. They must stay aggregate, source-free, score-neutral, and absent from all model input.
