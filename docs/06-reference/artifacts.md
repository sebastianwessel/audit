# Artifact reference

## Plan

The plan contains a target identity, inventory summary, and executable review vectors. Plan review and approval are outside the product: the audit accepts a valid, matching sealed plan without recording an approval workflow. A vector names a human-readable review focus, scope, rationale, and limitations. It also declares stable review obligations: each pairs one risk-positive question with the source-backed evidence an audit must seek and close.

Every plan has two immutable artifacts with the same plan ID:

| Artifact | Audience | Role |
| --- | --- | --- |
| `plans/<plan-id>.json` | Local audit workflow | The only executable, schema-validated plan. |
| `plans/<plan-id>.md` | Human reviewers | A deterministic, readable projection. It is not parsed or executed. |

To make a review change, create an editable `AttackPlanDraft` with `plan-draft`, then use `plan-reseal` to validate it against the original plan and publish a new pair. The draft can change vectors and non-executable additional observations only; it cannot alter the target/context binding, inventory, timestamps, or derived identities. The descendant keeps the base plan's original creation time and stores its exact base plan ID plus reseal time. A human may promote one original observation by adding its ID to `promotedObservationIds`; the resealed plan turns it into an enabled vector. JSON remains the machine contract because it is sealed and validated deterministically. YAML is deliberately not an executable input.

## Report

The report contains:

| Section | Purpose |
| --- | --- |
| identity | Report id, run id, plan id, target fingerprint, and generation time. |
| review context | Redacted sealed-plan vector titles and exact review-obligation questions. It explains the audit scope but does not add a finding, category, urgency, or remediation decision. |
| coverage | Matched source count, one source-free closure row for each planned obligation, neutral candidate count, source-assessment conclusion counts, completed/failed state, closed limitation codes, source-free candidate-to-admission counts, closed not-applicable reasons with selected source-minimal references, and content-free stage usage/cost records for every model-backed vector. |
| findings | Verified finding identities with a concise redacted claim, role explanations, declared limitations, and evidence references: path, range, role, kind, and immutable content digest. |
| errors | Safe, stable error summaries. |

Markdown is for people. JSON is for CI and integrations. Each finding in Markdown lists a concise redacted claim, why each evidence role matters, declared limitations, and its operation and unsafe-condition evidence bundles. The report deliberately displays content digests as integrity anchors; it never stores excerpts, prompts, raw model output, or verifier reasoning. The retained claim is explanatory context, not source evidence or a security proof. It does not hide a multi-part finding behind a single primary location.

Treat a report JSON/Markdown pair as a terminal published result only when the matching audit run manifest is also present under `runs/`. If a process stops while writing public artifacts, private recovery state keeps ownership and the next explicit resume rebuilds the complete set. Do not upload or consume a report pair by itself after a failed command.

The Markdown report's **Finding admission ledger** is a balanced count of candidates, deterministic evidence rejections, verifier decisions, reconciled claims, post-verification rejections, and admitted findings for each vector. Before a verifier can retain a finding, it must explicitly account for every relevant source-local control that was recorded in the vector's evidence map. The system checks that this accounting is complete, while the reviewer—not a hard-coded rule—decides whether a control is effective. A source-backed verifier rejection is a completed negative result; missing evidence, missing scope, or missing surrounding context remains incomplete. The ledger helps diagnose review quality without exposing source, prompts, tool transcripts, or model output. Its **review-obligation closure** section separates an incomplete review from a completed bounded review that retained no source-backed candidate; neither outcome is a safety guarantee.

## Run manifest

Every successful `plan`, `audit`, and `report` command also writes a content-free JSON manifest under `runs/`. It records timing, command, provider/model when used, terminal outcome, counters, and numeric model usage/cost state when a provider was called. Its model ledger separates planning from each vector’s neutral mapping, candidate-blind source assessment, investigation, and independent verification, including duration, a stable failed/completed outcome, attempted and successful file read/search counts, returned bytes, rejections, and one ordered numeric record for every provider round inside that stage. Only a successful scoped read or search counts as source inspection; a rejected attempt or file listing does not. If an isolated evaluation experiment runs a countercheck, it receives a separate row and is included in the run total. The human-readable report includes the same per-vector operational ledger, making expensive or slow stages easy to compare without exposing prompts, content digests, tool transcripts, raw model output, credentials, or provider request IDs.

An interrupted audit also has one checkpoint per completed or failed vector under private work. Before that final checkpoint, the neutral map and candidate-blind source assessment are saved separately after validation. The reviewer then saves only a completed, validated grounded-candidate set; early hypotheses, raw candidates, and model responses are never saved. This lets a safe retry continue with verification without recreating evidence. Checkpoints contain only source-minimal references, closed state, and the identities needed to prove that they belong to the same plan, target, provider, model, vector, and review protocol. They are not model transcripts and cannot be reused for a changed configuration.

Developer guidance is stored separately under private work while it is resumable. It has no authority to alter an audit report or its exit code. A completed item retains only advisory priority plus content-free stage telemetry; its Markdown uses a deterministic human next action rather than model-authored remediation prose. A guidance attempt can be reused only for the exact same report, sealed plan, target/context, provider, model, and guidance protocol. Context overflow is stored as explicit incomplete coverage, never as a partial advice merge.

## Lineage

The `lineage/` directory contains deterministic comparisons of two audit reports. Each entry contains opaque finding identifiers, vector identifiers, a lifecycle state, and the reason for that state. It deliberately omits paths, code, snippets, finding text, prompts, and model output.

“Resolved” does not prove a fix: it means an earlier evidence-anchor fingerprint was absent after both corresponding vectors completed. The comparison tolerates harmless wording and line shifts, but treats a changed obligation, evidence path, role, kind, or content digest as a different finding. “Unknown” means the available report coverage cannot support a lifecycle conclusion.
