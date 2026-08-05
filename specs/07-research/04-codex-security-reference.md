# Codex Security reference review

## Scope of this review

This is a design-reference analysis of OpenAI's public `openai/codex-security` repository and TypeScript SDK documentation, reviewed on 2026-07-30. It is not a dependency decision and does not authorize copying prompts, plugins, runtime code, benchmark logic, or provider-specific behavior.

## Relevant design observations

The reference product documents a staged scan with preflight, scoped targets/diffs, optional knowledge-base material, deep discovery, validation, durable scan history, cost reporting/caps, and comparison that keeps a missing finding `unknown` when later coverage is incomplete. It supports findings validation and patch generation, and it can retain source excerpts/reproduction material in external results.

Audit already independently implements the portions that fit its product boundary:

| Reference idea | Audit decision |
| --- | --- |
| Preflight and bounded, explicit target selection | Keep: validated corpus/target input, jailed source reads, approved vector scopes, and provider-call prerequisites. |
| Staged discovery, evidence review, and verification | Keep: plan → evidence map → candidate-blind posture → investigation/grounding → exact verification. The project uses no language-specific parser or static detector as a substitute for evidence. |
| Resumable source-free measurement and coverage-aware comparisons | Keep: checkpointed trials, content-free artifacts, and `unknown` lineage where coverage is incomplete. |
| Cost/tokens/latency visibility | Keep: stage-owned, content-free accounting from the bundled exact-model price catalogue; unavailable is never zero. |
| Knowledge-base documents | Keep only the existing allowlisted Markdown/frontmatter context. Recursive arbitrary document ingestion is rejected because it broadens confidential-data and prompt-injection exposure. |
| Patch generation, reproduction, live validation, hooks, and remote/bulk scanning | Reject for v1: Audit is a static, read-only reviewer. It does not execute target code, probe live systems, mutate a repository, or run broad repository discovery. |
| Runtime plugins or imported agent skills | Reject as a product extension point for v1. Agent contracts/instructions remain versioned, feature-owned, and spec-governed so unreviewed plugin content cannot alter scope, permissions, or report admission. |
| Source-rich result history | Reject: persisted artifacts remain source-free and never retain prompts, model output, source excerpts, tool arguments/results, or credentials. |

## New requirement adopted

The reference's coverage-aware comparison emphasizes an existing Audit invariant: an absent result is not proof of resolution when coverage is incomplete. The private-holdout attestation reference is therefore an evaluation comparison identity dimension. Different attestations withhold all score, cost, latency, and stage deltas.

## Adopted operational follow-up

Audit retains catalogue-priced observed usage as source-free telemetry. It does not accept environment price overrides, does not claim that estimates equal provider invoices, and never uses cost to stop dispatch or limit audit work. Resume deduplicates retained stage observations so reported usage stays exact.

## Skills and prompt decision

No Codex Security plugin, runtime skill, or prompt is adopted. The reference's runtime permits product-owned plugins and richer result handling; Audit deliberately keeps agent instructions feature-owned, versioned, and fingerprinted. That preserves its fixed read-only capability boundary and prevents unreviewed content from changing audit scope, tool permissions, or report admission. The transferable pattern is governed, durable scan orchestration—not an imported detector, prompt, or provider-specific workflow.
