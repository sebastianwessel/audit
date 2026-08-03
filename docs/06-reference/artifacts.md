# Artifact reference

## Plan

The plan contains a target identity, inventory summary, and executable review vectors. Plan review and approval are outside the product: executing a validated plan is the approval signal. A vector names a human-readable review focus, scope, rationale, and limitations. It also declares stable review obligations: each pairs a risk statement with the source-backed evidence an audit must seek and close.

## Report

The report contains:

| Section | Purpose |
| --- | --- |
| identity | Report id, run id, plan id, target fingerprint, and generation time. |
| coverage | Matched source count, one source-free closure row for each planned obligation, neutral candidate count, source-assessment conclusion counts, completed/failed state, limitations, source-free candidate-to-admission counts, and content-free stage usage/cost records for every model-backed vector. |
| findings | Verified, redacted, evidence-backed candidate vulnerabilities. |
| errors | Safe, stable error summaries. |

Markdown is for people. JSON is for CI and integrations. Each finding in Markdown lists every available evidence role and its redacted source location; it does not hide supporting, unsafe-condition, or control evidence behind a single primary excerpt.

The Markdown report's **Finding admission ledger** is a balanced count of candidates, deterministic evidence rejections, verifier decisions, reconciled claims, post-verification rejections, and admitted findings for each vector. Before a verifier can retain a finding, it must explicitly account for every relevant source-local control that was recorded in the vector's evidence map. The system checks that this accounting is complete, while the reviewer—not a hard-coded rule—decides whether a control is effective. The ledger helps diagnose review quality without exposing source, prompts, tool transcripts, or model output. The section is unavailable—not zero—for older report artifacts. Its **review-obligation closure** section separates an incomplete review from a completed bounded review that retained no source-backed candidate; neither outcome is a safety guarantee.

## Run manifest

Every successful `plan`, `audit`, and `report` command also writes a content-free JSON manifest under `runs/`. It records timing, command, provider/model when used, terminal outcome, counters, and numeric model usage/cost state when a provider was called. Its model ledger separates planning from each vector’s neutral mapping, candidate-blind source assessment, investigation, and independent verification, including duration, a stable failed/completed outcome, attempted and successful file read/search counts, returned bytes, rejections, budget state, and one ordered numeric record for every provider round inside that stage. Only a successful scoped read or search counts as source inspection; a rejected attempt or file listing does not. If an isolated evaluation experiment runs a countercheck, it receives a separate row and is included in the run total. The human-readable report includes the same per-vector operational ledger, making expensive or slow stages easy to compare without exposing prompts, source excerpts, tool transcripts, raw model output, credentials, or provider request IDs.

An interrupted audit also has one checkpoint per completed or failed vector under `checkpoints/<run-id>/`. Before that final checkpoint, the neutral map and candidate-blind source assessment are saved separately after validation. The reviewer then saves only a completed, validated grounded-candidate set; early hypotheses, raw candidates, and model responses are never saved. This lets a safe retry continue with verification without recreating evidence. Checkpoints contain only validated/redacted artifacts and the identities needed to prove that they belong to the same plan, target, provider, model, vector, and review protocol. They are not model transcripts and cannot be reused for a changed configuration.

## Lineage

The `lineage/` directory contains deterministic comparisons of two audit reports. Each entry contains opaque finding identifiers, vector identifiers, a lifecycle state, and the reason for that state. It deliberately omits paths, code, snippets, finding text, prompts, and model output.

“Resolved” does not prove a fix: it means an earlier evidence-anchor fingerprint was absent after both corresponding vectors completed. The comparison tolerates harmless wording and line shifts, but treats a changed obligation, evidence path, role, kind, or source excerpt as a different finding. “Unknown” means the available report coverage cannot support a lifecycle conclusion.
