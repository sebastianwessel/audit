---
id: TICKET-101
title: Build immutable evidence and terminal-truth boundary
wave: 1
status: in_progress
parallel_group: ""
depends_on: []
blocked_by: []
spec_refs:
  - specs/01-product/01-scope-and-workflow.md
  - specs/02-capabilities/capability-inventory.md
  - specs/03-architecture/01-system-architecture.md
  - specs/03-architecture/08-reliable-terminal-coverage-and-resume.md
  - specs/03-architecture/09-immutable-evidence-and-terminal-truth.md
  - specs/04-contracts/01-artifact-contracts.md
  - specs/05-security/01-security-model.md
  - specs/06-quality/01-verification-and-operations.md
write_scope:
  - src/features/target-inventory/
  - src/features/attack-planning/
  - src/features/audit-execution/
  - src/features/evaluation/
  - src/platform/filesystem/
  - src/platform/artifact-store/
  - src/platform/harness/
  - AGENTS.md
  - src/features/review-workflow/
  - src/cli/
  - artifacts/
  - tests/
  - docs/
read_scope:
  - AGENTS.md
  - .agent/IMPLEMENTATION.md
  - specs/
  - src/
  - tests/
contract_readiness:
  status: ready
  required_contracts:
    - SourceAdmissionPolicySchema
    - SourceSnapshotManifestSchema
    - AttackPlanSchema v2
    - AuditCheckpointBindingSchema v13
    - AuditTerminalClassificationSchema
  missing_contracts: []
generated_contracts:
  status: not_applicable
  rationale: Strict Zod schemas are the source contract; existing schema generation and drift checks produce derived artifacts. No separate IDL generator exists or is required.
  command: bun run schema:check
ticket_readiness:
  status: implementation_ready
  open_decisions: []
  ambiguous_phrases: []
slice_type: foundation_exception
phase_gate_exception: true
---

## Goal

Deliver one safe, compilable boundary: canonical disjoint roots, immutable source snapshot, sealed plan/checkpoint identity, exclusive artifact lease, and one truthful terminal classification. This is a contract-first clean rebuild with no compatibility code.

## Context Digest

CAP-100–105 and REQ-049–054 require source-only evidence, exact resume, privacy-safe artifacts, and explicit failure/recovery. The CLI is the public entrypoint; frontend/client UX is not applicable. No provider, dependency, or target execution behavior changes.

## Implementation Approach

Place source-admission and snapshot code under `src/features/target-inventory/`; canonical plan identity under `src/features/attack-planning/`; terminal classification under `src/features/audit-execution/`; and containment/lease mechanics under `src/platform/artifact-store/`. Reuse existing strict Zod primitives, filesystem jail, content-free observability, atomic writer, and schema check. Do not create a parser, static rule, source cap, approval state, fallback, compatibility adapter, or duplicate path helper.

## Decision Ledger

| Topic | Fixed contract |
| --- | --- |
| Source | One explicit admitted/excluded manifest and immutable private snapshot per retained run. |
| Identity | SHA-256 canonical plan/vector digests; editing uses validate/reseal. |
| Output | Pairwise-disjoint roots, read-side-effect-free resolver, atomic write, one lease. |
| Completion | One exhaustive reducer owns report, manifest, evaluator status, and exit code. |
| Compatibility | Reject legacy artifacts; no migration or fallback. |

## Action Plan

1. Preflight: read `AGENTS.md`, `.agent/IMPLEMENTATION.md`, and the listed spec refs; run `bun run spec:check`, `bun run schema:check`, `bun run typecheck`, and focused existing tests. Phase Gate:preflight records pass proof before edits; a failure is blocked proof.
2. Contract first: add strict Zod schemas and schema-derived types in `src/features/target-inventory/`, `src/features/attack-planning/`, and `src/features/audit-execution/`; update schema generation artifacts with `bun run schema:check`. Phase Gate:contracts require tests rejecting unknown keys, duplicate identities, zero enabled vectors, root overlap, and legacy versions before service edits.
3. Test-first: add colocated unit/schema contract tests plus `tests/integration/` and `tests/e2e/` cases for valid request success, invalid topology, symlink/escape denial, CRLF/LF snapshot preservation, post-inventory mutation, stale checkpoint, cancellation, report-write failure, concurrent/unresolved lease, and redacted logs. Run the focused `bun test` command and retain expected failing proof before business logic.
4. Implement `src/features/target-inventory/` admission/snapshot and `src/features/review-workflow/` snapshot-only tools. Implement `src/features/attack-planning/` canonical serialize/validate/reseal. Implement `src/platform/artifact-store/` separate read/write resolvers and lease. Implement `src/features/audit-execution/terminal-classification` and replace duplicate CLI/evaluator projections. Preserve source-free telemetry, safe transaction continuation, cancellation, recovery, and no-target-write behavior.
5. Update `src/cli/` composition so topology validation runs before mkdir, inventory, plan/checkpoint reads, provider construction, or dispatch. Update `docs/` only for implemented end-user behavior; docs must not link specs. Run focused test commands after each phase and verify no static parser, `any`, `unknown`, unchecked cast, duplicate schema, or duplicate path logic is introduced.
6. Review changed files against this ticket and all spec refs; run `bun run spec:check`, `bun run schema:check`, `bun run typecheck`, `bun run lint`, `bun test`, `bun run test:coverage`, `bun run eval`, `bun run eval:corpus`, and `bun run check`. Done proof requires expected pass output, >=80% coverage, all acceptance rows implemented/tested, and no spec drift; otherwise mark partial with resume notes.

## Requirements Traceability

CAP-001/002/004/006–012/100–105 and REQ-049–054 map to the action plan in order: topology, snapshot, plan identity, checkpoint, terminal reducer, lease, artifact safety, and end-to-end CLI proof.

## Contract Traceability

`SourceAdmissionPolicySchema`, `SourceSnapshotManifestSchema`, AttackPlan v2, AuditReport v15, checkpoint v13, `AuditTerminalClassificationSchema`, and command-attempt schema are strict source-owned contracts. Schema-derived TypeScript types are mandatory; schema check is the generator/drift proof.

## Spec Drift Controls

The listed spec refs and REQ-049–054 are the source spec anchors. Forbidden interpretations: live target reads after inventory, a total evidence cap, automatic clean empty scope, stored approval state, output overlap, legacy compatibility, provider dispatch after identity failure, and separate exit/counter reducers. Review the ticket, contract anchors, acceptance matrix, and specs before status becomes done.

## Generator And Type Plan

Existing Zod schema generation is the deterministic generator; `bun run schema:check` is generation, generated-test, compile/type, and drift proof. Generated source-derived types replace manual contract mirrors. A separate code generator is not applicable; no weak types, `any`, `unknown`, open maps, or unchecked casts are allowed at closed boundaries.

## Test-First Order

Add failing contract tests before logic for the success path and every unhappy path: invalid validation, root/path denial, mutation, timeout/cancellation, retry/resume, report failure, concurrent writer, cleanup, and redaction. Add integration/E2E tests before CLI composition. Fake providers remain test doubles only; no production fake/mock/stub/no-op path is allowed.

## Modularity And Reuse Plan

Feature schemas and logic stay in their vertical domain folders; platform code owns only filesystem/artifact mechanics. Reuse shared strict contracts, normalizers, errors, observability, and existing jail helpers only when the invariant is exact. Do not move feature-specific logic to `src/shared/`, duplicate canonical serialization, or add an unrelated abstraction.

## Slice Strategy

Foundation exception with phase gates: splitting source snapshot from identity/terminal publication would allow a mixed unsafe run. The next vertical slice is durable obligation work. No frontend/client screen, accessibility, responsive UI, or design component applies to the CLI product.

## Tasks

- Implement only the approved contracts and code paths in `write_scope`.
- Preserve the read-only/no-network target safety boundary and privacy-safe logs.
- Keep snapshots private, retained only with resumable work, then remove them during work-root cleanup.

## Acceptance

- Root overlap fails before any I/O/provider dispatch; snapshot tools never read mutable target bytes.
- Editing any behavior field invalidates plan/checkpoint identity.
- Reads never create output paths; writes cannot escape by symlink or race.
- Every enabled obligation reaches a truthful terminal state; incomplete work never returns complete.
- One run owner and one content-free attempt outcome exist.

## Acceptance Test Matrix

| Requirement | Test | Status |
| --- | --- | --- |
| REQ-049 | topology/no-side-effect integration and E2E tests | planned |
| REQ-050 | snapshot admission, CRLF/LF, mutation, privacy tests | partial: mutation-safe CLI resume E2E added; admission/line-ending/privacy coverage remains distributed across focused tests |
| REQ-051 | digest/checkpoint mutation matrix | planned |
| REQ-052 | terminal reducer table and CLI E2E | partial: terminal-reducer tests plus audit/resume and report-publication-failure CLI E2E |
| REQ-053 | cursor continuation/incomplete coverage tests | planned |
| REQ-054 | lease, unresolved-lease, interruption, atomic publication tests | partial: shared product/evaluator fail-closed lease tests and report-publication-failure CLI E2E; interruption remains |

## Review And Verification Plan

Review every changed file against the ticket, source specs, contract traceability, and acceptance matrix. Verify modular placement, strict typing, schema generation/drift, no duplicate logic, source-free logs, security/privacy, resilience, recovery, production behavior, no new dependency/supply-chain change, and test coverage before done.

## End-To-End Definition Coverage

Actor/consumer: developer or CI. Entrypoint/reachability: plan/audit CLI. Contracts/data: strict config, manifest, sealed plan, checkpoint, report, attempt. States: valid, excluded, not-applicable, incomplete, failed, cancelled, completed. Side effects: private snapshot and atomic output only. Permissions: jailed read-only target plus output-root write. Recovery: exact checkpoint/lease resume. Observability: source-free observations. Owner: target-inventory, attack-planning, audit-execution, artifact-store. Final state/acceptance/verification: the terminal reducer and command suite. Frontend/client is N/A.

## Operational Path Coverage

Security/privacy: no source/prompt/tool payload in logs. Performance/resilience: streaming snapshot and transaction continuation, no evidence omission. Data integrity/recovery: digests, atomic files, lease, exact resume. Production/release/supply chain: no dependency or release change; pinned Bun/lockfile policy remains unchanged. Invalid input, cancellation, provider failure, and report failure are explicit unhappy paths.

## Verification

Run `bun run spec:check`, `bun run schema:check`, `bun run typecheck`, `bun run lint`, `bun test`, `bun run test:coverage`, `bun run eval`, `bun run eval:corpus`, and `bun run check`. Live-provider verification is not applicable unless separately opt-in.

## Non-goals

Prompt tuning, provider/model selection, parser/AST work, target execution, network calls, live attacks, finding triage, external approval workflow, frontend/client UX, and compatibility migration.

## Handoff

Publish changed-file list, focused/full command proof, acceptance matrix status, coverage output, residual risks, and `_status.yaml` resume notes. A partial or blocked state must name the exact failed command and retained safe checkpoint boundary.
