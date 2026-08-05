# Benchmarking

The default fixture run needs no credentials or network access. It checks the harness boundary and records an intentionally incomplete semantic-plan measurement, so a failed diagnostic gate in that output is expected and visible; only a safety violation makes the command fail. Live-provider runs are opt-in and record the provider, model, prompt/config digest, tool policy, case split, repeat count, diagnostic gate, and separate evidence qualification. A passing diagnostic gate alone does not establish provider quality.

The report separates generated-plan path reachability from all-role terminal-evidence finding detection, partial terminal recognition, and role localization. A plan scenario is an evaluator-only, source-bound review unit: explicit expected-finding ids plus the relevant paths it must cover. Path reachability says only whether an enabled vector scope reaches those paths; it does not claim that a plan semantically understood the scenario. A finding counts as detected only when the final verifier finding selects every required evidence role. A partial terminal match remains visible for investigation, but it is neither a successful detection nor a gate pass. Earlier-stage loss is shown separately as a diagnostic trail; it helps explain a miss but does not replace the final verifier result. Semantic plan quality comes only from the AI-assisted evaluator review embedded in a generated-plan evaluation after product work closes. The report also shows patched matching findings, adjudicated false positives, unadjudicated outputs, retained-unscored outcomes, safety violations, latency, and coverage. A targeted answer key can measure whether known issues were found, but it cannot establish general precision: an unexpected finding is preserved for review instead of being counted as wrong. Only an exhaustive answer key supports a precision or F1 claim. Its summary explicitly shows minimum as well as median all-role terminal-evidence recall, total vulnerable false negatives, and the two distinct nonmatching-output counts, so a favourable aggregate cannot hide an unstable or unsafe case. Case outcomes are grouped by case and variant across repeats. It separately summarizes completed-trial and non-completed-trial admission funnels. This helps locate a miss without storing source code, prompts, tool results, or model text. One provider repeat is a `single-run diagnostic`; repeated runs show their exact repeat count and only statistics that their observations can support. Neither repeat count nor a benchmark pass means that a target is secure or a provider is reliable; a benchmark pass means only that the recorded evaluation gates passed.

Generated-plan semantic quality uses an evaluator-only AI-assisted review inside the evaluation run, not the path-reachability metric or an approval workflow. The evaluator receives only the sealed plan and a source-free semantic rubric after product work closes; it has no target source or repository tools. The rubric deliberately excludes answer-key paths, finding identifiers, source ranges, and other location data. Those fields remain available only to deterministic reachability and finding scoring after product work closes. This supersedes older “human review” wording in this guide. Its result is internal diagnostic evidence only.

The corpus qualification shown beside a result has a similarly narrow meaning.
`development-calibration` says the selected development population includes an
exact source-pinned real-world vulnerable/patched pair with a traceable
AI-assisted source review, confirmed causal-patch validation, and no open
conflict or high uncertainty. It is useful for improving this workflow against
that pair. It is not a model score, an independent evaluation, provider
selection evidence, or a pilot/reliability claim.

## Read the evidence-strength block first

Every provider-evaluation report starts with an **Evidence strength** table. Read its six rows before interpreting recall, cost, or a passing diagnostic gate:

1. **Operational completion** tells you how many selected trials reached a terminal result. It does not tell you whether the model found the right issues.
2. **Semantic-plan measurement** is either unavailable/incomplete, not applicable for an audit-reviewed plan, or produced by the evaluator workflow embedded in a generated-plan run. Path reachability is not semantic-plan quality.
3. **Finding measurement** states whether this profile actually ran audits and how many trials were complete enough to score.
4. **Precision availability** explains whether labels are exhaustive enough to call unmatched findings false positives. Targeted packs cannot establish general precision.
5. **Corpus qualification** states whether the corpus is diagnostic, development-pilot, or private-holdout evidence.
6. **Route independence** states whether verification shared the main model route or used the separate evaluation-only verifier route. A distinct verifier route alone is not a provider-quality claim.

This separation prevents a healthy-looking operational run, scoped plan, or diagnostic gate from being mistaken for a reliability claim.

When a number needs investigation, start with the report’s **Per-trial execution trace** and then filter the adjacent `case-results.jsonl` file by case, variant, and repeat. It contains the complete ordered, content-safe stage trace: model responses, repository-tool operation types, timings, token/cost observations, returned-byte counts, and stable error codes. It is intended to explain how an evaluation reached a result without exposing target code, prompts, tool inputs/results, or provider output.

For a small diagnostic audit probe, select one evaluator case explicitly. The command runs all of its declared variants (usually vulnerable and patched) once, and records the selector in every artifact:

```bash
bun run eval:provider \
  --case-id ossf-cve-2018-16492 \
  --plan-profile audit-reviewed-plan \
  --repetitions 1
```

This isolates audit behavior from plan generation. A result from the current targeted development pack remains diagnostic: it can identify workflow defects, but cannot establish general provider precision or reliability.

## Measure plan quality honestly

The immediate plan metric checks only whether generated scope globs reach the evaluator’s relevant paths. It does not prove that the plan identified the correct audit scenario.

For a semantic plan measurement, the provider evaluation itself runs one AI-assisted evaluator after each generated plan closes. The evaluator reviews the exact sealed plan, records which expected scenarios it covers and which generated vectors are relevant, receives no target source, and has no repository tools. Its checkpoint is bound to the exact run, trial, plan digest, source/context fingerprints, evaluator-only scenario set, protocol, and model route. It never changes the product result.

Use the generated-plan profile when you want to measure planning only:

```bash
bun run eval:provider \
  --case-id ossf-cve-2018-16492 \
  --plan-profile planning-generated \
  --repetitions 1
```

The resulting run report shows three independent states: whether the workflow completed, whether semantic-plan measurement completed, and whether this profile measured findings. If the evaluator is unavailable, fails, or is cancelled, the completed planning result is kept; the semantic state is explicitly incomplete and the diagnostic gate cannot pass. There is no separate evaluator command or summary to run later, so a partial sidecar review cannot be mistaken for a complete evaluation. The evaluator checkpoint contains only stable identities, numeric usage/cost, and a closed scenario/vector mapping—never source code, prompts, repository-tool data, or raw model output. One AI-assisted development measurement is internal diagnostic evidence only, not independent validation, provider selection, or a reliability claim.
