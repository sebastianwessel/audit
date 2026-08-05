# Offline real-world corpus

The checked-in seed corpus measures the whole review workflow without running target code or downloading anything. It contains source-only snapshots from three independent sources plus one semantic-coverage fixture:

| Source | Language | Difficulty | Evidence shape |
| --- | --- | --- | --- |
| OpenSSF CVE Benchmark | JavaScript | Medium | A vulnerable CVE snapshot and its upstream fix. |
| OWASP Benchmark Java | Java | Easy | A labeled SQL-injection source case. |
| NIST SARD Juliet | C | Hard | A labeled stack-buffer-overflow source flow. |
| GitHub CodeQL query help | JavaScript | Medium | A documented prototype-polluting computed-property write and a safe `Map` variant. |

Each case has immutable provenance, source checksums, license information, a language/difficulty label, and a trusted answer key. The answer key is never visible to the agent. This protects the result from label leakage: the agent sees only the selected source tree and optional context.

The CodeQL entry is deliberately different from the CVE and benchmark entries: it is a pinned, licensed semantic regression fixture. It proves that the evaluator can distinguish a request-derived computed-key write from the corresponding `Map` use. It is useful coverage evidence, not a real-world prevalence or effectiveness claim.

## Run the safe evaluator

```bash
bun run eval:corpus:integration
```

This uses a no-provider contract runner, verifies the pack and its baseline, then writes JSON and Markdown under `evaluation/runs/`. Its result intentionally has no semantic detection claim: it proves corpus wiring, isolation, scoring, and reporting work together, not that an AI model found an issue. Its visible finding-quality gate may therefore be unmet without failing the integration command; invalid provenance, isolation, artifact, or safety behavior still fails it.

### Exercise language-neutral workflow coverage

The local semantic-regression pack adds vulnerable/patched source pairs in C#, Go, PHP, Python, Ruby, and Rust. It validates that the same workflow accepts different languages without a parser, language allowlist, or language-specific finding rule:

```bash
bun run eval:corpus:integration -- \
  --corpus evaluation/data/research-corpora/private-mixed-language-v1
```

This pack is intentionally provisional and diagnostic. It tests source integrity and workflow behavior only; it cannot measure real-world recall, precision, reliability, or provider quality.

## Check whether the dataset is large enough

```bash
bun run eval:corpus:readiness
```

To inspect a separate, already-local research pack, pass its root explicitly;
the command rejects unknown options rather than silently falling back to the
default corpus.

```bash
bun run eval:corpus:readiness \
  --corpus evaluation/data/research-corpora/ai-assisted-real-world-v1
```

This does not call an AI provider. It reports whether the local corpus has
enough independently human-reviewed real-world vulnerable/patched pairs for a
pilot or a reliability claim. It also separately reports whether a source-pinned
real-world pair is available for **internal development calibration**: that
requires one matching AI-assisted source review, confirmed causal-patch
validation, a protocol fingerprint, and no open conflict or high uncertainty.
This is an internal diagnostic label for that exact pair—not a readiness gate,
model-quality result, provider-selection input, pilot, or reliability claim.
Provisional entries are visible as acquisition progress, but cannot satisfy any
external readiness condition. Synthetic fixtures and narrow semantic regression
examples remain valuable, but they are counted separately and cannot make a
real-world benchmark look larger than it is.

The report also shows the distribution of development pairs across six control families: state/ownership, authorization/tenancy, validation/canonicalization, sensitive-data handling, unsafe operation bounds, and injection/outbound boundaries. These are dataset-balance labels used only by the evaluator; they do not become rules that decide whether code is vulnerable.

## Add a reviewed local pack

The product never downloads benchmark data. A contributor first stages and reviews a fully local pack, then copies it through the checksum and license gate:

```bash
bun run eval:import --source ./staged-corpus --output ./evaluation/data/corpora/new-pack
```

The command rejects existing output paths, symbolic links, checksum mismatches, invalid answer keys, cross-split projects, and packs that do not permit source inclusion. It writes an `import-manifest.json` containing only relative paths and content digests.

A case marked as fully reviewed must contain two distinct evaluator-only independent human `include` records, not merely two names. The records must agree with at least one source-only-applicable vulnerable finding, the exact finalized planning scenarios, and the patched expectation; a paired case must expect no matching finding after the patch. A planning scenario has explicit expected-finding ids and relevant source paths. Dates, ordering, and rationale may differ. A resolver can record disagreements without erasing either review, but cannot promote a disagreement. The evaluator permits one selected case per repository, so repeated examples from one codebase cannot make the benchmark look broader than it is. Its vulnerable/patched pair remains one case.

Dataset labels and fixing-commit metadata are starting points, not answer keys. Reviewers independently confirm the vulnerable and patched source snapshots, source-only applicability, and expected evidence locations before a case becomes `dual-reviewed`. For bounded internal calibration, one AI-assisted review still needs an explicit recorded causal-patch validation, protocol fingerprint, uncertainty, and conflict state; this never substitutes for independent human review. Candidate selection happens before a provider run and uses documented language/control-family sampling, so the corpus cannot be quietly shaped around a model's known successes.

For the current multilingual source lanes and their strict separation from evaluation inputs, see [real-world acquisition](./real-world-acquisition.md).

## Measure a real provider

Provider measurement is explicit. Set `AUDIT_PROVIDER` and `AUDIT_MODEL` in `.env`; the command defaults to one bounded diagnostic repetition:

```bash
bun run eval:provider
```

This is useful for debugging one concrete result, but it is not a stability or reliability claim. For a deliberate repeat experiment, choose the repeat count for the question and report only statistics supported by the observed trials.

Before a paid run, use the identical no-network preflight. It checks the configured credential is present without reading or displaying it, confirms the exact bundled price record, validates the selected corpus and source checksums, and prints a content-free run identity. It does not create an evaluation artifact or contact a provider.

```bash
bun run eval:provider:preflight \
  --corpus evaluation/data/research-corpora/ai-assisted-real-world-v1 \
  --case-id openssf-cve-2017-16023-decamelize \
  --plan-profile audit-reviewed-plan
```

### Choose what is being measured

The default `end-to-end-generated` profile measures the full workflow: the provider creates the plan, then the evaluator executes it. A miss can come from planning or investigation.

Use `audit-reviewed-plan` when the question is narrower: “given an evaluator-authored plan, how well does the audit investigate it?” The audit plan is a strict evaluator-owned fixture: it lives beside evaluator data, not inside the target or answer key; defines only review scope and questions; is rebound to the exact source/context inventory for each trial; and does not reveal expected findings or locations. Each trial retains only a canonical fingerprint of that fixture and skips the planning provider call. Use `planning-generated` when the question is only whether the provider produced a useful plan; it does not dispatch audit stages. These profiles are deliberately separate, so their measurements are never combined.

```bash
bun run eval:provider --repetitions 1 --plan-profile audit-reviewed-plan
```

Their checkpoints, reports, and baselines carry the profile, so a baseline from one profile cannot be used to pass or fail another. Plan agreement is intentionally shown as not applicable for the audit-only profile.

### Evidence delivery and scoped tools

Production evidence mapping, investigation, and independent verification are tool-guided. The mapper first produces neutral, source-backed facts and records unanswered plan items; each later stage receives the approved vector, the map, a complete scoped path manifest, and allowlisted read/search tools. A persisted finding requires source access in both investigation and verification. This keeps exploration inspectable and prevents a supplied source package from becoming an accidental shortcut around the review boundary.

Every evaluation uses the same scoped repository-tool evidence path as product audit. There is no inline source-delivery profile.

Before a paid evaluation, run the deterministic stage conformance check:

```bash
bun run eval:stages
```

It uses an in-process scripted fixture and a language-unknown source file to exercise mapping, posture, discovery, grounding, verification, and the experimental countercheck. Its JSON result contains only stage names and aggregate tool telemetry. It proves workflow protocol behavior—never vulnerability detection, recall, precision, or model quality—and makes no network or provider call.

`eval:stage-semantic` is a separate, explicit evaluator-only entrypoint for a sealed stage pack. It never falls back to `eval:stages`; any semantic-stage result is an internal `single-ai-assisted-development-review`, not a release, baseline, provider-selection, CI, or product-admission signal.

For one paid integration diagnostic after that check passes, use the separate smoke command. It accepts exactly one development case and one source variant, always uses its evaluator-owned reviewed plan, and validates the selected source checksum without opening an answer key. You may configure an observed-cost guard when an operational stop condition is useful; it is never required and does not limit evidence, tools, or output:

```bash
bun run eval:smoke --case ossf-cve-2018-16492 --variant vulnerable
```

Add `--debug-diagnostics true` only when investigating an operational failure. It stores a separate private, source-free diagnostic with stable stage/error data and, for a repeated output-shape failure, static response-field labels. It never stores rejected response values, source, prompts, tool data, or credentials, and it does not turn a smoke into a quality measurement.

The smoke output is a source-free JSON artifact under the configured evaluation output root. It reports terminal coverage, candidate-aware terminal-lane counts, and aggregate model/tool telemetry only; it never reports recall, precision, findings, an answer-key comparison, a baseline, or a reliability claim.

Evaluation reports also separate candidate-aware terminal lanes. They distinguish a model-declared incomplete verdict from an invalid evidence projection, a failed stage, a missing inspection, or an invalid wrapper result. These are count-only operational diagnostics: they contain no source, prompt, model explanation, or finding content.

When a verifier must refer to existing evidence, it receives a source-free inventory of valid fact IDs and evidence indexes. The same inventory validates its result, keeping the instructions and evidence projection aligned without passing source inline or inferring a security conclusion in deterministic code.

Use an explicit run id to recover a stopped smoke without repeating a completed stage. The command writes a source-free started-run checkpoint before audit work, so the same id cannot overwrite an earlier smoke. `--resume true` reuses only checkpoints bound to the same run id, reviewed plan, target checksum, provider, model, route, prompt protocols, and timeout/retry budget. It does not retry unfinished work unless that intent is explicit:

```bash
bun run eval:smoke --case ossf-cve-2018-16492 --variant vulnerable --run-id smoke-01 --resume true --retry-unfinished true
```

The ceiling is a shared observed-cost dispatch guard, not a prepaid charge or a promised billing cap. The request that crosses it is retained in the artifact; later dispatches are refused. A resumed smoke registers each exact retained stage observation once before it can issue new requests, including work from an incomplete, failed, or cancelled vector that it will re-run rather than reuse.

```bash
bun run eval:provider --repetitions 1 --plan-profile audit-reviewed-plan
```

This mode never enables shell access, target execution, network access, writes, or access outside the vector scope. Compare models only when pack, profile, tool policy, prompts, and provider configuration are recorded together.


The provider, model, verification route, concurrency, and optional observed-cost guard come only from `.env`; one-off comparison runs use a separate `.env` configuration, not command overrides. Model and run deadlines default to disabled (`0`), so a complete audit is never stopped by an undocumented short timer. If your CI needs an explicit operational stop, choose non-zero values; the model deadline is applied by both the review runtime and provider transport, and a reached deadline becomes a visible cancelled trial that can resume only explicitly. When both values are positive, run timeout must be at least model timeout. By default, a failed agent invocation gets one fresh same-input retry while keeping the original vector scope; a normalized context-window error instead uses deterministic scope recovery. A continuing provider problem remains a failed trial.

The report separates its **workflow finding gate** from its **evidence qualification**. A passing workflow gate only says that this recorded run met its finding/safety criteria; it cannot by itself establish model quality. New runs derive `diagnostic`, `development-pilot`, or `private-holdout` from the selected split and independently reviewed corpus state. A private-holdout claim additionally needs a steward-signed, source-free attestation for the physically separate holdout pack. Pass its JSON envelope and public key only when running that split:

```bash
bun run eval:provider --split private-holdout --corpus /secured/holdout-pack --holdout-attestation /secured/holdout-attestation.json --holdout-public-key /secured/holdout-public.pem
```

The evaluator verifies the Ed25519 signature, public-key fingerprint, exact pack checksum, frozen readiness decision, and benchmark protocol before any provider call. It stores just the attestation identifier, signing-key fingerprint, date, and payload checksum with the result; it never reads a private key, answer key, source text, or the readiness report through this mechanism. Diagnostic runs are never eligible for a provider-quality or reliability claim, and incomplete evaluation artifacts are rejected. The report separates generated-plan path reachability from finding recall, shows patched false positives, completion, agreement across repeated runs, latency, and baseline violations. Path reachability shows whether a generated vector included evaluator-adjudicated paths; it does not claim that the plan understood the scenario semantically. It records vector concurrency, model-call counts, and input/output/cached/reasoning tokens. A stage table separates planning, evidence mapping, vector investigation, and independent verification, including attempted and successful source read/search counts, completed and failed calls, and returned bytes, so cost and latency hot spots are visible without retaining code or tool transcripts. A rejected tool attempt never counts as source inspection. A separate evaluator-only trace shows, for every expected evidence role, the first workflow stage where it stopped being represented: plan scope, neutral mapping, candidate-blind posture, discovery, grounding, verification, or terminal coverage. The trace contains only an evaluator finding id, a role token, stage booleans, and a first-loss label—never code, paths, locations, prompts, tool transcripts, model output, seeds, or candidates. It is neither a finding score nor a security conclusion. Its finding-admission funnel shows whether candidates were absent, rejected by evidence integrity, rejected or left incomplete by the verifier, or admitted. It is numeric diagnostic evidence only; it never contains code, prompts, tool results, or model text. Provider runs record exact corpus-manifest, selected-population, prompt, verifier-route, and benchmark-protocol fingerprints. The benchmark protocol binds the evaluator answer keys and, for a reviewed-plan audit, the evaluator-owned reviewed plan; do not compare costs or quality across different fingerprints. An independent verifier experiment also needs its own preregistered route-bound baseline. Estimated cost is resolved only from the bundled exact-model price catalogue; an unlisted model is explicitly unavailable. A failed run is retained as evidence; it is never converted into a clean zero-score result.

When a trial is incomplete, failed, or cancelled, the report keeps any reached
accepted finding and review-required identities in **Retained unscored
outcomes**. They are useful follow-up observations, not true positives, false
positives, or precision input. The report keeps their funnel separate from the
completed-trial funnel, and every normal score stays unavailable for that
trial.

### Compare two like-for-like runs

Use the local artifacts, not copied report text, to compare a measured change:

```bash
bun run eval:compare --baseline evaluation/runs/baseline/evaluation-run.json --candidate evaluation/runs/candidate/evaluation-run.json
```

For a deliberate single-model experiment, use `--kind primary-model-experiment`. Both runs must use the same protocol and `same-route` verification; the command permits only the primary provider/model route to differ. This is an evaluation tool, not a way to combine models in one audit.

The command shows aggregate and per-stage token, tool, latency, cost, and finding-count deltas. It refuses to call the runs comparable when any measurement boundary differs, including the prompt protocol or verifier route. This makes a changed instruction, model, verifier route, budget, or corpus visible instead of letting it look like an improvement.

Provider evaluation checkpoints save each completed trial outside the reviewed target and include the selected plan profile. Re-run the same id with `--resume true` to reuse completed trials, or add `--retry-unfinished true` to resume incomplete, failed, or cancelled trials from their newest matching audit phase:

```bash
bun run eval:provider --run-id baseline-01 --resume true --retry-unfinished true
```

If a later evaluator step fails, the saved trial still shows the completed model stages reached before that error. A local continuation failure is labelled `audit-continuation-failed`, so it cannot be mistaken for a provider-quality result or a provider outage. A required checkpoint-write failure is labelled `checkpoint-persistence-failed`; it retains the completed stage telemetry but leaves the trial unscored and requires an explicit resume after storage is repaired. This keeps cost and usage evidence visible without pretending the audit completed. Mutable evaluator checkpoints are kept separately from the final run directory, so they cannot block final publication. The command freezes a completed measurement before publication, writes one validated directory containing the JSON run, Markdown report, trial trace, and manifest, and only then marks the checkpoint **completed**. A resume from that frozen state only completes publication; it does not call the model again. A publication stop also records a safe reason such as an occupied terminal destination, invalid staging directory, or failed rename—never a filesystem path or source content. Only a failed final rename may be resumed automatically; an occupied, invalid, or otherwise uncertain terminal state requires explicit operator action. If the evaluator command stops earlier, the checkpoint is visibly marked **failed** (or **cancelled**) instead of looking like it is still running; resume it explicitly with the same run id.

Before a stage is shown as completed, Audit validates and converts its response into the stage's usable result. If that conversion fails, the stage is recorded as failed with its already-observed token and cost data; it is never mistaken for a successful audit step. A structurally invalid response may receive one or more same-scope repair attempts using only a content-free description of the invalid result shape. Older artifacts that cannot prove this accounting are diagnostic history, not comparable measurements.

Only one evaluator may use a run id at a time. If a previous evaluator process ended unexpectedly, the evaluator never guesses that a lock is stale or starts a second writer against the same checkpoint. Inspect the known-abandoned lock first:

```bash
bun run eval:provider:lock:inspect -- --output evaluation/runs --run-id baseline-01
```

The source-free result includes the lock run id, attempt id, immutable checkpoint fingerprint, owner process identifier, host fingerprint, mode, and checkpoint lifecycle state. Only after confirming those values may an operator remove the lock:

```bash
bun run eval:provider:lock:release -- \
  --output evaluation/runs \
  --run-id baseline-01 \
  --attempt-id <inspected-attempt-id> \
  --checkpoint-fingerprint <inspected-checkpoint-fingerprint>
```

Release removes only the matching lock. It never deletes or changes the checkpoint, staged data, or published artifacts, and it does not start or resume work. A provider timeout or cancellation is shown separately as **cancelled**, is not retried automatically, and can be resumed only with the explicit unfinished-retry option.

## Interpreting the seed

The seed is an integration and regression corpus, not a broad effectiveness claim. It is intentionally small. Publish provider-quality claims only after adding repository-disjoint vulnerable/fixed pairs across more languages and evaluating an unseen private holdout.

## Private mixed-language research pack

There is also a separate local research pack with paired examples in Python, Go, Rust, C#, Ruby, and PHP. It is useful for finding workflow regressions across languages today: each run measures findings, missed issues, false findings, consistency, cost, and latency while keeping labels outside the audit target.

Those numbers are deliberately marked **diagnostic**. The pack is locally authored and its answer keys are provisional, so a high score cannot be presented as real-world model reliability. Its role is to expose where the review workflow loses evidence or mishandles a source-visible control; it never feeds labels, source patterns, or special cases into the reviewer.

When you pass a custom `--corpus` path, the evaluator does not compare it with the built-in seed baseline. Add `--baseline <compatible-baseline.json>` only when you intentionally compare repeated runs of that same pack and configuration.
