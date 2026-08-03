# Production reliability implementation plan

Status: approved. Source requirements are the approved `specs/` tree and the user-approved clean rebuild. This plan uses a horizontal foundation exception first, then vertical end-to-end increments.

## Waves

| Wave | Outcome | Tickets | Status |
| --- | --- | --- | --- |
| 01 | Immutable source, sealed plan, safe output, and truthful terminal status | TICKET-101 | ready |
| 02 | Durable obligation work ledger and Harness continuation segments | planned follow-up | planned |
| 03 | Finding/report/privacy contract and prompt protocol repair | planned follow-up | planned |
| 04 | Evaluation, corpus evidence, release and supply-chain gates | planned follow-up | planned |

## Requirement coverage and traceability

The first foundation covers CAP-001, CAP-002, CAP-004, CAP-006–012, CAP-100–105 and REQ-049–054. Its end-to-end definition chain is developer/CI -> CLI -> validated roots -> source snapshot -> sealed plan -> snapshot-scoped audit -> terminal reducer -> atomic report/exit. The actor, entrypoint, reachability, contracts, data lifecycle, states, side effects, permissions, recovery, observability, owner, final state, acceptance, and verification are specified in `specs/01-product/01-scope-and-workflow.md`, `specs/03-architecture/08-reliable-terminal-coverage-and-resume.md`, and `specs/03-architecture/09-immutable-evidence-and-terminal-truth.md`.

## Implementation order

1. Run the first foundation contract-first clean rebuild ticket with test-first proof.
2. Review the changed boundary against specs and run the hermetic check suite.
3. Mark the ticket done only with all acceptance evidence; otherwise retain partial status and resume notes.
4. Start the durable-work follow-up only after the snapshot, lease, checkpoint, and terminal contracts compile and have drift checks.

## Slice strategy

The first foundation is a horizontal exception. The snapshot, plan identity, artifact lease, and terminal reducer share identity and state invariants; independently shipping one would create an unsafe mixed boundary. It unblocks the next vertical slice: an audit that resumes exact obligation work without losing evidence. Unit, contract, integration, and end-to-end tests are mandatory; no frontend/client surface exists in v1 (N/A).

## Generator and type ownership

Strict Zod schemas are the source contracts and `z.infer` supplies types. Existing schema generation/check is the deterministic generator and drift check; no handwritten duplicate interfaces or weak boundary types are permitted. Contract code lives in feature-owned modular folders. No new dependency, provider, UI, database, network integration, or supply-chain choice is in scope.

## Verification and operational path coverage

Each ticket uses test-first valid-request and unhappy-path coverage for invalid roots, symlink escapes, snapshot mutation, stale checkpoint, cancellation, report-write failure, concurrency, cleanup, redaction, recovery, and exit codes. `bun run spec:check`, `bun run schema:check`, `bun run typecheck`, `bun run lint`, `bun test`, `bun run test:coverage`, `bun run eval`, `bun run eval:corpus`, and `bun run check` are the final hermetic verification commands. Live provider tests remain opt-in. The project 80% coverage threshold remains in force.

## Parallelization

The initial implementation ticket is intentionally local because its write scope overlaps contracts, filesystem adapters, CLI, audit terminal state, and tests. Later sidecar agents are read-only discovery or use disjoint write_scope and are integrated centrally.

## Self-Audit

Assumptions: local macOS/Linux filesystems support the specified component inspection and same-directory atomic rename; unsupported guarantees fail closed. Evidence: approved foundation contracts, migration note, and successful `bun run spec:check`. Blockers: none. Security/privacy, resilience, observability, recovery, operations, release, and supply-chain effects are assigned to the ticket or explicitly N/A. Final completion requires all spec requirements implemented, no gaps, no unresolved implementation work, no unapproved fake/mock/stub/placeholder, and full end-to-end alignment.
