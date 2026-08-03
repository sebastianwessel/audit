---
id: TICKET-201
title: Replace indexed plan obligations with canonical risk-positive identities
wave: 02-risk-positive-obligations
status: completed
parallel_group: none
depends_on: [REL-001-increment]
blocked_by: []
spec_refs:
  - specs/03-architecture/08-reliable-terminal-coverage-and-resume.md#obligation-closure
  - specs/08-evaluation/05-adjudicated-scoring-and-recovery.md#corpus-integrity-and-claims
  - specs/plans/2026-07-31-reliability-remediation-action-plan.md#wave-2--one-canonical-obligation-identity
write_scope:
  - src/features/attack-planning/
  - src/features/audit-execution/
  - src/features/review-workflow/
  - src/features/evaluation/
  - evaluation/corpora/reviewed-plans/
  - evaluation/research-corpora/private-mixed-language-v1/reviewed-plans/
  - artifacts/schemas/
  - specs/
read_scope:
  - AGENTS.md
  - .agent/IMPLEMENTATION.md
  - src/features/attack-planning/
  - src/features/audit-execution/
  - src/features/review-workflow/
  - src/features/evaluation/
  - evaluation/corpora/
  - evaluation/research-corpora/private-mixed-language-v1/
contract_readiness: ready
generated_contracts: bun run schema:generate
ticket_readiness: ready
slice_type: horizontal-reliability-foundation
phase_gate_exception: true
---

# Goal

Make each approved review unit one stable, risk-positive `obligationId`; remove all question/criterion index pairs and ambiguous posture polarity without a compatibility path.

## Context Digest

The previous contract represented a single review unit three ways: index pair, derived key, and separate obligation id. It also allowed control-positive questions, making `supported` ambiguous. REL-001 requires terminal closure to reference one plan-owned review unit; CAP-055 and CAP-067 now require risk-positive semantics.

## Implementation Approach

The plan schema owns `ReviewObligationSchema { obligationId, riskStatement, evidenceRequirement }` and `PlanObligationReferenceSchema { obligationId }`. Every map, posture, discovery, grounding, verification, closure, finding, checkpoint, agent contract, prompt, fixture, reviewed plan, and evaluation helper imports that one reference schema. Source posture owns only `risk-supported|risk-contradicted|inconclusive`. Zod inferred types remain the only TypeScript boundary types.

## Decision Ledger

- Clean breaking boundary: reject old indexed plans/checkpoints/reports; no adapters, aliases, or fallback parsing.
- No parser, regex, language rule, corpus label, or deterministic security interpretation is introduced.
- JSON Schema snapshots are generated, never hand-edited.
- Public documentation is N/A for this internal contract rename; agent/spec guidance is updated in the same ticket.

## Action Plan

1. **Preflight:** run `bun run typecheck`; confirm the approved readiness record and this ticket. Proof: baseline passes before edits.
2. **Contract tests first:** revise side-by-side plan, posture, map, discovery, verification, closure, and evaluation contract tests to construct only risk-positive obligations and assert that index-pair/legacy posture tokens fail. Expected proof: tests fail before contract implementation changes.
3. **Phase Gate: canonical schema:** replace the feature-owned plan and posture schemas plus helpers; run `bun run schema:generate && bun run schema:check && bun run typecheck`. Do not edit schema snapshots directly. Proof: generated artifacts change and no old fields compile.
4. **Phase Gate: pipeline propagation:** replace every reference/identity/provenance comparison and model-facing contract/instruction in the listed feature scopes. Preserve vector scope, redaction, and deterministic checks only. Proof: canonical contract checks reject retired indexed fields and old posture tokens in model or persisted input.
5. **Evaluation fixtures:** update reviewed plans and deterministic fixtures to explicit risk-positive obligations; retain answer-key isolation and language-neutral paths. Proof: corpus loading and deterministic evaluation pass.
6. **Close:** update capability/spec/agent guidance and migration status, regenerate schemas, then run the full required command set. Record actual changed files and proof in Handoff.

## Requirements Traceability

| Requirement | Implementation and proof |
| --- | --- |
| REL-001 | `coverage-closure` keys every closure only by `obligationId`; tests reject stale indexed references. |
| CAP-055 | Planner and verifier contracts preserve one risk statement/evidence requirement per stable obligation. |
| CAP-067 | Posture contract/instructions expose only risk-positive conclusion tokens. |
| EVAL-084 | Evaluation fixtures and trial projections parse the same canonical plan identity. |

## Contract Traceability

`plan.schema.ts` is the source contract. `schema:generate` owns JSON Schema artifacts. No OpenAPI/client generator applies; Zod and generated JSON Schema are the existing approved contract/generation path.

## Spec Drift Controls

Forbidden: interpreting risk text deterministically; retaining index aliases; converting an unknown language to an error; putting corpus expectations in prompts; weakening strict Zod objects; preserving legacy artifact readers.

## Generator And Type Plan

Change Zod schemas first, export only `z.infer` types, run `bun run schema:generate`, then `bun run schema:check` and `bun run typecheck`. Handwritten interfaces/enums are not permitted for these persisted/model shapes.

## Test-First Order

1. Contract rejection tests for old index and posture tokens.
2. Identity/provenance/closure happy and invalid-reference tests.
3. Fake-provider workflow and corpus tests.
4. Implementation, schema generation, and full checks.

## Modularity And Reuse Plan

Keep the only canonical reference in `attack-planning/plan.schema.ts`; posture conclusion tokens stay in `audit-execution/source-posture/contract.ts`. Consumers import those schemas/helpers. Do not move feature-specific logic to `shared/` and do not copy schemas or token enums.

## Slice Strategy

Horizontal foundation exception: this contract touches all audit phases atomically. It unblocks resumable phase checkpoints and honest scorer matching; partial propagation would leave a broken protocol. The next vertical slice is evaluator phase-resume.

## Acceptance

- Every persisted/model plan reference is exactly `{ obligationId }`.
- Every obligation explicitly states risk-positive review intent and required evidence.
- `risk-supported`/`risk-contradicted` are unambiguous model judgments; deterministic code validates only declared state/provenance.
- Old fields/tokens/artifacts fail closed.
- No source cap, parser, static finding rule, provider fallback, or evaluation leakage is added.

## Acceptance Test Matrix

| Path | Test owner | Evidence |
| --- | --- | --- |
| Valid risk-positive plan through audit | attack-planning/audit tests | canonical obligation is preserved end to end |
| Legacy indexed input | plan/posture contract tests | strict rejection |
| Invalid obligation provenance | map/discovery/verification/closure tests | strict rejection |
| Unknown-language source | audit/workflow integration tests | same canonical path |
| Corpus reviewed plan | evaluation corpus/runner tests | target/answer-key isolation persists |

## Review And Verification Plan

Review every changed import against the single schema owner; run the required checks and `rg` anti-drift query from Action Plan step 4. Verify generated artifact diffs are exclusively produced by the generator and no write falls outside scope.

## End-To-End Definition Coverage

Actor: plan author/evaluator. Entrypoint: approved plan or evaluator reviewed plan. Data: source-free plan/phase artifacts. State: draft → approved → mapped → postured → discovered → grounded → verified/closed. Permissions: existing human approval and evaluator isolation unchanged. Recovery: exact bindings continue to be validated. Observability: content-free ids/tokens only. CLI/frontend/release/supply-chain: N/A; no public command or dependency changes.

## Operational Path Coverage

Validation rejects stale inputs before target access; provider failures retain existing retry/recovery semantics; generated schemas detect drift. No new persistence root, background work, network, or configuration is introduced.

## Verification

`bun run schema:generate && bun run schema:check && bun run spec:check && bun run typecheck && bun run lint && bun test && bun run test:coverage && bun run eval && bun run eval:corpus && bun run check`

## Non-goals

Phase-ledger implementation, evaluator checkpoint work-root, answer-key v3 scoring, corpus promotion, and a paid provider run are separate tickets.

## Handoff

Completed on 2026-07-31. The plan, map, posture, discovery, grounding,
verification, checkpoints, evaluator fixtures, and generated schemas use only
the risk-positive `obligationId` contract. Retired indexed references and old
posture tokens fail closed. Full offline verification passed after the
migration: `schema:generate`, `schema:check`, `spec:check`, `typecheck`,
`lint`, `bun test` (252 passing), coverage, `eval`, `eval:corpus`, and
`check`.
