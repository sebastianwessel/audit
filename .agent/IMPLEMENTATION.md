# Implementation guide

This guide defines implementation conventions. Product behavior and security policy live in specs/; this file must not silently change them.

## Module organization

Keep feature ownership explicit and imports flowing inward:

```text
src/
  shared/          true cross-feature Zod primitives, errors, observability
  features/        target-inventory, attack-planning, review-workflow/{agents/{planning,evidence-map,source-posture,investigation,verification,countercheck},stages/{evidence-map,source-posture,investigation,verification},runtime,tools}, audit-execution/{admission,evidence-map,source-posture,investigation,verification,synthesis}, audit-report, model-operations
  platform/        filesystem, harness, configuration, artifact-store adapters
  cli/             command parsing and process-boundary mapping
```

Do not place feature logic in platform adapters or CLI files. A feature owns its Zod schema, inferred types, pure rules, orchestration, public exports, and unit tests. A helper used by one feature stays local. Move a helper to src/shared/ only after two feature owners require the same invariant behavior; record its owner and keep a focused test beside it.

Target inventory owns the allowlisted repository/context input boundary. Repository source and optional Markdown/frontmatter context must remain distinct evidence classes throughout planning, prompts, findings, and reports. Context is advisory data and never a permission or approval channel.

For context-overflow restart, `evidence-map/`, `source-posture/`, and `candidate-grounding/` own exact validated/redacted recovery leaves. A leaf is persisted before its matching completed topology event, and is reused only with the same immutable audit binding, recovery protocol, root/child scope hashes, and recorded child telemetry. A grounding leaf retains only a canonical per-seed outcome (`grounded`, `null`, or `binding-rejected`) after source validation; raw selectors, discovery seeds, and raw model output are never recovery artifacts.

Audit execution is deliberately split: `evidence-map/` owns neutral source-backed facts and the exact per-obligation inventory of its own neutral `control` facts; `source-posture/` owns candidate-blind per-obligation assessment; `investigation/` owns non-reportable seed and closure contracts; `candidate-grounding/` owns one-to-one seed-to-candidate pairing; `verification/` owns bounded challenge, source-backed control assessment, and explicit posture reconciliation; `coverage-closure/` owns source-free phase/terminal aggregation; `admission/` owns content-free terminal accounting; and `checkpoints/` owns reusable map, posture, candidate-grounding, per-candidate verifier/countercheck, terminal phases, and exact evidence-map recovery leaves. A map recovery leaf is never model output: `evidence-map/` validates its scoped source selections, redacts it, writes it before the matching topology completion transition, and reuses it only with its exact immutable/recovery binding and recorded child telemetry. The mapper supplies only a strict fact identifier, neutral role, statement, approved-obligation references, `{path,startLine}` selections, and an exact `controlCoverage` inventory; `evidence-map/` validates those selections, inventory membership, and alone projects redacted snippets, kinds, and ranges. A posture assessment must cite every retained map control for its own obligation before it can retain a directional conclusion. Shared scoped input contains no findings, classification or urgency labels, fixes, verdicts, answer keys, paired variants, or later-stage output. Discovery seeds are ephemeral and retain exact map/posture references for their approved obligations. Grounding can return null or a candidate that preserves the seed's exact vector, obligations, map facts, and posture assessments. A non-null model output selects its required operation and unsafe-condition locations solely by `{ factId, evidenceIndex }` from its own selected map facts; deterministic code projects the canonical source evidence and roles. A verifier independently inspects scoped source for its semantic decision, but an accepted output selects its operation, unsafe-condition, control, and posture-reconciliation evidence from the same bounded neutral-map artifact; code projects its exact obligations, relevant control identifiers, and complete candidate-relevant posture-assessment set. It cannot leave a posture relation unresolved. There is no synthetic trace pointer or structural relationship gate: these selections validate provenance, complete coverage, and declared model state, not flow or vulnerability semantics. A canonical grounded candidate passes the ordinary admission boundary before it is checkpointed or verified. Candidate-aware work transitions from `pending` to `running` to a redacted completed result and is identity-bound to the sealed candidate plus route/protocol; an interrupted unit is rescheduled and its model rationale is never persisted. Every candidate obligation has cited map facts and a cited posture assessment. Deterministic code validates only approval, scope, selected map evidence, path/line integrity, redaction, references, phase identity, and state transitions. It never decides data flow, control effectiveness, or vulnerability semantics.

`audit-lineage/` owns only source-free post-audit report comparison. It uses `synthesis/identity.ts` for exact matching rather than recreating a fingerprint. Do not use it to add fuzzy matching, source reads, provider calls, model calls, embeddings, a parser, or an admission decision. Its `new`, `resolved`, and `persisting` states require completed coverage for the same vector in both reports; otherwise emit `unknown`.

TypeScript and Bun govern this repository’s implementation, not the language of a reviewed target. Inventory every bounded UTF-8 regular file that passes the filesystem policy even if its extension is unknown; expose a nullable best-effort language hint only. Do not build a target-language allowlist, branch workflow behavior by language, silently omit unknown-language evidence, or add language-specific security detectors. Any future syntax service must be specified as multi-language navigation/enrichment and cannot create a finding or determine its urgency.

Derive model-stage candidate schemas from the canonical persisted/admission schema owned by the relevant feature. Override only the specific constraint that must be weaker at the model boundary; do not copy fields, enums, inferred types, or normalizers. Use `modelTokenSchema` for every model-boundary enum token and `modelNullableOptionalSchema` only for a canonical field that is explicitly optional in model JSON, including nested candidate evidence fields. Put a shared invariant in `src/shared/` only after two features need the exact same behavior.

Prefer files below 250 lines. Split by cohesive responsibility, not arbitrary line count. One public concept per module; barrel exports are allowed only at feature/platform boundaries and must not create cycles.

## Naming and imports

- Files and tool ids use lowercase kebab-case or snake_case where required by the external contract.
- TypeScript symbols use PascalCase for schemas/types/classes and camelCase for functions/values.
- Schemas end in Schema; inferred types end in no suffix and are exported from the same module.
- Import types with import type and preserve ESM-compatible extensions where the compiler requires them.
- Use z.strictObject() for persisted and tool-boundary objects. Never use z.looseObject() for audit artifacts.

## Public contracts and generated artifacts

Feature-owned Zod schemas are the only source of truth; only universal primitives belong under src/shared/contracts/. Generated JSON Schema snapshots live under artifacts/schemas/ and are never hand-edited. Run `bun run schema:generate` after a registered schema changes; `bun run schema:check` is required locally and in CI. Snapshots use input semantics; runtime parsing and TypeScript inference use the same authoritative schema object.

## Purista harness pattern

Construct the harness only with defineHarness(). Register models, tools, skills, agents, and workflows in dependency order. Use agents for one typed model loop and feature use cases for deterministic orchestration, plan/input identity gates, fan-out, deduplication, and report assembly. Declare workflow delegation explicitly when calling child agents.

Use an inMemorySandbox() with no executor for v1. Keep the custom read-only file tools separate from the harness configuration so the filesystem jail is independently unit tested. Keep each agent's instruction text and model input/output schemas in its own `review-workflow/agents/<stage>/` module; the platform harness mounts them but must not become their owner. The source-posture assessor gets the vector, neutral map, and scoped source tools in a fresh candidate-blind session; investigator and verifier use the same bounded vector scope but run independently. The verifier may accept, reject, or mark a supplied investigator hypothesis incomplete. The evaluation-only counterchecker may uphold, reject, or mark only a verifier-accepted hypothesis incomplete; it cannot create a new hypothesis, change vector, classification, urgency, or remediation, receive context that grants authority, or receive answer keys.

CAP-063's independent verifier route is implemented only for provider evaluation. It resolves before corpus target I/O, requires a distinct provider/model pair and named secret environment variable, and is recorded only as a non-secret route fingerprint plus closed stage route token. Product commands reject it; default admission remains same-route. Never reuse a checkpoint across route fingerprints, mix route stages in a cost total when either route price is unavailable, or promote the experiment before the qualified-corpus comparison requirements are met.

## Errors and logging

Use typed, stable error codes at application boundaries. Record source-free stage observations for planning, evidence mapping, source posture, investigation, verification, and any experimental countercheck. Every newly written stage records a contiguous ordered trace of model-response and repository-tool-operation ids, timing, numeric usage/cost or returned bytes, and stable error codes; validate it exactly against the aggregate request and tool observation. A model-output validation code may include up to three static schema field paths but never values, messages, source paths, prompts, or model text. Evidence-map coverage and stage telemetry are content-free; findings retain only validated, redacted source evidence. Default telemetry content capture to NO_CONTENT. The product harness uses the platform-owned no-content logger: do not replace it with a generic JSON logger or emit provider error fields, headers, request identifiers, source, prompts, tools, credentials, or raw outputs. The scoped lifecycle is the only retry owner: provider calls are one-shot and the default lifecycle makes at most one fresh same-scope invocation.

## Local configuration

Load optional project-root `.env` values only through `src/platform/configuration/`. The precedence is built-in defaults, inherited process environment, `.env`, then explicit CLI flags. `.env` is local and ignored; it may name a provider/model, key environment variable, artifact directory, evaluation paths, and a 1–8 vector concurrency cap, but its credential values must never enter artifacts, reports, telemetry, or logs. Price values are not configuration: `features/model-operations/` owns the generated exact-model LiteLLM snapshot and the explicit contributor-only refresh script. Product commands, provider evaluations, and target harnesses never download pricing; unknown exact models remain unpriced.

## Testing

- Keep unit tests side-by-side with their implementation: foo.ts with foo.test.ts.
- Keep schema contract tests side-by-side with the schema: foo.schema.ts with foo.schema.contract.test.ts.
- Reserve tests/ for shared fixtures, test support, integration, and end-to-end tests; never create central tests/unit/ or tests/contracts/ folders.
- Unit-test pure normalization, path jail, matcher casing, deduplication, severity mapping, and report serialization.
- Contract-test every Zod boundary with valid, missing, extra, malformed, and oversized values.
- Contract-test context frontmatter, digest binding, answer-key isolation, and data-protection evidence handling.
- Use fake Purista model providers for agent/workflow tests.
- Test authorization gates, cancellation, timeouts, provider failures, partial failures, reruns, and redaction.
- Live-provider smoke tests are opt-in and never required for bun test.
- Keep real-world corpus source snapshots, manifests, reviewed plans, answer keys, baseline thresholds, and generated runs in separate evaluation subtrees. The agent jail receives a selected source/context variant only. A reviewed plan is strict evaluator data without expected locations, labels, or answer-key content; bind it to the current inventory before approval, skip planning calls, and record its distinct profile in checkpoints/reports/baselines. An optional evaluator-owned case selector validates against the selected split before model dispatch, executes every declared variant, is bound into run/checkpoint/report/resume identity, and never enters agent-visible input. A project may contribute exactly one case (its vulnerable/patched pair is one case). Bind every provider run, checkpoint, baseline, and comparison to the exact corpus-manifest digest, selected-population digest, and benchmark-protocol fingerprint. Pass the configured vector-concurrency cap into the normal review service, record it in new provider checkpoints/runs, and include it in the resume fingerprint. A schema-v5 `dual-reviewed` answer key has exactly two matching evaluator-only human `include` judgments—not only two names—over a source-only-applicable expected vulnerable finding, the final finding-label coverage class, source-bound planning scenarios, findings, patched expectation, and static-review applicability. A scenario has a stable id, explicit expected-finding ids, and relevant paths bound to those findings. Generated-plan scoring records path scope only; it does not claim semantic plan quality. Every paired case requires an explicit patched negative. Preserve an optional resolver decision without overwriting either review; it cannot promote disagreement. Test both intentionally incomplete and completed fixture trials: a complete protocol fixture must use a non-adjudicated source location, fail its workflow gate, and prove exact resume without a new model request. `eval:corpus:integration` verifies plumbing only; provider-quality measurements require at least five repeats and explicit credentials.
- A new evaluation run preserves its derived `targeted`, `exhaustive`, or `mixed` finding-label coverage class. Render reports from that stored class. A targeted key supports known-issue detection and role-localization only: preserve unmatched outputs as unadjudicated and never call them false positives or general precision. A baseline must be exhaustive, and run comparisons reject a different coverage class while reporting adjudicated false-positive and unadjudicated-output deltas separately. Evaluator-only stage-evidence diagnostics may retain aggregate expected-role overlap counts for neutral mapping, canonical grounding, and verifier output; they never retain locations, feed a model, alter a score, or decide a security conclusion.
- `evaluation/candidates/` owns metadata-only, digest-bound acquisition leads. It is not a corpus input: no candidate may include target snapshots, expected finding semantics, answer-key content, readiness weight, or a model-visible path. Source verification consumes an already-local checkout and must remain network-free. Dataset-specific provenance checks may verify only explicit registry bindings (for example, an OSV repository and adjacent Git revision pair); they must not infer source semantics, an expected finding, or corpus eligibility.
- `evaluation/acquisition/` reports only proven lane state. `metadata-unavailable` means the selected pinned source lacks a complete locally verifiable metadata record set and requires one closed unavailable reason; do not infer a candidate, revision, label, or source pair from it. A lane becomes `metadata-ready` only through a validated metadata-only registry.
- `evaluation/acquisition-snapshots/` owns complete, unlabelled vulnerable/patched source pairs for evaluator-only human curation. Its feature-local acquisition command reads only an already-local Git object store, binds to one registry candidate and exact revisions, preserves every tracked regular file with its mode and digest, and publishes atomically. A workspace contains only `snapshot.json`, `vulnerable/`, and `patched/`; its aggregate validator rechecks every workspace byte/mode and rejects symlinks, unexpected entries, and duplicate snapshot or registry/candidate identities. Neither command may fetch, execute, build, test, label, review, update registry state, or mount source for an agent. A snapshot is not a corpus case and has no readiness weight; corpus inclusion remains separately reviewed and imported.

## Anti-patterns

- Duplicating a schema as a TypeScript interface.
- Moving a feature-local helper to shared before a second feature needs it.
- Letting a model decide whether a plan is approved.
- Passing absolute unvalidated paths into tools.
- Enabling built-in read, bash, write, or edit for audit agents.
- Executing target code, following target instructions, or importing target modules.
- Writing findings directly from a model response without schema validation, normalization, evidence checks, and deterministic deduplication.
- Treating a model-suggested relationship as an exploit chain without at least two retained, source-backed findings and an explicit static-analysis limitation.
- Logging raw file contents, prompts, tool results, API keys, or full findings.

## Version history

| Date | Change |
| --- | --- |
| 2026-07-27 | Initial bootstrap conventions for the auto-approved v1 specification. |
| 2026-07-27 | Replaced layer-only setup with vertical feature slices and side-by-side unit tests. |
