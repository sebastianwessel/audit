---
id: TICKET-301
title: Resume unfinished audit and evaluation work from exact phase checkpoints
wave: 03-evaluator-recovery
status: completed
parallel_group: none
depends_on: [REL-001-increment]
blocked_by: []
spec_refs:
  - specs/03-architecture/08-reliable-terminal-coverage-and-resume.md#checkpoint-and-retry-protocol
  - specs/08-evaluation/05-adjudicated-scoring-and-recovery.md#evaluation-checkpointing
  - specs/plans/2026-07-31-reliability-remediation-action-plan.md#wave-3--resumable-evaluation-and-honest-scoring
write_scope:
  - src/cli/
  - src/features/audit-execution/
  - src/features/evaluation/
  - docs/
  - .claude/agents/
  - specs/
read_scope:
  - AGENTS.md
  - .agent/IMPLEMENTATION.md
  - src/features/audit-execution/
  - src/features/evaluation/
  - src/features/review-workflow/
  - src/platform/artifact-store/
contract_readiness: ready
generated_contracts: none
ticket_readiness: ready
slice_type: vertical-reliability-recovery
---

# Goal

Resume an explicitly requested unfinished audit or provider-evaluation trial from its newest exact, validated phase predecessor without exposing evaluator work or presenting incomplete coverage as clean.

## Decision ledger

- `--retry-unfinished true` is the sole explicit retry operation. It replaces the misleading failed-only retry name; no compatibility alias is retained.
- A matching completed or skipped terminal vector stays reusable. An incomplete, failed, or cancelled terminal result is retained for history but is not reused when unfinished recovery is requested.
- Map, posture, and canonical-grounding drafts retain their existing exact binding and are reused through the existing product checkpoint constructors/loaders. No evaluator-specific checkpoint schema is introduced.
- Evaluation draft checkpoints live under the ignored `<evaluation-run>/.work/` root. Public evaluation JSON and Markdown contain only their existing source-free projections.
- No recovery path broadens scope, infers source semantics, adds a parser/static rule, or changes provider routing.

## Implementation steps

1. Centralize terminal reuse selection in `audit-execution/checkpoints` with one `retryUnfinished` input.
2. Wire audit CLI and provider evaluation to that same operation; retry an incomplete, failed, or cancelled trial only when explicitly requested.
3. Mount the evaluator work root through an evaluation-owned port that delegates construction, compatibility validation, and atomic writes to the product checkpoint feature.
4. Preserve existing terminal phase observations and derive a non-clean product run manifest when any vector is incomplete, failed, or cancelled.
5. Test exact-binding rejection, private work-root separation, unfinished-vector exclusion, phase continuation after a saved map, and the source-free incomplete trial projection.
6. Update operator and agent guidance without linking public documentation to internal specs.

## Acceptance

- A resumed matching map is not regenerated; resumed work continues at the next phase.
- An incomplete, failed, or cancelled vector is retried only after `--retry-unfinished true`; completed work is never repeated.
- A provider-evaluation retry delegates to the same checkpoint compatibility rules and cannot reuse a different model, route, plan, target, or protocol.
- Public artifacts never include evaluator `.work` content.
- An audit manifest never reports `completed` when any vector is incomplete, failed, or cancelled.
- Focused recovery tests and the full required verification suite pass.

## Current proof

- Product and evaluator checkpoint recovery share `loadReusableAuditVectorResults` with explicit unfinished selection.
- A private evaluator work-root store uses the existing strict map, posture, grounding, and terminal checkpoint artifacts.
- Focused tests cover exact binding, incomplete retry selection, private-artifact separation, and continuation after a saved evidence map.
- Product CLI and provider-evaluation operator guidance use `--retry-unfinished true` consistently.
- At its initial close, this ticket passed the then-current full local suite. The deterministic corpus run remained correctly diagnostic with 0/6 completed trials and no score-eligible findings; the current completion record below is the authoritative verification count.

## Completion verification

The Wave 2 migration and Wave 3 scoring work are settled. Full offline
verification passed on 2026-07-31: `spec:check`, `schema:check`, `typecheck`,
`lint`, `bun test` (252 passing), `test:coverage`, `eval`, `eval:corpus`, and
`check`. The complete reviewed-plan resume fixture proves a completed trial
reuses its checkpoint without another model dispatch; incomplete work remains
non-scored until explicit unfinished recovery.

## Review reopening

Review `specs/plans/reviews/reliability-remediation/20260731-cancelled-resume/`
reopened this ticket with blocking `REVIEW-001`: cancelled terminal vector
coverage is not excluded by the product checkpoint loader when
`retryUnfinished` is requested. The shared loader now treats `cancelled` like
`incomplete` and `failed`; its regression test proves reuse remains available
without explicit recovery and is excluded with it. The focused recovery suite
and `bun run check` pass.
