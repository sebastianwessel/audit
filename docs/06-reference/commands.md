# Command reference

| Command | Purpose | Model call |
| --- | --- | --- |
| plan | Create an executable attack-vector plan. | Yes. |
| audit | Execute a matching plan and create a report. | Yes. |
| report | Render an existing valid report. | No. |
| lineage | Compare two existing reports with coverage-aware exact finding tracking. | No. |
| `bun run eval:corpus:integration -- [--corpus path]` | Deterministic integration check: verify corpus isolation, artifact writing, and the normal tool-guided workflow with a deliberately non-scoring provider. It never measures detection quality. An explicitly selected path is never replaced by the configured default. | No. |
| `bun run eval:corpus:readiness` | Report whether the locally reviewed corpus can support a pilot or reliability claim. | No. |
| `bun run eval:acquisition` | Validate the evaluator-only multilingual acquisition track and metadata-only registry links. | No. |
| `bun run eval:acquire -- --registry path --candidate id --repository path --output path` | Materialize one complete, pinned vulnerable/patched source pair from an already-local Git repository for evaluator-only human curation. | No. |
| `bun run eval:import` | Copy a fully local reviewed corpus through checksum and license gates. | No. |
| `bun run eval:provider` | Measure an explicitly selected provider over repeated corpus trials. | Yes, opt-in. |
| `bun run eval:compare --baseline <run> --candidate <run> [--kind same-route-regression\|primary-model-experiment]` | Compare two source-free run artifacts only when their corpus, execution configuration, and prompt protocol match. A primary-model experiment changes only the sole same-route model. | No. |

## Common inputs

| Input | Description |
| --- | --- |
| target | Repository directory to inspect. |
| context | Explicit, allowlisted files that explain project-specific behavior. |
| plan | Executable plan JSON for an audit; organizational review is external. |
| output | Existing separate output directory for JSON artifacts. |
| max-parallel-vectors | Optional `1`–`8` transport cap for independent plan-vector work and all run-wide verifier/countercheck dispatches. It never limits candidates or evidence. |
| run-id | Optional stable audit identifier; required together with `resume=true`. |
| resume | `true` reuses matching checkpoints and the retained immutable source/context snapshot for the supplied run id. It does not re-read the current repository contents. |
| retry-unfinished | `true` with `resume=true` resumes incomplete, failed, or cancelled vectors from their newest matching phase checkpoint while preserving completed work. |
| previous/current | Relative report JSON paths used by `lineage`; both must be under the selected output root. |

Options are command-specific. Unknown flags, or flags that belong to another command, are rejected before the reviewer loads configuration or opens a repository. For example, `provider` is valid for `plan` and `audit`, but not for `report` or `lineage`.

Context files are Markdown with validated frontmatter. They may describe surrounding systems, deployment, setup, data classification, trust boundaries, or controls. They are advisory and cannot enable tools, approve a plan, or replace source evidence.

During an audit, the reviewer records a private immutable snapshot before asking a model to inspect source. Resume uses that snapshot, so changed files or context documents cannot alter an in-progress audit. The snapshot tracks each resumable run separately and removes its private bytes only after the final owner finishes. An exclusive run lock prevents two commands from writing the same run’s checkpoints at once. An existing lock fails closed: the reviewer does not guess whether another process is dead. After an operator resolves a known-abandoned lock, normal explicit resume uses the retained snapshot and checkpoints. The default admission policy makes excluded VCS metadata, dependency/vendor caches, generated output, and local secret stores visible in the snapshot manifest rather than silently treating them as reviewed. A vector with no admitted files in its planned scope is **incomplete**: adjust the scope or obtain a source-backed applicability decision. **Not applicable** is neutral only when the completed review records a crisp reason for that specific obligation.

## Project configuration

Copy `.env.example` to the project-root `.env`. The effective value order is built-in defaults, inherited environment, `.env`, then the matching CLI flag. The file is local configuration: never commit it.

| Key | Default | Use |
| --- | --- | --- |
| `SECURITY_REVIEWER_PROVIDER` | none | `openai` or `anthropic` for a model-backed command. |
| `SECURITY_REVIEWER_MODEL` | none | Exact model name for the selected provider. |
| `SECURITY_REVIEWER_API_KEY_ENV` | provider default | Optional name of the environment variable holding the primary provider key. |
| `SECURITY_REVIEWER_ARTIFACT_DIR` | `.security-review-artifacts` | Root for plans, reports, checkpoints, and run manifests. Keep it separate from the reviewed target. |
| `SECURITY_REVIEWER_EVALUATION_CORPUS_ROOT` | `evaluation/corpora` | Default evaluator-only corpus root. |
| `SECURITY_REVIEWER_EVALUATION_OUTPUT_ROOT` | `evaluation/runs` | Default evaluator-only output root. |
| `SECURITY_REVIEWER_MAX_PARALLEL_VECTORS` | `1` | Independent-vector concurrency from `1` through `8`; also the run-wide verifier/countercheck dispatch ceiling. |
| `SECURITY_REVIEWER_MAX_ESTIMATED_COST_USD` | unset | Optional observed-cost dispatch ceiling; it is not an exact billing cap. |
| `SECURITY_REVIEWER_VERIFICATION_MODE` | `same-route` | `independent-route` is available only to provider evaluation. |

For `independent-route`, also set `SECURITY_REVIEWER_VERIFIER_PROVIDER`, `SECURITY_REVIEWER_VERIFIER_MODEL`, and `SECURITY_REVIEWER_VERIFIER_API_KEY_ENV`. The verifier pair must differ from the primary provider/model pair. Prices never belong in `.env`; the product uses its bundled exact-model catalogue.

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
| 1 | Completed with a finding at or above the threshold. |
| 2 | Invalid input, unsafe path, plan mismatch, or contract failure. |
| 3 | Incomplete coverage or recoverable vector errors. |
| 4 | Provider or infrastructure failure prevented a valid report. |

Disabled plan entries are recorded as visible neutral skips. They do not make an otherwise completed audit partial; incomplete enabled work always does.
