# Claude Code guidance

Read [`AGENTS.md`](./AGENTS.md) first. It is the canonical repository guidance and links to the normative specs, implementation conventions, safety boundary, agent roles, and required checks.

For a human-requested audit-plan change, use the project-local [`audit-plan-authoring` skill](./.claude/skills/audit-plan-authoring/SKILL.md). It creates and edits only constrained drafts, then validates/reseals a new immutable plan pair; never edit sealed executable plans directly.

The implementation uses TypeScript/Bun, but reviewed repositories are language-agnostic; do not introduce a target-language allowlist.

Real-world evaluation data is trusted evaluator input, not target evidence. Preserve the separation among pinned corpus source snapshots, reviewed plans, answer keys, profile-specific baselines, and ignored generated runs. A reviewed plan is strict human guidance without expected locations or answer-key data; bind it to the live inventory, skip provider planning, and never compare it to a generated-plan baseline. Use `bun run eval:corpus:integration` for deterministic plumbing only; it cannot measure detection quality. An opt-in provider run defaults to one diagnostic repeat; repeated experiments record their selected count and report agreement or distribution only when defined.

Only a schema-v5 `dual-reviewed` answer key can contribute to real-world readiness. It must preserve two distinct evaluator-only human `include` judgments that agree with a source-only-applicable vulnerable finding, finding-label coverage class, finalized categories, relevant paths, and patched expectation; a resolver may document disagreement but cannot promote it. For ordinary internal development, a schema-v5 `ai-assisted` targeted key with one traceable source-only AI review is allowed and is run once by default; it is never an external reliability or provider-selection claim.

A private holdout is a separate steward-controlled corpus pack. A provider run against it must verify a source-free detached Ed25519 attestation, supplied with a public key, that binds the exact pack digest to a frozen readiness decision. Never load a private key, answer key, source content, or readiness report through that mechanism; persist only the minimal attestation reference.

The candidate registry is deliberately pre-corpus: it contains pinned metadata leads only. Its records must never be passed to an agent, copied into an answer key, or used to imply corpus readiness.

Use the platform configuration loader for local `.env` values. Do not add another dotenv parser or access provider credentials directly outside the provider adapter.

Do not accept model prices from `.env` or CLI flags. `src/features/model-operations/` owns the generated exact-model price catalogue and its explicit contributor refresh command; product commands never fetch pricing.

Model usage and catalogue-derived cost are source-free telemetry, never a dispatch, source, context, tool, output, or audit-work limit. Deduplicate retained observations only for reporting so resumed work cannot double-count telemetry.

Planning, evidence mapping, investigation, verification, and isolated countercheck agent contracts/instructions are feature-owned under `src/features/review-workflow/agents/`. Mapping must complete before a map-bound hypothesis is considered. Its model-facing facts carry only a strict identifier, neutral role, statement, obligation references, and `{path,startLine}` selections; canonical provenance derives snippets, kinds, ranges, and redaction. Its checkpoint and fingerprint prevent unsafe reuse after protocol drift. Live stages own workflow calls and stage policy; `stages/scoped-model-stage.ts` single-owns only scope, tool budget, sessions, retry lifecycle, and the content-free ledger. Keep provider mounting, tool registration, and sandbox configuration in the platform harness. Model usage/cost is recorded per stage and aggregated only from those content-free records.

Provider-signalled context-window recovery is centralized and lossless: run the full approved source/context request first, then partition source paths, source ranges, or applicable advisory Markdown only after the normalized overflow reason. Do not introduce estimated-size pre-splitting, context dropping, language-specific caps, or another recovery loop.
