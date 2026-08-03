# Trust boundaries, terminal state, and exact resume

- **Priority:** P0
- **Effort:** L
- **Risk:** High
- **Status:** Proposed

## Overview

Make one audit run refer to one immutable, explicitly admitted evidence snapshot, one exact executable plan, and one isolated artifact root. Make every terminal status and CI exit derive from the same exhaustive state function. This wave intentionally uses breaking artifact/schema changes and rejects legacy artifacts.

## Problem statement

The current CLI can write output inside target/context, inventory every regular file eagerly, reopen mutable live source after fingerprinting, accept duplicate vector identities, and reuse checkpoints after a human edits executable plan content. Incomplete coverage can return exit 0. Artifact path resolution creates directories even for reads before containment is proven. Product runs have no exclusive writer.

The tool cannot be trusted in CI until the evidence boundary and terminal-state semantics are exact.

## Proposed solution

Introduce five single-owned contracts:

1. **Root topology:** canonical target, context, and output roots are pairwise disjoint in both ancestor directions before any write/read/provider dispatch.
2. **Source admission and immutable snapshot:** a manifest records every included/excluded entry, reason, size, encoding state, and content digest. Model tools use only the included snapshot.
3. **Executable plan identity:** canonical plan/vector content digests include every behavior-affecting field and admitted target/context identity.
4. **Checkpoint binding:** every phase artifact binds run, exact plan/vector digests, snapshot/context, provider/model/route, applicable prompt/tool protocol, and phase.
5. **Terminal-state reducer:** one exhaustive function derives report outcome, manifest outcome/counters, exit code, and evaluation trial status from enabled obligation closures and stop state.

## Contract decisions

### Source admission

- Add a strict feature-owned `SourceAdmissionPolicySchema`, `SourceManifestEntrySchema`, and `SourceSnapshotManifestSchema`; infer types from Zod.
- The policy has explicit include/exclude rules and named default exclusions. It must not accept an arbitrary maximum file count, file size, line count, match count, or total source bytes.
- Standard exclusions (VCS metadata, dependency/vendor caches, build/generated output, local secret stores) are visible rows with stable reasons and are overrideable by explicit operator policy. Do not silently import `.gitignore` semantics as product truth; record whether ignore metadata influenced admission.
- Every eligible regular UTF-8 file admitted by policy appears exactly once with path, byte length, content digest, and snapshot object reference.
- Non-UTF-8/non-regular/symlink entries appear as explicit exclusions or safety errors according to the canonical spec decision; one unrelated binary must not silently remove valid source evidence.
- Context keeps its separate strict Markdown/frontmatter contract and exact line endings.

### Snapshot tools

- Build the snapshot by streaming safe byte transactions into content-addressed objects below a private run work root or an in-memory/on-disk abstraction. Never concatenate the full corpus to compute a digest.
- Derive target fingerprint from canonical sorted `(path, size, contentDigest)` manifest records.
- `repo_list`, `repo_read`, and `repo_grep` operate only on snapshot objects and scoped manifests.
- Range reads preserve exact line endings and expose cursor/completeness metadata when a safe transaction page is used.
- A tool cannot enumerate or open an excluded or non-scoped path.

### Plan identity

- Canonical vector content contains title, rationale, enabled state, canonical scope globs, ordered/identified obligations, limitations, applicability/evidence-basis fields introduced by later waves, and schema/protocol version.
- `vectorDigest = sha256(canonicalVector)` and vector IDs are unique stable projections of that digest. Human-readable titles never determine identity alone.
- `planDigest = sha256(canonical plan behavior + target fingerprint + context digest)`; plan ID is derived from the digest, not timestamp. `createdAt` is metadata outside behavior identity.
- `AttackPlanSchema` rejects duplicate vector IDs/digests, duplicate obligation IDs at the correct scope, zero enabled vectors, and unknown keys.
- Human edits necessarily produce a new digest/ID. An implementation may offer a deterministic `plan validate/reseal` command, but never silently keep the old identity.

### Root and artifact safety

- Validate canonical root topology before `mkdir`, inventory, plan load, checkpoint load, or provider construction.
- Output must be neither equal to nor ancestor/descendant of target/context. Target/context overlap also requires an explicit spec decision; default to rejection because context must remain separately labelled.
- Split artifact read resolution from write resolution. Reads never create directories.
- Walk existing path components without following symlinks. Create only proven missing components below the canonical output root. Revalidate immediately before atomic rename.
- Use restrictive permissions for newly created work/artifact directories/files where supported; document platform limitations.

### Terminal truth

- Disabled plan vectors are `excluded-by-plan`, visible, neutral, and outside the enabled completion denominator. At least one vector must be enabled.
- An enabled vector with no matched admitted source is not automatically clean. It can become source/context-backed `not-applicable` through the execution contract or `incomplete/not-verifiable`; deterministic glob absence alone cannot decide business applicability.
- `completed` requires every enabled obligation to have one valid terminal closure and no phase incomplete/failed/cancelled/not-reached.
- `not-applicable` requires the obligation's exact ID, crisp non-empty reason, and referenced admitted evidence/declared context basis. It is neutral and not a passed test.
- Any incomplete enabled obligation yields operational exit 3. Complete findings yield exit 1; complete no-findings yields 0. Invalid/safety contract input yields 2. A provider/infrastructure stop that prevents a valid report yields 4. Define mixed outcomes explicitly.
- The same reducer produces manifest outcome/counters; counters include enabled, excluded, completed, N/A, incomplete, failed, cancelled, findings, and review-required.

### Run ownership and attempts

- Acquire one exclusive run lock before reading recovery state. Hold it through final manifest/report publication and release it in `finally`.
- Fail closed for every pre-existing lease. Portable PID-file locking has no race-free stale-owner takeover, so the application never unlinks a lease based on process/time inference; an operator resolves a known-abandoned lease before explicit resume.
- Persist a content-free command-attempt artifact immediately after validated root/config identity is available. Transition it atomically from `starting` to exactly one terminal outcome.
- Reached stage observations remain attached even if later report writing fails. Never persist raw provider error text/source/prompts/secrets.

## Implementation steps

### Ticket 1.1 — Specify and centralize root/source admission

1. Update product/security/architecture/artifact specs with the contracts above. Remove contradictory “bounded body” or fixed evidence-cap wording; distinguish safe transaction pages from total evidence limits.
2. Add feature-owned schemas below `src/features/target-inventory/` for policy, manifest entries, exclusions, and snapshot identity.
3. Add a platform root-topology validator shared by target filesystem and artifact store. Do not duplicate path containment logic.
4. Extend strict CLI/config schemas with explicit source admission settings; reject unknown options.
5. Add temp-root tests for relative paths, equality, both ancestor directions, symlink aliases, context overlap, and validation-before-write/provider behavior.

### Ticket 1.2 — Implement immutable streaming snapshot access

1. Refactor `inventoryTarget` so it inventories metadata first and streams admitted files into snapshot storage/hash state.
2. Replace `readFile().split().join()` and whole-file `readFile()` with safe exact byte/line cursor reads. Preserve CRLF/LF and final-newline state.
3. Mount review tools on a `SourceSnapshotPort`, not `JailedReadOnlyFilesystem` live reads.
4. Make list/grep scan only the supplied scoped snapshot manifest. Return continuation/completeness state rather than silently clipping.
5. Add mutation-after-inventory tests proving model tool output remains the fingerprinted snapshot or the run stops with `target-changed` before provider-visible mixed evidence.

### Ticket 1.3 — Seal executable plan identity

1. Define canonical serialization helpers owned by attack planning; use no ad hoc `JSON.stringify` ordering.
2. Add vector/plan digest fields and cross-field refinements. Generate types from schemas.
3. Make planner plan construction create unique canonical identities. Reject duplicate titles only if they create semantically duplicate vectors; distinct canonical content gets distinct IDs.
4. Make audit validate/reseal explicitly edited plans before opening audit-stage provider sessions.
5. Add tests changing every behavior field independently and proving plan/checkpoint identities change.

### Ticket 1.4 — Version and strengthen checkpoint bindings

1. Replace `AuditCheckpointBindingSchema` with exact plan/vector/snapshot/context/provider/model/route/phase/protocol binding.
2. Give each phase its own applicable protocol fingerprint. Terminal results bind the aggregate of every contributing phase.
3. Reject all legacy plan/report/checkpoint versions; remove compatibility/migration branches.
4. Add matrix tests mutating one binding component at a time and proving reuse fails before provider dispatch.

### Ticket 1.5 — Make terminal state exhaustive and fail closed

1. Create one feature-owned terminal classification module with a closed input/output schema.
2. Replace `auditExitCode`, `auditRunOutcome`, report counters, evaluator status projection, and ad hoc CLI catch mapping with this module.
3. Enforce at least one enabled vector and explicit excluded counts.
4. Add table-driven tests for every single outcome and mixed combination. Delete the test expecting incomplete exit 0.
5. Add fake-provider CLI E2E for complete-clean, complete-findings, N/A, incomplete, cancellation, invalid input, provider failure, and report-write failure.

### Ticket 1.6 — Harden artifact storage and run ownership

1. Split artifact read/write resolvers and remove all write side effects from reads.
2. Implement safe component creation and destination revalidation.
3. Generalize the evaluator's exclusive lock pattern into an artifact-store run lease used by product and evaluator.
4. Add command-attempt artifacts and terminal transitions.
5. Add concurrent-process tests, stale lock tests, symlink swap tests, atomic-write interruption tests, and permission tests.

## Files to modify

- `specs/01-product/01-scope-and-workflow.md`
- `specs/03-architecture/01-system-architecture.md`
- `specs/03-architecture/08-reliable-terminal-coverage-and-resume.md`
- `specs/04-contracts/**`
- `specs/05-security/01-security-model.md`
- `specs/06-quality/01-verification-and-operations.md`
- `src/features/target-inventory/**`
- `src/platform/filesystem/**`
- `src/platform/artifact-store/**`
- `src/features/attack-planning/plan.schema.ts`
- `src/features/attack-planning/plan.ts`
- `src/features/audit-execution/audit.schema.ts`
- `src/features/audit-execution/checkpoints.ts`
- `src/features/audit-execution/audit.ts`
- `src/features/review-workflow/runtime/source-tools.ts`
- `src/features/review-workflow/service.ts`
- `src/cli/main.ts`
- generated schema artifacts and colocated tests
- `AGENTS.md`, `CLAUDE.md`, `.agent/IMPLEMENTATION.md`
- standalone relevant pages under `docs/` (never link them to specs)

## Acceptance criteria

- Root overlap is rejected before any directory creation, inventory, artifact read, provider construction, or provider call.
- Artifact reads cannot create a path; descendant symlink tests cannot create/write outside output.
- Inventory of a representative repository does not eagerly retain duplicate full-corpus strings and does not traverse unadmitted metadata/vendor/build trees.
- Every admitted UTF-8 file is fully represented regardless of language, size, line count, or extension.
- Exact CRLF/LF source and context bytes survive snapshot, read, recovery, and digest verification.
- A post-inventory source mutation cannot affect model-visible evidence in that run.
- Editing scope, obligation, enablement, limitation, rationale, or evidence basis invalidates prior checkpoints.
- Duplicate vector/obligation identities fail before any audit work.
- One and only one writer owns a run ID.
- Incomplete/cancelled/failed coverage cannot return 0 or be labelled completed.
- `bun run spec:check`, schema generation/check, focused tests, full unit/coverage/eval checks all pass.

## Risks and mitigations

- **Snapshot storage growth:** content-address objects and deduplicate within a run; use retention policy later. Do not trade storage for evidence omission.
- **Cross-platform safe writes:** isolate platform-specific no-follow behavior behind the artifact store and test supported platforms; fail closed where guarantees are unavailable.
- **Changed CI exits:** release as an explicit breaking version and publish a migration note for pipeline owners, not a compatibility mode.
- **Plan editing ergonomics:** provide a deterministic validate/reseal command or clear error; never preserve stale identity.

## Dependencies

- None on later waves. This is the foundation for durable work, findings, prompts, and valid evaluation.
- Choose the supported release platforms before finalizing filesystem no-follow guarantees.

## Out of scope

- Prompt quality tuning or model comparison.
- Finding priority/remediation.
- Executing VCS commands inside the audit harness.
- Silently treating ignore files as authority.
- Legacy artifact migration.
