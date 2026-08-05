# Product scope and workflow

## Outcome

An authorized developer or CI job supplies the source repository to review and optional per-use-case Markdown context. Audit creates a scoped review plan. A human may review, edit, extend, enable, or disable it in their own process. The supplied strict plan executes directly when its target and context fingerprints match. The audit produces evidence-backed confirmed claims. Classification, urgency, confidence language, impact summaries, and remediation are explicitly outside this confirmation protocol.

This is a defensive code review tool, not a hacker tool. It analyzes repository code and contextual claims for possible attack paths, data handling weaknesses, PII/secret leakage, missing controls, and unsafe defaults. It does not prove exploitability against a running environment. "Verification" means that a candidate is checked against scoped, in-scope static evidence and the plan vector's questions; it never means sending a payload, executing code, or proving runtime exploitability.

## Scope boundary

In scope are repository files, explicitly allowlisted Markdown/frontmatter context, deterministic inventory/search, model reasoning over scoped evidence, attack-vector planning, evidence-backed findings, data-protection review, and separately persisted non-gating developer guidance for accepted findings.

Target-language policy: the product is language-agnostic. TypeScript/Bun is the implementation toolchain only. Every UTF-8 regular file within the reviewed repository is eligible source evidence regardless of extension or whether a language hint exists. Hints are optional inventory/report metadata; they cannot exclude a file, select a provider, or imply language-specific semantic coverage. A reviewer that lacks language-specific evidence must record a limitation or incomplete coverage rather than claim complete analysis.

Out of scope are running or probing deployments, sending requests to live instances, exploit execution, real-target payload generation, shell/process execution, target-code execution, network calls from target-analysis tools, mutation of the reviewed repository, credential use, persistence, lateral movement, and active exfiltration testing.

## Actors

| Actor | Entry point | Permission |
| --- | --- | --- |
| Developer | plan | Read explicit target/context; write artifacts. |
| Reviewer | Markdown projection plus constrained plan draft | Decide scope and plan content without changing target binding or executable identities directly. |
| Developer/CI | audit | Read a matching plan and target; write report. |
| CI | Exit code and JSON | Fail only when one or more accepted findings are present; `reviewRequired` remains a separate human queue, while incomplete, failed, or cancelled coverage remains a distinct operational outcome. |
| Provider | Purista adapter | Receive scoped, configured model input. |

## Inputs, admission, and context

The target, context, public-artifact, and private-work roots are canonical directories and must be pairwise disjoint in both ancestor directions before the product creates a directory, inventories a file, loads an artifact, or constructs a provider. Neither artifact root is a target or context input. Public artifacts are CI-uploadable source-minimal projections; private work contains plans, snapshots, and resumable state. `03-architecture/09-immutable-evidence-and-terminal-truth.md` owns this boundary.

The target input is admitted by an explicit operator-visible source-admission policy. Every included regular UTF-8 file is snapshotted exactly once; every exclusion has a stable reason. Policy may exclude a named class such as VCS metadata, dependency caches, generated output, or local secret stores, but it must not use a maximum file count, source size, line count, match count, or language allowlist as a silent evidence limit. Source tools read the immutable snapshot, not the mutable target tree. Optional context documents are Markdown files with a strict frontmatter header and exact preserved body. Supported kinds are `architecture`, `deployment`, `data-flow`, `controls`, `threat-model`, and `other`. Context can narrow applicability or explain controls but cannot approve a plan, grant a tool permission, override the no-network/no-execution policy, or replace source evidence.

Context is untrusted input. The system validates its path, frontmatter, encoding, and allowed document type; reads it through complete exact transactions without a document-size cap; labels it as context rather than source; and treats instructions inside the Markdown body as data, not commands. A context claim that conflicts with source evidence is reported as an assumption or limitation and does not silently suppress a finding.

## State and commands

~~~mermaid
stateDiagram-v2
  [*] --> created
  created --> running: execute matching plan
  running --> completed: report
  running --> partial: recoverable vector failure
  running --> failed: safety or contract failure
~~~

The planner creates a strict executable plan. The product does not store approval state or reviewer metadata. A human may edit the artifact outside the product; execution automatically accepts a valid resealed plan. Audit rejects a malformed, unsealed, or target/context/snapshot-mismatched plan before audit-stage provider dispatch.

plan validates paths/config, inventories files, exposes scoped read-only evidence, runs a threat-aware planner, validates the response, and writes an immutable executable JSON plan plus its deterministic Markdown review projection. The planner may also record separate non-executable additional observations for human review; they do not widen the plan or run during audit. `plan-draft` opens neither the target nor a provider: it derives a strict editable draft from one sealed JSON plan. `plan-reseal` validates that draft against the exact sealed base, derives fresh vector/plan identities, records immutable reseal provenance (`resealedFromPlanId`, `resealedAt`) outside plan identity, and writes a new immutable JSON/Markdown plan pair. A human may promote one exact base observation through that draft, which becomes a normal enabled vector in the new plan; no unpromoted observation can affect audit, CI, or evaluation results. Markdown and YAML are not executable inputs.

audit validates target identity and context digest before an audit model or audit tool call. For every enabled vector, it selects only files matched by `scopeGlobs`; maps neutral source facts; then runs a candidate-blind source-posture assessment over every plan-owned risk-positive review obligation before any claim exists. The assessor receives only the plan vector, neutral evidence map, scoped path manifest, labelled context, and scoped read-only tools—not an investigator candidate, claim text, classification, urgency, remediation, or prior verdict. It records exactly one `risk-supported`, `risk-contradicted`, `inconclusive`, or source-backed `not-applicable` assessment for each obligation. `not-applicable` has a crisp reason and is neutral: it is neither an issue nor a passed test. A directional posture conclusion without a scoped tool call is downgraded to `inconclusive` and retained with a limitation; it cannot terminate later source inspection. A tool-guided candidate binds every referenced obligation to a posture assessment and its map facts, then contains only a precise statement, complete operation/unsafe-condition evidence bundles, and limitations. A bundle may contain multiple map-projected locations and a concise explanation of its role. The candidate is then checkpointed and challenged by a verifier in the same scoped scope. A claim persists only when verifier-reconciled source evidence and plan obligations pass deterministic integrity validation and the verifier explicitly reconciles every mapped `control` fact relevant to those obligations. Source-visible behavior without source/context evidence of the plan-required security consequence or reachability is incomplete with a crisp context requirement, not a finding. Every production model phase uses the provider retry policy and records content-free per-request usage, cost, latency, and aggregate tool data. It validates returned evidence locations and scope against transient jailed source, then persists only their range, role, kind, and content digest; records insufficient, rejected, incomplete, or not-applicable evidence rather than promoting it to a claim; deterministically deduplicates the surviving claims; writes JSON/Markdown; and returns a CI code. A schema-valid verifier rejection is a completed negative result, not an operational error; a model/provider failure produces an explicit partial vector outcome. It never fabricates a static candidate or hides completed vectors behind a failed peer vector. A separately mounted countercheck remains an isolated experiment and cannot affect a product report.

Clarification for audit admission: a candidate-blind `risk-supported` posture is never a claim shortcut, and an `inconclusive` posture remains investigable. When a structurally accepted candidate-aware result conflicts with a validated, tool-inspected candidate-blind `risk-contradicted` posture over the same vector scope, the report preserves it as a redacted `needs-review` item. It is not a confirmed claim and has no CI finding effect. This is a generic disagreement signal over independently produced source-review judgments, not a deterministic interpretation of source code, a language-specific rule, or a benchmark signal.

Every product command defaults to concise human stdout and accepts `--result-format json` for one strict machine-readable command result. The result has a command, terminal status, exit-code meaning, stable identifiers, and only jail-relative artifact references; it never contains source, context, model output, credentials, or rendered Markdown. CI uses this result to pass plan, draft, resealed-plan, report, lineage, guidance, and audit artifact references without parsing prose. report formats an existing valid JSON report without model calls. guidance is an optional follow-up command. It validates a sealed plan, existing report, and fresh target/context inventory before a provider session; it uses only the finding's original vector scope and writes a separately bound advisory artifact. It cannot alter a finding, coverage, lineage, evaluation result, or CI exit code.

## Exit codes

| Code | Meaning |
| ---: | --- |
| 0 | Every enabled obligation closed; no confirmed claim. |
| 1 | Every enabled obligation closed; one or more accepted findings. `reviewRequired` items do not affect this code. |
| 2 | Invalid input, unsafe path, plan fingerprint mismatch, or contract failure. |
| 3 | A valid partial report exists, but one or more enabled obligations are incomplete, failed, cancelled, or not reached. |
| 4 | Provider/infrastructure failure prevented publication of a valid report. |

Disabled vectors are visible as `excluded-by-plan` and are neutral; they are outside the enabled completion denominator. An empty source scope is neither clean nor automatically not-applicable. `not-applicable` is neutral only when the execution workflow records a crisp source- or labelled-context-backed reason for that exact obligation. Safety violations fail closed. Provider timeout/cancellation stops new work and records a vector error; candidate-aware cancellation first cancels queued work and waits for already-dispatched siblings to settle with their content-free observations retained. Successful vectors remain in a partial report. The single terminal-state contract owns report status, counters, CLI exit code, and evaluator status.
