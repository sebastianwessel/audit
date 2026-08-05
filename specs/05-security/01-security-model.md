# Security model

The objective is to prevent the auditor from becoming a code-execution, data-exfiltration, or source-mutation channel. Target files, context, model output, and provider responses are untrusted.

~~~mermaid
flowchart LR
  O[Operator] --> C[CLI policy boundary]
  C --> J[Read-only jail]
  J --> T[Target tree]
  C --> H[Purista harness]
  H --> M[Provider]
  C --> P[Public artifact root]
  C --> W[Private work root]
~~~

| Threat | Control | Proof |
| --- | --- | --- |
| Prompt injection | Treat source and optional context as separate untrusted data classes; never execute/import embedded instructions. | Injection fixtures. |
| Traversal/symlinks/root overlap | Pairwise-disjoint canonical roots, component-wise no-follow validation, read-only source snapshot, and separate artifact jail. | Root-topology, symlink-swap, and no-write-before-validation tests. |
| Code execution | No imports, subprocess, shell, package install, eval, or executor. | Permission tests. |
| Network/SSRF | No fetch, sockets, MCP HTTP, or network-capable sandbox for target tools. | Static/runtime deny tests. |
| Secret/source leakage | Keep source and context content in the jailed transient/private-work path; public artifacts retain only source references, immutable content digests, closed reason tokens, deterministic templates, and the feature-owned validated/redacted claim narrative needed to explain a confirmed or review-required item. A narrative is not a source excerpt, transcript, evidence, identity, or admission input. Persistable plan and narrative prose crosses the shared artifact-text normalizer; it is defence in depth, never a substitute for source minimization. NO_CONTENT telemetry and no raw logs apply throughout. | Artifact-classification, digest-binding, plan/narrative-text normalization, public-root archive, and no-source-content serialization tests. |
| Provider transport incompatibility | Validate every live structured-output contract against the selected declared provider profile before target I/O, provider construction, artifact work, or dispatch. A provider-only envelope is lossless transport adaptation, not a new semantic result. | Pure profile, root-schema, envelope, preflight, and no-side-effect tests. |
| Evaluator diagnostic leakage | Keep provider-failure diagnostics disabled by default and evaluator-private when explicitly enabled; recursively redact the narrow allowlist and exclude it from public artifacts, product telemetry, scoring, baselines, and reuse. A repeated output-validation stop may retain only its complete canonical static schema-path descriptor—validated, deduplicated, sorted, and never truncated—and its digest, never values or validation prose. | Opt-in, redaction, descriptor canonicalization/non-collision, repeated-validation terminal-state, write-failure isolation, and no-public-artifact tests. |
| Resource exhaustion | Explicit timeouts, cancellation, retry policy, bounded safe I/O transactions, and durable recovery. Transaction pages must automatically continue and may not become total source/context/file/line/match/tool-call/vector limits. | Continuation, overflow recovery, cancellation, and no-silent-omission tests. |
| Casing/shape drift | Normalize closed enum tokens; reject unknown or malformed data. | Contract tests. |
| Workflow authority confusion | Planner emits an executable plan; audit accepts only a strict target/context-matching artifact and stores no reviewer or approval state. | Plan schema and identity-gate tests. |
| False-positive overclaiming | Evidence, limitations, and verifier status required. | Report tests. |
| Verifier confirmation bias | A separately mounted countercheck experiment may only uphold/reject/incomplete an already verifier-accepted hypothesis under the same scope; it is isolated from production admission until evaluation demonstrates a benefit. | Countercheck scope, no-new-hypothesis, rejection, telemetry, and no-production-wiring tests. |
| Candidate anchoring and same-route verifier confirmation bias | Before discovery, CAP-067 runs a fresh candidate-blind source-posture assessment using the same vector scope, neutral evidence map, and read-only tools. It sees no finding, classification, urgency, proposed fix, or verifier result. A later candidate-aware verifier may add evidence after an inconclusive posture. A structurally accepted result that conflicts with a relevant candidate-blind contradicted posture is retained only in the source-minimal, non-gating human-review queue; it is never a confirmed finding or chain. This is an independence/disagreement signal over model judgments, never a parser, language, source-text, benchmark, or answer-key rule. CAP-072 through CAP-076 separate non-reportable discovery from canonical grounding and exact map-bound obligation/posture reconciliation. CAP-063's alternate model route remains evaluation-only. | Blind-input, no-candidate-data, scope, disagreement-routing, posture/map binding, selected-map-evidence provenance, verifier-materialization, control-coverage, checkpoint, telemetry, and explicit single-run and optional repeat-comparison tests. |
| Active attack behavior | No live-target requests, exploit execution, target-code execution, payload delivery, or credential use. | Capability and network-deny tests. |
| Context authority confusion | Strict frontmatter, exact Markdown preservation, advisory labeling, digest binding, and no permission/approval override. | Context parser and conflict fixtures. |
| Private-holdout overclaiming | Physically separate steward-controlled holdout pack; source-free detached Ed25519 attestation binds exact pack digest to a frozen readiness decision before a provider call; artifacts retain only a minimal reference. | Signature, key type/fingerprint, manifest binding, input-file, CLI guard, resume, and report tests. |

Source, context, evidence, and model input are confidential by default. Provider
transmission is opt-in and visible in configuration. The product has exactly
three data classes:

- **public artifacts** are publishable JSON/Markdown reports and lineage. They
  contain only identifiers, closed status/reason tokens, deterministic
  human-readable templates, plan-independent labels, evidence roles/locations,
  immutable content digests, counts, numeric observations, and a finding's
  validated/redacted claim narrative. That narrative is narrowly structured
  human-facing context, not raw model output, a source excerpt, evidence,
  identity, or an admission input. Public artifacts contain no target/context
  text, prompt, tool data, verifier rationale, credential, provider request
  identifier, executable plan, or plan draft.
- **private work** contains source/context snapshots, sealed plans and their
  human Markdown projections, editable plan drafts, resumable checkpoints,
  locks, and evaluator work needed for exact recovery. It is never a CI upload
  artifact, report input, or public-root descendant. It remains bound to its
  run identity and is discarded only by an explicit exact-run operation.
- **private evaluator diagnostics** are an optional, ignored sub-class of
  private work. They contain only allowlisted, recursively redacted,
  source-free failure metadata for a locally enabled evaluation debug session.
  They are not checkpoints, observations, report inputs, scoring inputs,
  baseline/comparison data, or product telemetry, and a diagnostic-write
  failure cannot change an audit or evaluation outcome.
- **ephemeral data** is prompts, raw model output, and tool arguments/results.
  It is retained only in memory for the active operation and is never written.

The public and private roots are canonical, non-symlink, disjoint directories:
neither may be equal to, an ancestor of, or a descendant of the other, target,
or context roots. This is validated before target or provider work. No hidden
cache or database exists. Snapshot objects are never target-visible,
report-visible, model-log-visible, or reusable across a different run identity.

Before any model-backed target or provider work, the platform validates the
selected provider route's declared structured-output profile against every live
output schema. It inspects only the schema structure, not source or model data.
An incompatible or undeclared profile fails closed with a stable source-free
code. A strict root-object transport envelope may contain a canonical semantic
result for a provider that requires that shape, but is unwrapped before feature
materialization and is never a persisted security decision.

The reviewed repository and optional context are the only target-side inputs. Context may describe surrounding systems, deployment, data classification, setup, and controls, but it cannot authorize an action or suppress a source-backed concern. Findings are static reasoning with limitations, not exploit verification.

The operator is responsible for authorization to read the supplied repository and context. The CLI prints a defensive-use warning. Fail closed on jail, plan/input identity, schema, output, or capability violations. Partial coverage is explicit and returns code 3.
