# Real-world corpus and reliability evaluation

## Purpose

This specification turns evaluation from a contract smoke test into a reproducible evidence system. It measures the normal plan-bound audit workflow against source-only vulnerable/patched repository snapshots. It does not execute target projects, install target dependencies, run test suites, start services, send network traffic, or run PoCs.

## Capability additions

| ID      | Capability                                                 | Owner                                | Acceptance                                                                                                                                                                                                               |
| ------- | ---------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CAP-026 | Import and validate an offline corpus pack                 | Evaluation feature                   | Invalid provenance, checksum, pair, split, license, or answer key fails closed.                                                                                                                                          |
| CAP-027 | Build an isolated agent target view                        | Evaluation feature + filesystem jail | Agent can read only selected source/context, never manifest or answer key.                                                                                                                                               |
| CAP-028 | Score plan quality separately from finding quality         | Evaluation feature                   | A deterministic path-reachability observation remains available when a later audit is incomplete. Semantic plan recall and vector precision exist only in a separately validated AI-assisted evaluator artifact bound to that exact generated plan.                    |
| CAP-106 | Measure semantic generated-plan coverage without heuristics | Evaluation feature + evaluator model stage | A strict evaluator-only AI-assisted review closes every expected scenario and every enabled generated vector against the exact plan snapshot. The resulting semantic score is diagnostic, never product-visible, and never inferred by deterministic code from titles, categories, source text, or answer-key wording. |
| CAP-095 | Measure generated plans without paying for audit execution | Evaluation feature + harness adapter | `planning-generated` invokes the normal planner against one isolated variant, records path reachability plus evaluator-only semantic-plan review, and cannot access reviewed plans, answer keys, or audit tools. |
| CAP-029 | Run provider reliability trials                            | Evaluation feature + harness adapter | Repeated opt-in runs record normalized agreement, success, cost/latency, and run-level failures.                                                                                                                         |
| CAP-030 | Produce actionable baseline-backed evaluation analysis     | Evaluation report feature            | JSON plus Markdown identify regressions by language, difficulty, category, variant, and provider configuration.                                                                                                          |
| CAP-031 | Keep complete source-evidence preparation language-neutral | Audit execution feature              | Scoped path manifest and visible limitations never depend on a parser, rule catalogue, target-language allowlist, or pre-emptive context estimate.                                                                       |
| CAP-116 | Qualify bounded internal development calibration evidence  | Evaluation feature                   | Only the exact selected source-pinned real-world vulnerable/patched population may label an internal diagnostic measurement `development-calibration` when each qualifying pair has one traceable AI-assisted source review and explicit causal-patch validation; it never satisfies a pilot, reliability, independent-validation, provider-selection, or model-quality gate. |
| CAP-107 | Bind benchmark identity exactly                           | Evaluation feature                   | Every persistent run/checkpoint/baseline/comparison binds exact corpus bytes, the selected source population, and every result-affecting protocol input.                                                                  |
| CAP-108 | Diagnose evaluator evidence loss safely                   | Evaluation feature                   | An evaluator-only, source-free per-expected-role trace records the first missed normal workflow stage from plan scope through terminal coverage. It never retains locations, enters model input, changes scores, or determines a product finding.                                  |

## Corpus layout and trust boundary

```text
evaluation/
  src/                               # evaluator-only TypeScript and colocated tests
  data/
    corpora/
      <pack-id>/
        manifest.json               # trusted provenance and case index
        cases/<case-id>/
          vulnerable/               # mounted target view only
          patched/                  # mounted target view only
          context/                  # optional, separately labeled
        answer-keys/<case-id>.json  # trusted scorer input; never mounted
    research-corpora/               # explicit local diagnostic/calibration packs
    acquisition/                    # tracks, pinned metadata, and source-pair snapshots
    curation/dossiers/              # source-only preparation; never agent input
    candidates/                     # metadata-only acquisition registries
    fixtures/                       # safe small cases and safety probes
    stage-isolated/                 # evaluator-private isolated-stage packs
  runs/                             # generated, ignored
```

The only permitted agent mount is a case variant directory and its explicitly selected context directory. `manifest.json`, `answer-keys/`, other cases, parent directories, and evaluator code must be outside the target jail. A baseline is an explicitly supplied, separately validated artifact, not a dataset directory. The evaluator validates the complete pack before a provider call. A failed validation writes a failed run record and never a clean zero-score result.

## Required contracts

`CorpusPackManifestSchema` is strict and includes schema version, pack id/version, source datasets, retrieval timestamp, pack checksum, license/redistribution decision, and sorted cases. A source dataset record requires source URL, immutable revision or release id, source license, source checksum, and attribution. `private-research-source-only` permits an evaluator-local development pack but prohibits import and redistribution; it makes no upstream license claim. Corpus/evaluation schemas have no arbitrary collection ceiling for cases, source entries, expected paths/findings/scenarios, generated vectors, traces, or retry attempts: they preserve every declared entry or reject the artifact explicitly.

`CorpusCaseSchema` is strict and includes case id, source dataset id, project id, repository URL, vulnerable revision, language tag, difficulty (`easy|medium|hard`), split (`development|test|private-holdout`), evidence origin (`real-world|synthetic|semantic-regression`), one or more evaluator-only control-family labels, source paths, optional context paths, answer-key path, and a transformed-content checksum. Control-family labels are a closed six-family sampling taxonomy; they never enter an agent prompt, static finding rule, or report finding. `variantMode` is `paired` or `single`; paired cases additionally require a distinct patched revision, patched source directory, and patched digest. The loader verifies both declared snapshot digests before the case can contribute evidence. A case id may not appear twice; a project id may not appear in more than one split or contribute more than one selected case. A paired case’s vulnerable and patched variants are one case, not two independent samples.

`CorpusAnswerKeySchema` version 6 is strict and includes case id, source-bound expected planning scenarios, expected findings, no-finding expectations for patched variants, `findingCoverage`, case-level static-review applicability, adjudication status, one-or-more evaluator-only source-only review records, and notes. A scenario has a stable id, concise objective, required risk condition, evidence requirements, source-only applicability declaration, explicit expected-finding ids, and one-or-more relevant paths; every id must bind to an expected finding on one of those paths. A `dual-reviewed` key requires exactly two distinct `human` `include` records that match the persisted key's canonical source-only judgment. An `ai-assisted` key requires exactly one traceable source-only AI-assisted include review that matches the persisted key and contains at least one static-review-applicable expected vulnerable finding. It supports one internal development run only; it cannot justify whole-repository precision, external reliability, independent validation, pilot/reliability readiness, or a provider-selection claim. A second review may add corroboration but cannot silently alter the finalized key or convert it to human review. Every paired case must declare `no-matching-finding` for its patched source. Identity, timestamp, rationale, and array ordering are intentionally not matching fields. Each record preserves its review assertion, decision, coverage class, expected scenarios/findings, patched expectation, static-review applicability, timestamp, and rationale. Versions 1–5 are rejected. A provisional or AI-assisted key cannot support a reliability claim. Expected findings contain stable ids, static-review applicability, and one-or-more accepted ranges per required evidence role. The answer key contains no prompt text and is never copied into a report’s raw evidence. `08-evaluation/05-adjudicated-scoring-and-recovery.md` owns scoring eligibility and targeted/exhaustive interpretation.

### Internal development-calibration qualification

`development-calibration` is a bounded internal evidence label, not a readiness gate or a model claim. The full-pack readiness report may describe available acquisition progress, but a run derives its qualification only from its exact selected case population. A development run can use `development-calibration` only when its selected population contains one-or-more distinct projects that each meet all of the following conditions:

1. The case is `real-world` and `paired`, with distinct pinned vulnerable and patched revisions and snapshot digests validated by the corpus loader.
2. Its strict v6 answer key is `ai-assisted`, includes the required matching source-only AI-assisted `include` review, is static-review applicable, contains one-or-more scoreable expected vulnerable findings, and declares `no-matching-finding` for the patched variant.
3. Its evaluator-only `developmentCalibration` record contains the exact calibration-review protocol fingerprint, a causal-patch validation outcome of `confirmed`, the validation actor/date and a concise source-only note, an explicit uncertainty (`low`, `moderate`, or `high`), and an explicit conflict state (`none`, `open`, or `resolved`) with a note for any non-`none` state.
4. A case with `high` uncertainty or an `open` conflict remains visible in corpus progress but does not make the label available. A resolved conflict may contribute only when causal validation is confirmed and uncertainty is `low` or `moderate`.

The record is evaluator-only metadata. It is never mounted into an agent target, copied into a prompt, treated as a deterministic security rule, or used to admit a finding. The readiness report exposes only source-free counts and a clear limitation. It must say that `development-calibration` supports internal diagnostic improvement of this exact corpus population only; it cannot satisfy `pilotReady`, `reliabilityGateReady`, a holdout requirement, a baseline gate, independent validation, provider selection, or any claim about a model.

`EvaluationConfigurationSchema` is strict and records pack id/version, selected split, optional selected case id, mode (`deterministic|provider`), provider/model identifier, prompt/config digest, tool policy digest, repetition count, vector-concurrency cap, and run budget. It derives three required source-free identities: the immutable corpus-manifest digest, selected-population digest (case/project/source/transform digests after split/selector), and benchmark-protocol fingerprint. The protocol fingerprint additionally binds a canonical evaluator-fixture digest: every selected answer key, plus each selected reviewed-plan fixture only for `audit-reviewed-plan`. This makes evaluator scoring/routing changes explicit without placing evaluator material in the target jail or redefining selected source population. A selected case must exist in the selected split; the runner executes all of that case's declared variants and rejects an unknown or cross-split selector before model dispatch. Every provider-run artifact, resumable checkpoint, reviewed baseline, and comparison records all three identities; resume and comparison reject any mismatch. Every provider-run artifact and resumable checkpoint records the applied `maxParallelVectors` value and includes it in the configuration fingerprint. Every resulting run records its prompt-protocol fingerprint and one evidence qualification derived from that exact selected population, never from an unselected qualifying case in the same pack. These content-free fields make a changed prompt protocol, corpus, case selector, evaluator fixture, concurrency setting, or evidence class an explicit comparison boundary; incomplete artifacts are rejected. Provider mode requires an explicit opt-in configuration and is rejected by default CI. The live CLI records a strict execution budget in the resulting run: model and run deadlines default to disabled (`0`), and default retry permits one fresh same-input agent invocation after a failed response while retaining the original vector scope. A normalized provider context-window overflow instead uses the shared deterministic recovery protocol. A caller may select any non-negative deadline; when both are positive, run timeout must not be shorter than model timeout. A non-zero deadline is a visible operational cancellation, never an input, source, tool, or result cap.

`EvaluationRunSchema` version 13 records each variant trial and aggregate analysis. It includes the three evaluation identities, the `findingCoverage` class (`targeted`, `exhaustive`, or `mixed`) derived only from the selected split/case set, immediate `pathReachability`, the exact per-trial semantic-plan measurement state, finding score, pair score, normalized plan/finding sets, latency, source-free input/output/cached/reasoning token totals, model-call count, cache-routing status, cost source, nullable estimated cost, errors, coverage state, and safety violations. The run derives its `measurementState` from those terminals: workflow completion, semantic-plan completion/non-applicability, and finding-measurement completion/non-applicability. `pathReachability` records only whether enabled vector globs reach evaluator-declared relevant paths; it is not semantic scenario recall, plan precision, or evidence that a plan understood a risk. An end-to-end-generated trial retains an evaluator-only role trace for each applicable expected finding/evidence-role pair. Its fixed diagnostic order is `planning-scope`, `evidence-mapping`, `source-posture`, `investigation`, `candidate-grounding`, `verification`, then `terminal`; each row stores only the evaluator finding identifier, required role token, stage booleans, and its first incomplete stage. It never stores a source path, range, fact identifier, seed identifier, candidate identifier, prompt, model content, tool argument/result, or model-facing answer-key data. A `planning-scope` row means no enabled vector scope covered an evaluator-adjudicated range; it does not claim semantic plan quality. Map and posture overlap are derived only inside the evaluator from validated fact references. Discovery overlap is derived only from each seed's role-matched selected map evidence, never from its broader fact basis; grounding/verifier overlap is derived from already-validated source evidence; terminal completion is derived from matching scoped vector coverage. A trace does not infer a vulnerability, control effectiveness, exploitability, priority, target safety, or a product finding. The evaluator persists only derived role booleans in its separate work root after each reached phase so a stopped trial can resume without retaining discovery seeds; that artifact is bound to the exact run, trial, sealed plan, target/context fingerprints, provider/model/route, protocol fingerprints, and answer-key identity. Any mismatch is rejected and raw seeds are never reconstructed or written. The trial also retains aggregate counts derived solely from these rows. This applies equally to a later evaluator failure and never affects a score. A completed new-format trial also records the sum of its vector admission funnels so an evaluator can distinguish no model candidate from integrity, tool-evidence, verifier, reconciliation, or post-verification loss without accessing source or model content. A non-completed trial retains its admitted-finding and review-required identities in a separate `retainedUnscored` projection together with its own funnel; those observations are not true positives, false positives, precision inputs, or a replacement score. Finding matching is stable maximum-cardinality one-to-one matching; a model finding cannot satisfy multiple expected findings and an early overlapping match cannot hide a later one. Targeted keys make precision and F1 unavailable. Cost unavailability is explicit; it is never represented by zero. Nullable metrics remain null when mathematically undefined; they are never converted to 0 or 1.

## Evaluation flow

```mermaid
flowchart LR
  M["Trusted manifest + answer keys"] --> V["Validate provenance, checksums, splits"]
  V --> J["Mount one source-only variant in a jail"]
  J --> P["Normal planner produces executable plan"]
  P --> U["Normal matching-plan audit"]
  U --> S["Trusted scorer reads answer key after session closes"]
  S --> R["JSON + Markdown analysis and regression decision"]
```

The evaluator validates the produced executable plan against the isolated inventory, then runs it directly. This mirrors product behavior: organizational review may happen outside the tool, while the evaluator measures planning plus audit without creating approval metadata.

## Metrics

Immediate plan metrics are path-reachability metrics:

- eligible-scenario count, path-reachable-scenario count, and relevant-path coverage, determined only by whether an enabled vector scope reaches evaluator-declared relevant paths;
- enabled-vector count; and
- executable-plan validity and target/context identity eligibility.

They make no semantic-plan claim. Scenario recall, relevant-vector precision,
unrelated vectors, and duplicate relevant vectors exist only when the normal
evaluation lifecycle's AI-assisted semantic adjudication for the exact sealed
generated plan has completed successfully.

Finding metrics use one-to-one expected-finding matches by role-specific evidence ranges. A match with every required evidence role is localized; a match through only some required roles is detected but mislocalized. Every expected finding is matched at most once. Exhaustive keys count unmatched outputs as adjudicated false positives; targeted keys preserve them as unadjudicated queue items and make general precision unavailable. Patched variants additionally measure paired persistence: a vulnerable-match key that appears on the patched snapshot is a paired false positive. A comparison persists and requires the same derived coverage class, and its deltas separate adjudicated false positives from unadjudicated outputs.

## Isolated evaluation profiles

The evaluator has three non-comparable profiles:

- `planning-generated` invokes only the normal source-inspecting planner, then records path reachability and an explicit AI-assisted semantic-plan review. It never invokes audit work or reports finding quality.
- `audit-reviewed-plan` loads a strict evaluator-authored reviewed plan, binds it to the inventory fingerprint and context digest, then measures audit behavior only. The fixture is neither an answer key nor agent-visible target content. It may define review scope and risk-positive review obligations but cannot contain expected locations, labels, scoring data, or source snippets.
- `end-to-end-generated` invokes normal planning and then audits the generated plan. It reports both stage results but never uses one stage's result as a substitute for the other.

Each profile mounts one source/context variant and uses the normal product stage wrapper and scoped tools. An evaluator-only semantic-review stage runs only after the product session closes; answer keys, expected locations, paired variants, and stage fixtures remain outside the product jail. Upstream stage-isolation packs are evaluator-authored canonical predecessors, never raw output copied from an earlier provider call. A run, checkpoint, report, and baseline record one profile. Cross-profile comparisons fail closed. One repeat is the default `single-run diagnostic`; an operator explicitly selects any repeat count for a stability experiment without a product-imposed upper cap, and the report exposes the exact count and only defined statistics. Only `audit-reviewed-plan` produces audit-quality evidence; planning agreement is not applicable there.

## Stage-isolated provider evaluation

Stage-isolated measurement answers one narrowly scoped question without making
an upstream live-stage outcome a prerequisite. The evaluator owns strict,
checkpointed packs for planning, evidence mapping, source posture, discovery
plus candidate grounding, verification, and the full reviewed-plan audit. A
pack binds the selected corpus/source/context, profile, production-stage
protocol, provider, model, and route. It supplies only the production input
that the measured stage is normally allowed to receive. Its predecessor is an
evaluator-authored canonical fixture, not content copied from a preceding
provider call.

The production stage retains its normal jail and scoped tools. Answer keys,
semantic rubrics, expected locations, and stage expectations stay in the
evaluator domain and never enter a product prompt, target jail, or production
artifact. A stage result reports only its completion, schema/validation result,
source-inspection outcome, evidence-role-bundle localization outcome where
applicable, cost, latency, and content-safe trace. It cannot change product
admission, scores, answer keys, or a normal audit report. The deterministic
`eval:stages` command is lifecycle conformance only; it is not a
stage-isolated provider-quality measurement.

A separate explicit semantic-stage evaluator is required before any isolated
stage outcome may be interpreted as quality evidence. It runs only after the
product-stage session has closed and receives an evaluator-private in-memory
packet containing a source-free objective/risk/evidence-role rubric and a
feature-owned safe projection of the validated product output. The projection
contains opaque product-output and localization identities plus selected,
source-free structured semantic claims; it is not a callback result, static
matcher, serialized product output, or generic object dump. It excludes source
text, paths, ranges, snippets, prompts, tool calls/results, credentials, raw
model output, answer-key labels, classification, urgency, and remediation. The
Purista evaluator has no tools, filesystem, product service, checkpoint access,
or product-admission path. It returns a closed expected-to-output mapping;
deterministic code validates only identity, role, and binding integrity. The
packet, raw product result, prompt, source, answer-key text, tool data, and raw
evaluator response are never persisted. Failure, cancellation, or normalized
context overflow makes only this measurement incomplete/cancelled. The already
closed product observation and inspection evidence remain retained, and the
failed semantic measurement cannot replay, alter, or score product work. One
such run is
`single-ai-assisted-development-review` diagnostic evidence only; it is never
a release, baseline, model-selection, or product-admission gate.

### Stage-isolated artifact and lifecycle contract

Stage-isolated evaluation owns two deliberately separate artifact lanes. Its
ignored evaluator-work lane may retain a sealed canonical input and a
source-free evaluator-private forensic result, but never source locations,
source text,
prompts, raw model output, repository-tool arguments/results, credentials, or
answer-key text. Its report/comparison lane is source-free: it retains the
stage-pack identity, terminal lifecycle, validation and inspection counts,
exact expected/matched/missing/unexpected outcome counts, role-localization
counts, numeric telemetry, and content-free trace. It must not retain source
paths, ranges, fact/seed/candidate identifiers, or evaluator expectation
identifiers. A public projection is derived only from a validated private
result; it never reconstructs source content.

Every pack declares exactly one evaluation profile and one selected
`(caseId, variant, repetition)` identity. It binds the exact corpus manifest,
source/context fingerprints, product-stage protocol, evaluator protocol,
provider/model/route, canonical-input fingerprint, and evaluator-expectation
fingerprint. A feature-owned canonical-input schema and fingerprint builder
parses the exact in-memory input before provider construction; caller-supplied
fingerprints are not authority. The builder binds the vector, scope, context,
and every evaluator-authored predecessor fixture permitted to that stage. The
fixture remains evaluator-only and is never mounted as target content.

The checkpoint lifecycle is `running`, `completed`, `incomplete`, `failed`, or
`cancelled`. It is bound to the entire pack and canonical input before dispatch;
resume rejects any mismatch before constructing a provider. A normalized
`provider-cancelled` stays `cancelled`. A normalized
`context_length_exceeded` is never pre-split, omitted, or reclassified as a
clean result.
Unresolved coverage/protocol work becomes `incomplete`, not `failed` or
`completed`. Error codes remain stable, source-free tokens.

Semantic-outcome identities and localization bundles are unique, disjoint, and
closed against the evaluator-private expected denominator. A stage report must
therefore expose exact denominators and conservation equations rather than
ambiguous arrays. Stage comparison is a dedicated contract: it rejects
different stage kind, profile, selected trial population, corpus/source/context
identity, workflow/stage/evaluator protocol, route, provider/model except for
an explicit same-stage model experiment, or expected-denominator identity. It
never compares a stage pack with a normal evaluation run, another stage, or a
different profile.

### Evaluator-only stage adjudication

The evaluator never infers a semantic outcome from a callback, source pattern,
language/parser rule, fixture name, or answer key in product code. After a
completed product stage closes, a separate no-tools evaluator-agent receives
the unpersisted feature-owned safe projection and evaluator-private rubric for
that exact pack. It returns only a closed mapping of the rubric's expected outcome
identities to `matched`, `missing`, or `not-applicable`, separate unexpected
outcome identities, and any evaluator-private role-localization references.
It cannot emit a product finding, security conclusion, classification, urgency,
fix, free-form source, tool data, or a new expected outcome identity.

The adjudication binds the exact product-projection fingerprint, rubric
fingerprint, evaluator-agent protocol, evaluator provider/model/route, and its own
content-free model observation before the stage result becomes terminal. It is
an internal `single-ai-assisted-development-review`, not human or independent
validation and never a product, CI, readiness, baseline, or provider-selection
gate. A missing, invalid, or binding-mismatched adjudication makes only the
semantic measurement `incomplete`; cancellation makes it `cancelled`. The
completed product-stage observation remains visible, but it may not be rendered
as a matched or clean semantic result. Neither raw product output nor the evaluator rubric is persisted in a
checkpoint, public result, trace, or log. The explicit `eval:stage-semantic` command loads one evaluator-private sealed pack containing that already-completed source-free product projection and rubric. Before provider construction it validates the pack's stage, product-projection, rubric, protocol, provider/model/route, and any retained checkpoint binding exactly. It never opens a target, executes target code, or dispatches product work. Its checkpoint and public report retain only terminal state, source-free counts, and the evaluator observation; an exact completed checkpoint rematerializes the report without a model call, while an explicit unfinished resume retries only the evaluator operation.

Provider-mode reports always record completion, invalid-output rate, metric minimum/median/maximum where defined, latency, and source-free token/cost totals. Repeated trials additionally report normalized plan-vector and finding-key Jaccard agreement when comparison pairs exist. A cache-routing status says only whether stable provider metadata was configured; cached-token counts remain provider-reported observations. A one-run provider result is labelled `single-run diagnostic` and cannot be a stability or reliability claim; a larger repeat count still requires qualified corpus evidence and an explicit interpretation before any reliability claim.

Analysis slices every metric by language, source dataset, difficulty, variant, split, provider/model, and prompt/config digest. The Markdown report lists vulnerable misses, patched false positives, safety violations, then other metric changes; urgency belongs to later human triage.

The report also includes a complete source-free cost-and-latency hotspot table grouped by corpus case, variant, and workflow stage. It exposes model calls, input/output tokens, tool calls, duration, and nullable estimated cost. It is sorted by cost and duration but has no fixed row ceiling. This table is operational evidence for budget or prompt optimization; it is never a source of finding admission or a way to alter benchmark labels.

## Mixed-language seed pack

`audit-real-world-seed@0.1.0` contains manually curated, source-only cases from three independent sources and three target languages: OpenSSF CVE Benchmark (JavaScript CVE-2018-16492, vulnerable/patched), OWASP Benchmark Java (BenchmarkTest00008), and NIST SARD Juliet C/C++ (CWE-121). It spans easy, medium, and hard difficulty. Every copied snapshot records the upstream source license, immutable provenance, transformed-content digest, and an answer key outside the target jail. The separate `private-mixed-language-diagnostic@1.2.0` pack contains source-pinned C#, Go, PHP, Python, Ruby, and Rust vulnerable/patched semantic-regression pairs. It is an explicit language-neutral workflow fixture only: its provisional keys and non-real-world origin cannot affect calibration availability, pilot readiness, reliability readiness, provider claims, baselines, or product behavior.

The seed pack is a reproducible integration and regression corpus, not a general effectiveness claim. Published provider-quality figures require at least 100 repository-disjoint real vulnerable/patched pairs across multiple language families plus a private holdout as defined in the corpus research record.

## Private mixed-language diagnostic pack

CAP-083 provides a separately addressed local pack for immediate engineering diagnosis. It contains paired, source-only, locally authored cases in Python, Go, Rust, C#, Ruby, and PHP. Its cases exercise one source-visible operation and one source-visible control difference each, cover the six control-family labels once, use ordinary repository layouts, and include at least one regular source file with no language-specific extension. This pack is a test of the language-neutral workflow, not a language parser or rule suite: the product receives no extension-based admission rule, source pattern, expected category, expected location, patch, answer key, or paired-variant relationship.

Each case is `semantic-regression`, `paired`, and `provisional`. Its evaluator-only reviewed plan may describe scope and risk-positive review obligations but cannot contain expected locations, answer-key terms, or source snippets. The target jail mounts exactly one variant; the scorer opens its answer key only after the audit closes. Pack data records an internal source identifier, authoring revision, content digests, and the fact that the content is private research material. It does not require an external-source license decision because no third-party source is copied.

Provider runs against this pack record known-issue detection/role-localization, patched matching findings, unadjudicated outputs, case-level repeat agreement, cost, and latency. Targeted keys do not produce normal precision or F1. Their evidence qualification remains `diagnostic` irrespective of their numerical result. They cannot set or replace a product baseline, satisfy a pilot/reliability/holdout gate, validate a model, or be aggregated with a real-world corpus result. A report must state this boundary next to every metric. Regression investigation may use these outcomes to locate workflow defects, provided no answer-key content is added to product prompts, static code, or finding admission.

When `eval:provider` receives an explicit corpus path, it must not silently load the seed baseline. An optional `--baseline` binds a deliberately compatible regression experiment; otherwise the report states no baseline comparison. The provider finding gate remains visible and may fail on missed expected findings, but a diagnostic pack is never compared to an unrelated pack.

## Corpus-readiness gate

`bun run eval:corpus:readiness` loads the configured validated pack but makes no provider call and mounts no target source for an agent. Its closed local-only options may explicitly select `--corpus <local-root>` and `--output <run-root>`; an unknown or malformed option fails before configuration or I/O and can never silently fall back to another pack. It writes a source-free JSON/Markdown readiness artifact that counts cases by evidence origin, language, and dataset. Only paired `real-world` projects with explicitly recorded source-only review provenance count toward descriptive pilot progress. Provisional entries remain visible as descriptive acquisition progress but cannot support a reliability claim; `synthetic` cases remain useful taxonomy regressions, and `semantic-regression` cases remain useful narrow fixed regression controls, but neither can inflate a real-world reliability claim.

The gate reports, without passing or failing a model, whether the corpus has the paired real-world cases, patched negatives, language families, control families, and private-holdout evidence required by its selected claim profile. An AI-assisted development review supports diagnosis only; it is never relabelled as independent validation. A private holdout is physically separate from development/test packs and is operated by the corpus steward. After freezing a provider experiment, the steward signs a source-free Ed25519 attestation binding the isolated manifest, stable readiness-decision digest, and benchmark-protocol fingerprint; a provider run verifies all three before any model call. Its per-family counts are source-free evaluator metadata; they are not a detection rule or a model input. A missing condition is an explicit data gap, never a zero model score or a reason to loosen provider thresholds.

## Gates and operations

Default CI runs only deterministic pack validation, answer-key isolation, fake-provider end-to-end evaluation, and report snapshots. It never downloads a corpus or calls a provider. `bun run eval:corpus:integration` uses the same scoped repository-tool loop as product audit; its deterministic responder issues an in-scope `repo_grep` before its deliberately no-claim map response. It is an isolation/provenance/artifact check, not a product-quality measurement. It writes a validated JSON/Markdown integration analysis under ignored `evaluation/runs/`; its deliberately no-claim responder records an incomplete semantic-plan measurement and a failed diagnostic gate but exits successfully unless validation, artifact writing, or safety fails. The targeted provisional seed has no baseline because it cannot support a false-positive threshold. `bun run eval:provider` requires credentials for the resolved default or explicitly overridden provider route; it defaults to one diagnostic repeat and accepts any explicit repeat count without a product-imposed ceiling. Reports may expose only the agreement and distribution statistics defined by their observed trials; no count alone creates a stability or provider-reliability claim. Its optional `--case-id <id>` runs every declared variant of exactly one development/test case and is intended for bounded diagnostic probes; it does not make a diagnostic pack a reliability corpus. Its configured model deadline is applied both by the harness and the provider SDK transport; an unresponsive request becomes a measured failed trial rather than an unbounded process. CI fails when a required case disappears, a checksum/provenance mismatch occurs, answer-key isolation fails, a safety violation occurs, a critical/high case becomes a miss, a patched pair gains a finding, or an exhaustive-qualified metric regresses beyond the approved tolerance.

The offline `eval:import` contributor command accepts a fully local pack root, validates its manifest, source checksums, repository-level splits, answer keys, and source-inclusion decision before copying. It writes a content manifest through a temporary directory and atomic rename, never overwrites output, and has no network capability. External source code is never published by the product unless the upstream license and the pack’s redistribution decision explicitly allow it.

Generated run reports retain only validated artifacts, normalized metrics, digests, identifiers, and redacted errors. They do not retain provider API keys, raw prompts, full tool transcripts, or source text beyond the locally stored corpus governed by its provenance record.

Evaluation run and provider-checkpoint version 12 additionally persist the exact selected case/variant/repetition population. The terminal run must contain each selected identity once and no other identity; checkpoint resume rejects a population mismatch before a provider is constructed.

`bun run eval:compare --baseline <evaluation-run.json> --candidate <evaluation-run.json> [--kind same-route-regression|primary-model-experiment]` loads two bounded, regular local run artifacts and renders a source-free delta report. `same-route-regression` requires equal corpus-manifest digest, selected-population digest, benchmark protocol, mode, provider/model, verification route, split, repeat count, plan profile, execution budget, cost source, vector concurrency, and a non-empty equal prompt-protocol fingerprint before marking the runs comparable. `primary-model-experiment` permits only the sole primary provider/model and its corresponding same-route fingerprint to differ; both runs must use `same-route` verification and every other compatibility field remains equal. It cannot evaluate an independent verifier ensemble or change product admission. Incompatible artifacts render only their exact configuration differences, withhold all score, cost, latency, and stage deltas, exit non-zero, and cannot support a quality conclusion.

Provider evaluation checkpoints use an exclusive per-run writer lock. The source-free lock metadata records the run id, attempt id, immutable checkpoint fingerprint, creation timestamp, process identifier, host fingerprint, and command mode. Any existing lock prevents a second invocation with the same run id from reading or rewriting the checkpoint and fails closed. `bun run eval:provider:lock:inspect -- --output <evaluation-runs> --run-id <id>` prints only that lock metadata and the checkpoint lifecycle identity. `bun run eval:provider:lock:release -- --output <evaluation-runs> --run-id <id> --attempt-id <id> --checkpoint-fingerprint <sha256>` removes a known-abandoned lock only when all three supplied identity values match exactly. Neither command constructs a provider or reads corpus source. The release command removes only the matching lock; it never deletes or alters checkpoints, staged data, or terminal artifacts. The application never takes over or deletes a lock based on elapsed time or PID absence, so an operator must explicitly inspect and resolve a known-abandoned lock before resume. This prevents concurrent resumes from losing completed trials or producing incomparable aggregates.

## Verification

- Schema contracts: malformed/duplicate/missing provenance; invalid language/difficulty/split; bad checksums; leakage paths.
- Filesystem integration: target view cannot list/read manifest, answer keys, or another case; symlink traversal fails.
- Fake-provider E2E: planned vector and source-grounded finding score correctly for vulnerable, patched, and benign variants.
- Reliability aggregation: five fixed trial records produce deterministic Jaccard/median/range calculations; failed trials remain visible.
- Report snapshots: language/category/difficulty slices and regressions render deterministically.
- Offline importer: manifest-only local input, checksum, overwrite, and source-inclusion denial tests; no importer invocation in default CI.
