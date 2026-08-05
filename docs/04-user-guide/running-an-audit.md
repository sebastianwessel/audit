# Running an audit

Before starting, confirm:

- the target path is the intended checkout;
- the plan has been reviewed or edited according to your team's process;
- private work and public artifacts go to separate directories;
- provider and model settings are intentional;
- the chosen vector concurrency is intentional.

If the use case has context documents, confirm they describe the intended surrounding system, deployment, setup, data classification, or controls and that they are explicitly allowlisted. Context helps explain code but does not replace source evidence.

The audit reads repository source and selected context, then produces a new report. It does not change the target, contact a running instance, execute code, or perform a real attack.

`AUDIT_MAX_PARALLEL_VECTORS` defaults to `1`; it is intentionally commented out in `.env.example` because most users do not need to configure it. Raise it only when your provider quota and CI resources support parallel independent investigations. The setting bounds all in-flight verifier and evaluation-only countercheck requests across the whole run, so a vector with many candidates cannot create a provider-call burst. It never limits how many candidates or files the reviewer processes; queued work keeps its reviewed-plan order.

## When a run is partial

A partial report is still useful when some vectors completed successfully. It must show which vectors failed, timed out, or were cancelled. Treat the incomplete coverage as a review item; do not interpret “no finding” for an uncompleted vector as a clean result.

## Safe reruns

Use a new run identifier when changing provider, model, limits, or plan. Compare reports as separate observations. If an audit stops partway through, repeat the same run id with `--resume true` to reuse matching completed work from private work; add `--retry-unfinished true` to resume from the smallest exact incomplete boundary. For example, if the grounding draft was saved but the verifier had not yet started, the audit keeps the completed map, posture, discovery, grounding, closures, and recorded cost, then starts only that missing verifier unit. A pending, running, failed, or incomplete verifier/countercheck resumes only according to its exact matching state. Only grounding work explicitly recorded as unfinished returns to its own earlier boundary. Resume never turns an earlier provider failure into a clean result or promises that a retry will succeed. Upload only the public artifact root; private work is not a CI artifact.

After a failed command, keep the private work directory and resume the same run. A report file without its matching run manifest is not a complete publishable audit result.
