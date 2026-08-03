# Enterprise audit workflow review and next wave

> **Status:** advisory and implementation plan only. This review made no product,
> specification, or public-documentation changes. It was written against commit
> `dce8947` on 2026-08-03; the working tree also contains a separately verified,
> uncommitted resume-state consolidation that is outside this review's baseline.

## Executive verdict

The core product shape is right: a human-reviewable plan is executed as a
separate, read-only, language-neutral audit; `not-applicable` is neutral; and a
finding needs independently re-inspected, source-backed evidence. The main
production blocker is not a confirmed security failure in the audit lifecycle.
It is that the project cannot yet produce a current, qualified measurement of
whether the model creates the right plan or finds the intended issue.

The latest offline corpus command completed correctly as a contract test, but
all six selected trials stopped at `evidence-map-incomplete`. Its deterministic
provider performed a grep then returned no map facts, so the result proves that
the fail-closed path works; it says nothing about provider detection accuracy.
No quality number should be published from that run.

## Findings that remain actionable

| Priority | Finding | Evidence | Impact | Effort | Confidence |
| --- | --- | --- | --- | --- | --- |
| P0 | Current evaluation does not isolate the cause of zero semantic completions for a real provider. | `evaluation/runs/*/evaluation-report.md` records six `evidence-map-incomplete` trials; `src/features/evaluation/deterministic-provider.ts` intentionally returns scripted responses; `src/features/evaluation/run-real-world.ts` exits successfully for the deterministic contract run. | A zero finding score can be mistaken for a model result although no finding stage was reached. | M | High |
| P0 | The corpus is not yet eligible for an enterprise reliability or precision claim. | `src/features/evaluation/corpus.schema.ts:207-278` permits provisional keys; current evaluation report labels the selected corpus diagnostic and targeted. | Reported recall or precision would be statistically and semantically misleading. | L | High |
| P1 | The prompt protocol is structurally safe but has no outcome-based regression suite for the actual planning and evidence-mapping behavior. | `src/features/review-workflow/agents/*/instructions.ts`; only shared inspection text has a direct instruction test at `scoped-inspection-instructions.test.ts`. | Prompt edits can silently reduce plan coverage or cause evidence-map incompleteness. | M | High |
| P1 | Diagnostic validation codes collide by design. | `src/features/review-workflow/runtime/invocation.ts:39-44,57-68` retains at most three schema paths then slices the token to 64 characters. | Different malformed model outputs can become indistinguishable in source-free telemetry, slowing safe recovery. | S | High |
| P1 | `eval:corpus` is useful but its name suggests a semantic evaluation even though its default deterministic provider deliberately cannot find source facts. | `src/features/evaluation/deterministic-provider.ts:60-110`; the latest report has no completed trials and `bun run check` still exits successfully. | Engineers can interpret a green command as evidence of audit quality. | S | High |

### Explicitly rejected as stale or already fixed

- **Path-length limits:** the current canonical `RelativePathSchema` has no
  maximum length (`src/shared/contracts/core.ts:11-22`), filesystem input
  imports it (`src/platform/filesystem/filesystem.schema.ts:3-7`), and model
  map selections use only `z.string().min(1)`
  (`src/features/audit-execution/evidence-map/contract.ts:65-68`). Do not add a
  path-cap work item.
- **Verifier context-overflow recovery absent:** the current implementation has
  a candidate-aware overflow topology and a `allowScopeSplitting` control. This
  concern was addressed by the two latest commits; retain its regression tests,
  but do not reopen the old design.
- **Missing corpus/baseline identity:** the run and baseline shapes now bind
  `corpusManifestDigest`, `populationDigest`, and
  `benchmarkProtocolFingerprint` (`src/features/evaluation/corpus.schema.ts:518-523,567-577`;
  `src/features/evaluation/baseline.ts:41-63`).
- **`relevantPathCoverage` derived from true positives:** it is currently
  calculated from enabled-vector scope against answer-key relevant paths
  (`src/features/evaluation/real-world-scorer.ts:16-45`).

## Recommended execution order

### Plan 009-A — make every evaluation outcome explainable

**Progress (2026-08-03):** the version-6 run artifact now records a strict,
source-free `firstIncompleteStage` for the observable expected-role chain:
evidence mapping, canonical grounding, or verification (plus complete and
not-applicable). It deliberately does not claim a posture or discovery
expected-role match, because those phases do not persist a truthful
answer-key-to-role identity. Their existing source-free funnels remain the
separate diagnostic.

**Goal:** a single real-provider trial must say exactly which stage lost the
expected source-backed evidence, without exposing source, prompts, answer keys,
tool arguments, tool results, or model output.

**In scope**

- `src/features/evaluation/` schemas, runner, scorer, report, and adjacent tests.
- Evaluator-only artifacts under `evaluation/`; no agent-visible answer-key data.
- The evaluation specs and human evaluation documentation, updated together.

**Required design**

1. Define one strict, evaluator-owned stage-coverage schema keyed by expected
   finding identity and evidence role. It must contain only booleans/counts and
   stable identifiers or digests: plan-scoped, mapper-selected,
   posture-reconciled, discovery-seeded, grounding-selected, verifier-selected,
   terminal-state, and first-loss-stage.
2. Derive it after a trial from the evaluator answer key plus existing
   source-free workflow artifacts. It is diagnostic only: it must not be passed
   to any provider, plan, prompt, tool, candidate, or finding admission code.
3. Report aggregate and per-case first-loss counts separately for
   `generated-plan` and `reviewed-plan`. Incomplete trials remain unscored; the
   report must say why rather than displaying recall as zero.
4. Add a provider-free scripted test for each first-loss stage and one test that
   proves the serialized trace has no prompt/source/tool/model content.

**Verification**

```bash
bun test src/features/evaluation
bun run schema:check
bun run eval:corpus
```

Expected: all tests pass; the deterministic corpus run is labelled
`contract/integration`, has explicit incomplete stage coverage, and makes no
quality claim.

**STOP:** if the desired signal requires retaining raw source, answer-key text,
prompt text, model output, or a target path, stop and design a source-free
alternative before implementation.

### Plan 009-B — turn agent prompts into versioned behavioral contracts

**Goal:** improve planning and mapping reliability without adding language
parsers, regex security rules, fixture rules, or answer-key-informed behavior.

**In scope**

- `src/features/review-workflow/agents/` and their contract tests.
- Stage-specific prompt fingerprints and evaluation-only behavioral fixtures.
- The review-workflow and evaluation specifications.

**Required design**

1. Establish a compact prompt contract matrix for planning, evidence mapping,
   posture, discovery, grounding, and verification. Each row defines: required
   first tool action, allowed output shape, required negative behavior, and
   source-free completion/incompleteness outcome.
2. Add provider-free deterministic behavior fixtures that exercise the contract
   matrix through the real stage wrapper—not string-matching prompts alone.
   Cover unknown-language evidence, a business-level obligation, applicable
   Markdown/frontmatter context, misleading context, `not-applicable`, visible
   controls, no-source-evidence, and a source-backed candidate that is later
   rejected.
3. Make prompt changes explicitly versioned in the existing protocol
   fingerprint. Resume and evaluation comparisons must reject stale observations
   rather than silently mixing instructions.
4. Only after the provider-free suite exists, run one `reviewed-plan` live
   smoke per changed prompt protocol. It is diagnostic, cost-budgeted, and does
   not establish a model claim. Use the Plan 009-A first-loss output to decide
   whether any prompt change is justified.

**Verification**

```bash
bun test src/features/review-workflow src/features/evaluation
bun run typecheck
bun run eval
```

Expected: every behavior fixture produces its declared terminal state, and no
fixture introduces a language-specific detection rule or model input derived
from an answer key.

**STOP:** if a proposed prompt change needs a named API, syntax pattern,
language extension, benchmark label, or expected-finding location to succeed,
reject it as answer-key fitting.

### Plan 009-C — create a claim-grade, mixed-language evaluation track

**Goal:** make measurement truthful before optimising model selection or
asserting enterprise reliability.

**In scope**

- `evaluation/` acquisition, pack/answer-key schemas, readiness, reports, and
  evaluator tests.
- Evaluation specs and end-user evaluation documentation.
- No product admission heuristics and no target-side parsers.

**Required design**

1. Keep contract/integration evaluation separate from provider measurement in
   command names, reports, and documentation. A green deterministic command
   means lifecycle conformance only.
2. Acquire a private, immutable set of paired vulnerable/patched cases across
   at least the already-supported language families. Do not cap cases per
   project; preserve all declared cases, keep related revisions in one split,
   and aggregate by repository lineage so one upstream cannot dominate results.
3. For every scoreable pair, store two independent human include judgments that
   agree on source-only applicability, relevant scoped paths, expected vulnerable
   finding, the patched-negative expectation, and the exact adjudicated scope.
   Use targeted labels only for diagnostic recall; use exhaustive, source-bound
   scope before scoring precision.
4. Add context-modality cases: source-only sufficient; advisory context needed
   for a business-level obligation; irrelevant/misleading context; hostile
   context that cannot override source evidence. Report this as a separate
   modality, never as a language rule.
5. Define one `claimEligibility` derivation. A public quality claim requires a
   complete selected grid, qualified labels, frozen corpus/population/protocol
   identity, the configured repeat policy, and for private holdout a verified
   attestation bound to the computed readiness report. A case selector or
   provisional/targeted pack remains diagnostic.

**Verification**

```bash
bun test src/features/evaluation
bun run eval:corpus
bun run eval:corpus:validate
```

Expected: unqualified packs and selected-case runs serialize as diagnostic;
only a qualified pack may produce a claim-eligible report; every accepted case
has source checksum and answer-key isolation checks.

**STOP:** if a case lacks authorization, immutable source checksums, a paired
negative, or two agreeing human reviews, retain it only as acquisition progress,
not a quality denominator.

### Plan 009-D — preserve diagnostic distinctness without retaining content

**Progress (2026-08-03):** implemented. Validation telemetry now stores a
fixed category, the complete unique schema-path count, and a digest of the
complete canonical path set. It retains neither a path label nor a value.

**Goal:** make malformed model output diagnosable while preserving the product's
content-free logging rule.

**In scope**

- `src/features/review-workflow/runtime/invocation.ts` and adjacent tests.
- The telemetry/error contract specification.

**Required design**

1. Replace `validation-output-${paths.join('+')}.slice(0, 64)` with one stable
   token containing a fixed category, complete issue count, and a SHA-256 digest
   of the sorted canonical schema-path labels. Never retain values, messages,
   source paths, model content, or raw metadata.
2. Keep a general code for missing/malformed harness metadata.
3. Add tests proving permutations give the same code, distinct complete
   path sets give distinct codes, long path sets do not collide merely due to a
   prefix, and no user/model value appears in the output.

**Verification**

```bash
bun test src/features/review-workflow/runtime
bun run lint
bun run typecheck
```

Expected: diagnostics remain content-free and deterministically distinguish
structurally different failures.

## Release gate after the wave

- `bun run check` passes without provider dispatch.
- A current-schema, one-run `reviewed-plan` provider trial produces a complete
  trace or an explicit first-loss stage; it is not a quality claim.
- A generated-plan trial is reported separately from reviewed-plan behavior.
- No model comparison or model change is justified until a qualified corpus
  provides a scoreable result.
- The separately prepared `AuditResumeState` refactor is code-reviewed and
  committed on its own; do not mix it with this evaluation/prompt wave.

## Research implications

The useful pattern from current external tools is not their attack execution:
VulnHunter describes forward attacker-path reasoning and an explicit
falsification pass; Codex Security exposes resumable deep scans. Security
Reviewer should retain its stricter boundary—static, read-only, scoped analysis
with a human-editable plan—and adopt only the product-neutral lessons:
stateful traceability, independent challenge of a hypothesis, and clear
separation between a test harness passing and a quality measurement.

Sources: [VulnHunter](https://github.com/capitalone/VulnHunter) and
[Codex Security](https://github.com/openai/codex-security).
