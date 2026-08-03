# Security model

The objective is to prevent the auditor from becoming a code-execution, data-exfiltration, or source-mutation channel. Target files, context, model output, and provider responses are untrusted.

~~~mermaid
flowchart LR
  O[Operator] --> C[CLI policy boundary]
  C --> J[Read-only jail]
  J --> T[Target tree]
  C --> H[Purista harness]
  H --> M[Provider]
  C --> W[Output root]
~~~

| Threat | Control | Proof |
| --- | --- | --- |
| Prompt injection | Treat source and optional context as separate untrusted data classes; never execute/import embedded instructions. | Injection fixtures. |
| Traversal/symlinks/root overlap | Pairwise-disjoint canonical roots, component-wise no-follow validation, read-only source snapshot, and separate artifact jail. | Root-topology, symlink-swap, and no-write-before-validation tests. |
| Code execution | No imports, subprocess, shell, package install, eval, or executor. | Permission tests. |
| Network/SSRF | No fetch, sockets, MCP HTTP, or network-capable sandbox for target tools. | Static/runtime deny tests. |
| Secret leakage | Redact evidence/report; NO_CONTENT telemetry; no raw logs. | Redaction corpus. |
| Resource exhaustion | Explicit timeouts, cancellation, retry policy, bounded safe I/O transactions, and durable recovery. Transaction pages must automatically continue and may not become total source/context/file/line/match/tool-call/vector limits. | Continuation, overflow recovery, cancellation, and no-silent-omission tests. |
| Casing/shape drift | Normalize closed enum tokens; reject unknown or malformed data. | Contract tests. |
| Workflow authority confusion | Planner emits an executable plan; audit accepts only a strict target/context-matching artifact and stores no reviewer or approval state. | Plan schema and identity-gate tests. |
| False-positive overclaiming | Evidence, limitations, and verifier status required. | Report tests. |
| Verifier confirmation bias | A separately mounted countercheck experiment may only uphold/reject/incomplete an already verifier-accepted hypothesis under the same scope; it is isolated from production admission until evaluation demonstrates a benefit. | Countercheck scope, no-new-hypothesis, rejection, telemetry, and no-production-wiring tests. |
| Candidate anchoring and same-route verifier confirmation bias | Before discovery, CAP-067 runs a fresh candidate-blind source-posture assessment using the same vector scope, neutral evidence map, and read-only tools. It sees no finding, classification, urgency, proposed fix, or verifier result. A later candidate-aware verifier may add evidence after an inconclusive posture. A structurally accepted result that conflicts with a relevant candidate-blind contradicted posture is retained only in the redacted, non-gating human-review queue; it is never a confirmed finding or chain. This is an independence/disagreement signal over model judgments, never a parser, language, source-text, benchmark, or answer-key rule. CAP-072 through CAP-076 separate non-reportable discovery from canonical grounding and exact map-bound obligation/posture reconciliation. CAP-063's alternate model route remains evaluation-only. | Blind-input, no-candidate-data, scope, disagreement-routing, posture/map binding, selected-map-evidence provenance, verifier-materialization, control-coverage, checkpoint, telemetry, and preregistered five-repeat comparison tests. |
| Active attack behavior | No live-target requests, exploit execution, target-code execution, payload delivery, or credential use. | Capability and network-deny tests. |
| Context authority confusion | Strict frontmatter, exact Markdown preservation, advisory labeling, digest binding, and no permission/approval override. | Context parser and conflict fixtures. |
| Private-holdout overclaiming | Physically separate steward-controlled holdout pack; source-free detached Ed25519 attestation binds exact pack digest to a frozen readiness decision before a provider call; artifacts retain only a minimal reference. | Signature, key type/fingerprint, manifest binding, input-file, CLI guard, resume, and report tests. |

Source, context, evidence, and model input are confidential by default. Provider transmission is opt-in and visible in configuration. v1 stores source-derived content only in the private source snapshot/work root and requested safely redacted artifacts; the single artifact projection redacts recognized secrets and personal identifiers and removes terminal/control characters from all persisted or rendered free text without truncating approved source evidence. No hidden cache or database exists. Snapshot objects are never target-visible, report-visible, model-log-visible, or reusable across a different run identity.

The reviewed repository and optional context are the only target-side inputs. Context may describe surrounding systems, deployment, data classification, setup, and controls, but it cannot authorize an action or suppress a source-backed concern. Findings are static reasoning with limitations, not exploit verification.

The operator is responsible for authorization to read the supplied repository and context. The CLI prints a defensive-use warning. Fail closed on jail, plan/input identity, schema, output, or capability violations. Partial coverage is explicit and returns code 3.
