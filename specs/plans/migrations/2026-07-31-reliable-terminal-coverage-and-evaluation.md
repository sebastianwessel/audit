# Reliable terminal coverage and evaluation semantics

Status: implemented breaking migration on 2026-07-31.

The reliability remediation replaces ambiguous plan obligations, lossy terminal coverage, and score-eligible incomplete evaluation trials. It introduces the canonical phase ledger and closure tokens in `03-architecture/08-reliable-terminal-coverage-and-resume.md`, and the evaluation contracts in `08-evaluation/05-adjudicated-scoring-and-recovery.md`.

Breaking changes:

- Plan obligations use a stable risk-positive `obligationId` with owned statement/requirement text; question/criterion index pairs are removed.
- Source posture uses risk-positive conclusion tokens.
- Audit report/checkpoint and evaluation trial schemas gain the new phase/coverage semantics and reject legacy versions.
- Corpus answer keys declare coverage class and role-specific accepted source ranges; old primary-location keys are rejected.
- Evaluation trial scores are nullable and unavailable for non-completed trials.

No compatibility reader, migration adapter, or synthesized fallback is permitted. Existing provider/evaluation artifacts are retained only as historical diagnostic evidence and are not comparable with post-migration runs.

Verification evidence:

- `src/features/audit-execution/audit.schema.ts` accepts only report schema version 12 and terminal vector checkpoint schema version 11; `evaluation/src/corpus.schema.ts` accepts only the new strict corpus/evaluation versions.
- Colocated audit, checkpoint, corpus, scorer, runner, baseline, and comparison tests cover terminal closure, phase reuse, cancellation, ineligible scoring, coverage classes, role ranges, and legacy-artifact rejection.
- The deterministic project suite (`bun run check`, `bun run eval`, and `bun run eval:corpus:integration`) passed after the migration. This confirms protocol integrity only; it does not establish provider quality or corpus readiness.
