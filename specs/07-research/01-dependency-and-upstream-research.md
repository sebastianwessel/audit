# Dependency and upstream research

Research date: 2026-08-04. Recheck versions and Purista exports before implementation.

| Choice | Version/source | Rationale |
| --- | --- | --- |
| Bun | Local 1.3.14; floor >=1.3.14 | One runtime, package manager, and TypeScript-first test runner. [Bun](https://bun.sh/docs), [tests](https://bun.sh/docs/test). |
| Purista | @purista/harness 1.7.2 | Typed defineHarness graph, agents, workflows, sandbox, telemetry, and testing. |
| Providers | @purista/harness-openai and @purista/harness-anthropic 1.7.2 optional | Provider portability and optional dependency behavior. |
| Zod | 4.4.3 | Runtime validation, inferred types, and JSON Schema. [Basics](https://zod.dev/basics), [JSON Schema](https://zod.dev/json-schema). |
| TypeScript/Biome | 7.0.2 / 2.5.7 | Strict compile-time checks and one formatter/linter. |

The installed Purista Anthropic adapter forwards cached-input and cache-creation usage, but its typed application-facing interface does not expose an Anthropic cache-control boundary for structured tool-guided messages. The reviewer therefore keeps Anthropic cache routing disabled. The underlying SDK capability is not sufficient evidence to add a provider-specific prompt rewrite or bypass the harness abstraction.

## Upstream lessons

The [Visa Vulnerability Agentic Harness](https://github.com/visa/visa-vulnerability-agentic-harness) contributes staged threat modeling, verification, deduplication, structured findings, run metadata, redaction, and authorized-use warnings. We adopt planning before analysis and structured evidence, while deferring remediation edits, validation panels, SARIF, remote feeds, and durable checkpoints.

The [Vercel Deepsec repository](https://github.com/vercel-labs/deepsec) contributes matcher-driven discovery, project context, resumable/diff-aware workflows, and report exports. We adopt deterministic inventory, short human-curated context, and artifact-based CI flow, while rejecting shell-capable agents, mutable worktrees, remote sandboxes, network gateways, plugins, and a persistent per-file cache for v1.

## Current standards and evaluation references

The design uses MITRE ATLAS as a living taxonomy source for AI/agent attack techniques, NIST AI RMF and its Generative AI Profile for risk and evaluation framing, OWASP’s current Agentic Applications guidance for agent-specific threat classes, OASIS SARIF 2.1.0 for downstream static-analysis interchange, and FIRST CVSS v4.0 for optional technical severity context. These references are mappings and evidence sources; they do not replace the product’s four priority bands or human approval gate.

Evaluation research reviewed on 2026-07-27 includes Meta’s CyberSecEval 3, SecureAgentBench, SEC-bench, SecRepoBench, JitVul, OWASP Benchmark, NIST Juliet/SARD material, and SecureBench’s answer-key isolation model. The recurring state-of-the-art requirements are repository-level context, vulnerability-introducing/fixing pairs, trusted or hidden scoring, functionality/security separation, adversarial robustness, contamination controls, repeated stochastic runs, and cost/latency reporting. The project therefore evaluates the whole agent harness plus tools, not only an underlying model.

## Evidence boundary

Package metadata and primary docs were checked on the research date. Any implementation mismatch must update this record before code relies on it.

Primary references: [MITRE ATLAS](https://atlas.mitre.org/), [NIST AI RMF resources](https://www.nist.gov/itl/ai-risk-management/ai-risk-management-resources), [NIST Generative AI Profile](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf), [OWASP Agentic Applications](https://genai.owasp.org/download/52117/), [SARIF 2.1.0](https://www.oasis-open.org/standard/sarif-v2-1-0/), [CVSS v4.0](https://www.first.org/cvss/v4.0/), [CyberSecEval 3](https://ai.meta.com/research/publications/cyberseceval-3-advancing-the-evaluation-of-cybersecurity-risks-and-capabilities-in-large-language-models/), [OWASP Benchmark](https://owasp.org/www-project-benchmark/), [SecureAgentBench](https://arxiv.org/abs/2509.22097), [SEC-bench](https://arxiv.org/abs/2506.11791), and [SecRepoBench](https://research.google/pubs/secrepobench-benchmarking-code-agents-for-secure-code-completion-in-real-world-repositories/).
