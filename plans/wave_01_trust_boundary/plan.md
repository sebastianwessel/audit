# Wave 01: trust boundary

## End-To-End Outcome

A developer or CI job receives a truthful static-audit result based only on an immutable admitted source snapshot. Invalid topology fails before side effects; edited plans require resealing; incomplete coverage cannot look complete.

## Implementation Order

TICKET-101 builds the contract-first clean rebuild with strict Zod schemas, generated schema checks, test-first unit/contract/integration/E2E evidence, then runs the hermetic verification suite.

## Slice Strategy

Horizontal foundation exception: snapshot, identity, artifact publication, and terminal classification are one security boundary. It unblocks the next vertical slice. Frontend/client UX, accessibility, and responsive design are not applicable: v1 is CLI-only.

## Operational Path Coverage

Security, privacy, resilience, observability, recovery, data integrity, release, and supply-chain paths are covered by strict no-content records, atomic files, explicit cleanup, source-free attempts, no new dependencies, and the existing locked Bun toolchain.

## Parallelization and Isolation

No parallel writer in this wave; the write scope is intentionally shared. Read-only discovery is safe, and later disjoint tickets may run in parallel after this foundation is verified.

## Resume Status

Use `_status.yaml` for pause/resume/current proof. A partial ticket remains partial until its exact command proof exists.
