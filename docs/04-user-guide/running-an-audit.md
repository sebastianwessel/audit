# Running an audit

Before starting, confirm:

- the target path is the intended checkout;
- the plan is approved;
- output goes to a separate artifact directory;
- provider and model settings are intentional;
- the chosen vector concurrency and optional observed-cost ceiling are intentional.

If the use case has context documents, confirm they describe the intended surrounding system, deployment, setup, data classification, or controls and that they are explicitly allowlisted. Context helps explain code but does not replace source evidence.

The audit reads repository source and selected context, then produces a new report. It does not change the target, contact a running instance, execute code, or perform a real attack.

`--max-parallel-vectors 1` is the safe default. Raise it only when your provider quota and CI resources support parallel independent investigations. The same setting also bounds all in-flight verifier and evaluation-only countercheck requests across the whole run, so a vector with many candidates cannot create a provider-call burst. It never limits how many candidates or files the reviewer processes; queued work keeps its reviewed-plan order. The same default can be set with `SECURITY_REVIEWER_MAX_PARALLEL_VECTORS` in `.env`.

## When a run is partial

A partial report is still useful when some vectors completed successfully. It must show which vectors failed, timed out, or were cancelled. Treat the incomplete coverage as a review item; do not interpret “no finding” for an uncompleted vector as a clean result.

## Safe reruns

Use a new run identifier when changing provider, model, limits, or plan. Compare reports as separate observations. If an audit stops partway through, repeat the same run id with `--resume true` to reuse completed phase and verifier work; add `--retry-unfinished true` to reattempt only incomplete, failed, or cancelled work. Interrupted verifier work is safely scheduled again, while an exact completed verifier result is not paid for twice. The tool does not claim that two AI runs will produce identical findings.
