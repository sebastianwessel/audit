# Benchmarking

The default fixture run needs no credentials or network access. It checks the harness boundary and reports an intentionally blank semantic result, so an unmet finding-quality gate in that output is expected and visible; only a safety violation makes the command fail. Live-provider runs are opt-in and record the provider, model, prompt/config digest, tool policy, case split, repeat count, workflow finding gate, and separate evidence qualification. A passing workflow gate alone does not establish provider quality.

The report separates generated-plan path-scope coverage from finding detection and role-localization. A plan scenario is an evaluator-only, source-bound review unit: explicit expected-finding ids plus the relevant paths it must cover. Scope coverage does not claim that a plan semantically understood a scenario; that requires human review. The report also shows patched matching findings, adjudicated false positives, unadjudicated outputs, safety violations, latency, and coverage. A targeted answer key can measure whether known issues were found, but it cannot establish general precision: an unexpected finding is preserved for review instead of being counted as wrong. Only an exhaustive answer key supports a precision or F1 claim. Its summary explicitly shows minimum as well as median finding recall, total vulnerable false negatives, and the two distinct nonmatching-output counts, so a favourable aggregate cannot hide an unstable or unsafe case. Case outcomes are grouped by case and variant across repeats. It also summarizes the numeric finding-admission funnel from completed new-format trials: model candidates, evidence rejections, verifier outcomes, and admitted findings. This helps locate a miss without storing source code, prompts, tool results, or model text. One provider repeat is a `single-run diagnostic`; five or more repeats are required before reporting repeat agreement or a stability/reliability claim. A benchmark pass never means that a target is secure; it means the recorded evaluation gates passed.

When a number needs investigation, start with the report’s **Per-trial execution trace** and then filter the adjacent `case-results.jsonl` file by case, variant, and repeat. It contains the complete ordered, content-safe stage trace: model responses, repository-tool operation types, timings, token/cost observations, returned-byte counts, and stable error codes. It is intended to explain how an evaluation reached a result without exposing target code, prompts, tool inputs/results, or provider output.

For a small diagnostic audit probe, select one evaluator case explicitly. The command runs all of its declared variants (usually vulnerable and patched) once, and records the selector in every artifact:

```bash
bun run eval:provider --provider openai --model <model> \
  --case-id ossf-cve-2018-16492 \
  --plan-profile reviewed-plan \
  --measurement-scope full-workflow \
  --repetitions 1 \
  --max-estimated-cost-usd 0.60
```

This isolates audit behavior from plan generation. A result from the current targeted development pack remains diagnostic: it can identify workflow defects, but cannot establish general provider precision or reliability.

## Measure plan quality honestly

The immediate plan metric checks only whether generated scope globs reach the evaluator’s relevant paths. It does not prove that the plan identified the correct audit scenario.

For a semantic plan measurement, a human evaluator reviews the exact generated plan and records which expected scenarios it covers and which generated vectors are relevant. The offline command validates that mapping against the exact run, plan digest, source/context fingerprints, and evaluator-only scenario set before calculating scenario recall and relevant-vector precision. It never calls a model or changes the product result.

First generate the intentionally incomplete, source-free template. It has `null` review fields and cannot be scored until a human fills it:

```bash
bun run eval:plan-semantic -- \
  --corpus evaluation/corpora \
  --output evaluation/runs \
  --run-id provider-eval-example \
  --case-id ossf-cve-2018-16492 \
  --variant vulnerable \
  --repetition 1 \
  --template provider-eval-example/adjudication.json
```

Review the exact generated plan checkpoint under `provider-eval-example/.work/plans/` and the evaluator-only case material, replace every `null` outcome and reviewer field, then run the same command with `--adjudication`:

```bash
bun run eval:plan-semantic -- \
  --corpus evaluation/corpora \
  --output evaluation/runs \
  --run-id provider-eval-example \
  --case-id ossf-cve-2018-16492 \
  --variant vulnerable \
  --repetition 1 \
  --adjudication provider-eval-example/adjudication.json
```

The adjudication file lives below the ignored evaluation output root. It contains stable IDs, fingerprints, reviewer identity, and the closed scenario/vector mapping—never source code, prompts, or raw model output. A missing or stale mapping means semantic plan metrics remain unavailable; it is not counted as a failed or passed plan.

When every available plan trial has been reviewed, aggregate the run without another provider call:

```bash
bun run eval:plan-semantic:summary -- \
  --output evaluation/runs \
  --run-id provider-eval-example
```

The summary shows exactly how many generated plans have human semantic evidence. It calculates no score for the remaining trials, so a partial review cannot look like a complete benchmark result. A v1 single-human review is diagnostic only, not provider-quality evidence.
