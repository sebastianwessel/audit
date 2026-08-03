# Governance and decisions

Status: auto-approved at bootstrap on 2026-07-27 by explicit project instruction. Future material scope or security changes require a new review record.

## Decisions

| ID | Decision | Rationale | Verification |
| --- | --- | --- | --- |
| DEC-001 | TypeScript and Bun own runtime, packages, and tests. | One coherent toolchain. | Bun version, install, and test checks. |
| DEC-002 | @purista/harness is the sole agent/workflow runtime. | Centralized typed loops, providers, tools, sandbox, and lifecycle. | Harness builder/type tests. |
| DEC-003 | Strict Zod schemas are the only persisted/tool-boundary type source. | Prevents duplicate definitions. | Schema contracts and generated drift check. |
| DEC-004 | v1 is static, read-only, and no-network for target access. | Limits blast radius and prevents probing running instances or executing real attacks. | Sandbox, permission, path-jail, and network-denial tests. |
| DEC-005 | A matching executable plan is required between planning and audit; organizational approval is external. | Keeps scope visible and controllable without imposing a workflow state. | Audit rejects malformed or target/context-mismatched plans. |
| DEC-006 | Fixes are report text only; target files are never mutated. | Avoids irreversible agent side effects. | Mutation tests. |
| DEC-007 | One private package with deep domain folders until a stable public boundary exists. | Reuse without premature workspace complexity. | Import-boundary review. |
| DEC-008 | Use hybrid vertical slices with colocated unit tests. | Keeps each capability schema, logic, and tests discoverable while isolating infrastructure adapters. | Structure check and side-by-side test review. |
| DEC-009 | The reviewed target is language-agnostic; TypeScript/Bun is implementation-only. | Security review scope must follow bounded source evidence, not the reviewer’s own runtime language. | Unknown-extension inventory, generic language-tag, and multi-language corpus tests. |
| DEC-010 | Every audit uses one immutable admitted source snapshot, and target/context/output roots are pairwise disjoint. | A fingerprint is meaningful only when every later tool reads exactly the admitted bytes; artifact output must never become input evidence. | Root-topology, snapshot mutation, exact digest, artifact-jail, and checkpoint-binding tests. |

## Scope

In scope: repository source inventory, optional per-use-case Markdown/frontmatter context about surrounding systems/deployment/setup/data/controls, model-assisted attack-vector planning, human plan editing, read-only evidence gathering, PII/secret/data-protection review, source-backed confirmed claims with limitations, Markdown/JSON reports, CI exit codes, and optional provider adapters. Classification, urgency, confidence language, impact summaries, and remediation are human post-confirmation triage, not product finding protocol.

Out of scope for v1: dynamic testing, attacks against running instances, exploit or payload execution, target compilation or test execution, network/API probing, browser automation, remote repositories, source edits, pull-request comments, distributed workers, web UI, accounts, database history, and formal certification.

Change normative behavior in specs first, then update guidance, generated artifacts, code, tests, and docs. Persisted-artifact changes require a migration note under specs/plans/migrations/. The supported filesystem guarantee is macOS and Linux local filesystems that support component inspection and same-directory atomic rename; the artifact store fails closed when it cannot establish the required guarantee. Private snapshots persist only while a resumable attempt is retained, then are securely deleted with the run-work-root cleanup; a later run builds a new snapshot.
