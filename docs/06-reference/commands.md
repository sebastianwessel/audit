# Command reference

| Command | Purpose | Model call |
| --- | --- | --- |
| plan | Create an executable attack-vector plan. | Yes. |
| plan-draft | Create a constrained editable JSON draft from one sealed plan. | No. |
| plan-reseal | Validate a draft against its sealed base and publish a new plan pair. | No. |
| audit | Execute a matching plan and create a report. | Yes. |
| guidance | Create advisory developer guidance for accepted findings in one existing report. | Yes. |
| report | Render an existing valid report. | No. |
| lineage | Compare two existing reports with coverage-aware exact finding tracking. | No. |
| discard | Remove only the exact stopped audit run's private work after its binding is confirmed. It never touches target code or published reports. | No. |
| `bun run eval:corpus:integration -- [--corpus path]` | Deterministic integration check: verify corpus isolation, artifact writing, and the normal tool-guided workflow with a deliberately non-scoring provider. It never measures detection quality. An explicitly selected path is never replaced by the configured default. | No. |
| `bun run eval:stage-isolated:prepare --write` | Contributor-only reseal of the four local, source-pinned diagnostic packs after an audit protocol change. It preserves each rubric and makes no model call. | No. |
| `bun run eval:corpus:readiness [--corpus <local-root>] [--output <run-root>]` | Report whether a selected locally reviewed corpus can support a pilot or reliability claim. | No. |
| `bun run eval:acquisition` | Validate the evaluator-only multilingual acquisition track and metadata-only registry links. | No. |
| `bun run eval:acquire -- --registry path --candidate id --repository path --output path` | Materialize one complete, pinned vulnerable/patched source pair from an already-local Git repository for evaluator-only human curation. | No. |
| `bun run eval:import` | Copy a fully local reviewed corpus through checksum and license gates. | No. |
| `bun run eval:provider` | Measure an explicitly selected provider over repeated corpus trials. | Yes, opt-in. |
| `bun run eval:stage-semantic` | Run an evaluator-owned isolated-stage semantic adjudication. It is diagnostic-only and never substitutes for deterministic `eval:stages`. | Yes, explicit opt-in. |
| `bun run eval:provider:preflight` | Validate the exact provider route, credential presence, bundled price, live structured-output compatibility, corpus checksums, selected population, and holdout inputs. It constructs no provider, writes no artifact, and makes no network call; an output-compatibility failure occurs before corpus or target access. | No. |
| `bun run eval:provider:lock:inspect -- --output <directory> --run-id <id>` | Inspect only source-free ownership metadata and checkpoint lifecycle for one provider-evaluation lock. | No. |
| `bun run eval:provider:lock:release -- --output <directory> --run-id <id> --attempt-id <id> --checkpoint-fingerprint <sha256>` | Explicitly remove one known-abandoned lock after exact identity confirmation. It never changes a checkpoint or evaluation artifact. | No. |
| `bun run eval:smoke` | Run one selected case and variant through the reviewed-plan audit path. It is an operational probe, not a provider-quality measurement. Add `--debug-diagnostics true` only for a local, private, source-free failure diagnostic. | Yes, opt-in. |
| `bun run eval:compare --baseline <run> --candidate <run> [--kind same-route-regression\|primary-model-experiment]` | Compare two source-free run artifacts only when their corpus, execution configuration, and prompt protocol match. A primary-model experiment changes only the sole same-route model. | No. |

## Common inputs

| Input | Description |
| --- | --- |
| target | Repository directory to inspect. |
| context | Explicit, allowlisted files that explain project-specific behavior. |
| plan | Executable plan JSON for an audit; organizational review is external. |
| draft | Relative private-work path for an editable plan draft. It is accepted only by `plan-draft` and `plan-reseal`. |
| run-id | Optional stable audit identifier; required together with `resume=true`. |
| resume | `true` reuses matching checkpoints and the retained immutable source/context snapshot for the supplied run id. It does not re-read the current repository contents. |
| retry-unfinished | `true` with `resume=true` resumes incomplete, failed, or cancelled work from its smallest exact incomplete boundary while preserving every valid completed predecessor. A matching grounding draft is a boundary even before a verifier checkpoint exists. |
| previous/current | Relative report JSON paths used by `lineage`; both must be under the selected public artifact root. |

Options are command-specific. Unknown flags, including removed `--work` and `--public-output` flags, are rejected before the reviewer loads configuration or opens a repository. Runtime configuration, including provider, model, credential-variable name, private-work root, public-artifact root, verifier route, and concurrency, comes only from the resolved environment configuration and is never a command option.


## Machine-readable command results

Add `--result-format json` to any product command when a script needs the artifact created by the command. The command writes one strict JSON object to stdout instead of human text. It contains the command, terminal status, exit-code meaning, stable IDs, and relative artifact paths only—never source, context, prompts, credentials, raw model output, or Markdown.

```bash
bun run start plan --target ./repository --result-format json
```

Use the returned `artifacts` paths directly in the next command. For example, capture the plan JSON path, pass it to `plan-draft`, then use the returned resealed plan JSON path for `audit`; do not discover private files or parse prose.

`eval:stage-semantic` accepts `--pack`, `--output`, `--debug-diagnostics true` for local private failure diagnostics, and `--resume true` for an unfinished evaluator-only retry. It reads its provider route and credential-variable name from `.env`. It validates the selected provider's evaluator-output transport compatibility before reading the pack, opening the output root, constructing a provider, or writing a checkpoint. Its developer-owned pack contains the sealed stage identity, rubric, and already-completed source-free product projection. The command validates that complete binding and any existing checkpoint before it constructs a provider. It never opens a target, executes target code, invokes a product stage, or writes the pack, product projection, rubric, prompt, raw response, or source locations. A completed exact checkpoint rematerializes its count-only report without a model call; an unfinished exact resume retries only the evaluator. Debug diagnostics are private, source-free, non-scoring, and best-effort; a failed diagnostic write never changes the command result.

The provider-evaluation preflight and one-case smoke commands finish through their normal async error boundary. They set the documented exit code after writing their safe output, so checkpoint cleanup and buffered output are not cut short by forced process termination. A preflight failure for an unsupported structured-output shape happens before the evaluator opens target/corpus data, constructs a provider, writes a checkpoint, or sends a request.

## Get help locally

The CLI can explain itself without reading configuration, opening the target or output roots, or contacting a provider:

```bash
bun run start --help
bun run start help audit
bun run start audit --help
```

Use the command-specific output for the accepted flags, required inputs, and a safe example. Errors for missing, unknown, or command-incompatible options name the flag and point back to the same help page; the CLI never silently corrects a flag.

## Create developer guidance safely

`guidance` is an optional follow-up to a completed audit. It reads the sealed plan from private work and the validated public report from the public artifact root, re-inventories the supplied target/context, and refuses a mismatch before it dispatches model work. It writes a separate private JSON artifact under `guidance/`; it does not revise the report, finding identities, coverage, lineage, evaluation score, or CI exit code.

```bash
bun run start guidance \
  --target ./repository \
  --plan plans/<plan-id>.json \
  --report reports/<report-id>.json
```

Each accepted finding receives either an advisory priority or an explicit incomplete/cancelled state. The Markdown projection gives the same deterministic next action for completed items: review the accepted evidence and plan obligations with the owning team, then choose and validate an appropriate mitigation through normal change management. Review-required items never receive guidance. No model-authored remediation text or validation steps are stored. Guidance is not proof that an exploit works and is not an instruction to apply a patch without normal product review and testing.

Give a long-running guidance run a stable `--run-id`. Completed advisory items are checkpointed below private work and are reused only when the report, plan, target/context, provider, model, and guidance protocol still match exactly. A mismatch fails clearly; it never mixes guidance state from different runs. Provider context overflow is explicit incomplete coverage: it is not split because there is no lossless, source-minimal way to persist and merge model-authored advice.

## Review and change a plan safely

`plan` produces a matching pair below private work:

- `plans/<plan-id>.json` is the strict, executable artifact used by `audit`.
- `plans/<plan-id>.md` is a readable review projection. It is never executed or parsed back into a plan.

To change the planned scope, obligations, or limitations, derive a constrained draft, edit that JSON, and reseal it. Resealing preserves the original target/context binding and inventory summary, validates the edited vectors, then creates a new immutable plan ID. It does not call a model or open the reviewed repository.

```bash
bun run start plan-draft \
  --plan plans/<plan-id>.json \
  --draft plan-drafts/review.json

# Edit plan-drafts/review.json in a reviewer or plan-authoring workflow.

bun run start plan-reseal \
  --plan plans/<plan-id>.json \
  --draft plan-drafts/review.json
```

Do not edit a sealed plan JSON in place. Do not use YAML or Markdown as an executable plan format: YAML's flexible typing and aliases make it a poor integrity boundary, while the Markdown file is intentionally presentation-only. If validation fails, the existing sealed plan remains unchanged.

Context files are Markdown with validated frontmatter. They may describe surrounding systems, deployment, setup, data classification, trust boundaries, or controls. They are advisory and cannot enable tools, approve a plan, or replace source evidence.

During an audit, the reviewer records a private immutable snapshot before asking a model to inspect source. Resume uses that exact run-owned snapshot, so changed files or context documents cannot alter an in-progress audit. A completed or discarded run removes only its own private bytes; separate runs never share source snapshots. An exclusive run lock prevents two commands from writing the same run’s checkpoints at once. An existing lock fails closed: the reviewer does not guess whether another process is dead. After an operator resolves a known-abandoned lock, normal explicit resume uses the retained snapshot and checkpoints. The default admission policy makes excluded VCS metadata, dependency/vendor caches, generated output, and local secret stores visible in the snapshot manifest rather than silently treating them as reviewed. A vector with no admitted files in its planned scope is **incomplete**: adjust the scope or obtain a source-backed applicability decision. **Not applicable** is neutral only when the completed review records a crisp reason for that specific obligation.

## Project configuration

Copy `.env.example` to the project-root `.env`, then set `OPENAI_API_KEY`. The effective value order is built-in defaults, inherited environment, then `.env`; command arguments select an operation and never override runtime configuration. The file is local configuration: never commit it.

| Key | Default | Use |
| --- | --- | --- |
| `AUDIT_PROVIDER` | `openai` | Optional route override: `openai` or `anthropic`. |
| `AUDIT_MODEL` | `gpt-5.6-terra` | Optional exact-model override for the selected provider. |
| `AUDIT_API_KEY_ENV` | provider default | Optional name of the environment variable holding the primary provider key. |
| `AUDIT_PRIVATE_WORK_DIR` | `.audit-work` | Local-only root for plans, snapshots, checkpoints, locks, and guidance. Never upload it. |
| `AUDIT_PUBLIC_ARTIFACT_DIR` | `.audit-artifacts` | CI-uploadable root for source-minimal reports, lineage, and run manifests. |
| `AUDIT_EVALUATION_CORPUS_ROOT` | `evaluation/data/corpora` | Default evaluator-only corpus root. |
| `AUDIT_EVALUATION_OUTPUT_ROOT` | `evaluation/runs` | Default evaluator-only output root. |
| `AUDIT_MAX_PARALLEL_VECTORS` | `1` | Positive independent-vector queue capacity; also the run-wide verifier/countercheck dispatch ceiling. It controls in-flight work only. |
| `AUDIT_VERIFICATION_MODE` | `same-route` | `independent-route` is available only to provider evaluation. |

For `independent-route`, also set `AUDIT_VERIFIER_PROVIDER`, `AUDIT_VERIFIER_MODEL`, and `AUDIT_VERIFIER_API_KEY_ENV`. The verifier pair must differ from the primary provider/model pair. Prices never belong in `.env`; the product uses its bundled exact-model catalogue.

## Lineage

Use lineage to track exact, previously reported findings across two audit reports:

```bash
bun run start lineage \
  --previous reports/report-previous.json \
  --current reports/report-current.json
```

It reads only validated report artifacts and writes a source-free JSON result below `lineage/`. It never reads the reviewed repository or calls a model. A finding is **new**, **resolved**, or **persisting** only if its vector completed in both reports. Otherwise it is **unknown**—for example, when a vector was skipped, failed, incomplete, renamed, or absent. An exact match does not detect a rewritten or moved root cause; review those entries manually.

Each context file starts with this small, deliberately restricted frontmatter format:

```markdown
---
title: Production deployment
kind: deployment
sensitivity: internal
appliesTo:
  - "src/**"
---
TLS terminates at the gateway.
```

The accepted `kind` values are `architecture`, `deployment`, `data-flow`, `controls`, `threat-model`, and `other`. `sensitivity` is `public`, `internal`, `confidential`, or `restricted`. Complex YAML and unknown fields are rejected rather than interpreted.

## Exit codes

| Code | Meaning |
| ---: | --- |
| 0 | Completed with no blocking finding and complete coverage. |
| 1 | Completed with one or more accepted findings. Items in the review-required queue are non-gating. |
| 2 | Invalid input, unsafe path, plan mismatch, or contract failure. |
| 3 | Incomplete coverage or recoverable vector errors. |
| 4 | Provider or infrastructure failure prevented a valid report. |

Disabled plan entries are recorded as visible neutral skips. They do not make an otherwise completed audit partial; incomplete enabled work always does.
