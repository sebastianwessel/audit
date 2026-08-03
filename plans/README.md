# Production-readiness improvement plans

These plans were prepared from a read-only review on 2026-08-02. No product source, specification, or public documentation was changed. The repository has no `HEAD` commit; all reviewed files are currently untracked. Before implementation, create and record an immutable baseline commit, then stop if the referenced contracts have materially changed.

## Verdict

Security Reviewer has a sound product premise and several strong safety primitives, but it is not ready for production shipping. Release is blocked by fail-open terminal state, unsafe/ambiguous repository admission, stale checkpoint reuse, lossy recovery, a hidden 64-step Harness ceiling, persistence/privacy gaps, and evaluation metrics that do not yet measure semantic plan or finding accuracy.

## Execution order

| Wave | Plan | Outcome | Depends on |
| ---: | --- | --- | --- |
| 0 | [Production-readiness audit](./000-production-readiness-audit.md) | Evidence, priorities, target architecture, and release criteria | None |
| 1 | [Trust boundaries, terminal state, and resume](./001-trust-boundaries-terminal-state-and-resume.md) | Safe input/output roots, immutable evidence, truthful exits, exact checkpoint identity | Audit |
| 2 | [Durable obligation workflow and recovery](./002-durable-obligation-workflow-and-recovery.md) | Lossless phase ledger, resumable work units, provider-signalled overflow recovery, bounded concurrency | Wave 1 |
| 3 | [Finding contract, reporting, and data protection](./003-finding-contract-reporting-and-data-protection.md) | Internally consistent findings, stable lineage, useful enterprise reports, safe artifacts | Waves 1-2 |
| 4 | [Prompt and agent protocol refactor](./004-prompt-and-agent-protocol-refactor.md) | Simpler obligation-centric reasoning, better discovery/falsification, no premature risk categorization | Waves 1-3 |
| 5 | [Evaluation evidence and release readiness](./005-evaluation-evidence-and-release-readiness.md) | Real one-run quality measurements, qualified corpus, forensic eval traces, reproducible release | Waves 1-4 |
| 6 | [Production-readiness follow-up](./006-production-readiness-follow-up.md) | Lossless scale/recovery, safe artifacts, semantically valid evaluation | Waves 1-5 |
| 7 | [Evaluator recovery and failure diagnostics](./007-evaluation-recovery-and-failure-diagnostics.md) | Exact recovery-leaf reuse, smoke lifecycle parity, and retained failed-stage evidence diagnostics | Wave 6 |
| 8 | [Clean repository baseline](./008-establish-clean-repository-baseline.md) | A reviewable initial commit that excludes unrelated generated output | Wave 7 |
| 9 | [Enterprise audit workflow review and next wave](./009-enterprise-audit-workflow-review-2026-08-03.md) | Explainable measurements, prompt behavioral contracts, and a claim-grade corpus | Waves 1-8 |

## Non-negotiable implementation rules

- Update canonical specs first for each approved breaking contract change, then implementation, generated schemas, agent guidance, public docs, and tests in the same ticket.
- Keep the product language-neutral. Do not add a JavaScript/TypeScript parser, Babel, fixture rule, regex vulnerability detector, or answer-key-informed product behavior.
- Do not pre-split or truncate approved evidence. Per-transaction paging is allowed only when continuation is automatic, complete, and visible.
- A source inspection counts only after a successful, non-empty in-scope read/search result or a successful exhaustive search result over the declared scope.
- Keep target execution, shell, target mutation, network tools, MCP, and active attacks out of the audit harness.
- During development, run one scored provider trial by default. Repeats are an explicit later stability experiment, never a prerequisite for a useful one-run baseline.
- Do not compare models until the scorer and corpus can measure the intended product behavior.

## Reviewed snapshot anchors

| File | SHA-256 |
| --- | --- |
| `src/features/audit-execution/audit.ts` | `c23fdc10d29716a7d26e63d0298eca63d259ce1b6156a41ca4fa4300428be417` |
| `src/features/target-inventory/inventory.ts` | `16277cdf2c3aff24157a196b03aed61218b43ecbd97d28916480a705d88ee370` |
| `src/features/evaluation/real-world-scorer.ts` | `0a214eded27008e5679414582255bee216e50a44dfeee28280442486b6d8aa4a` |
| `src/features/review-workflow/agents/verification/instructions.ts` | `652f5910b8e48c9c6b42be678fa747c96ee0219bffb44691efaed607775cbb1d` |
| `specs/01-product/01-scope-and-workflow.md` | `06cbd95d012f354a37f6f6b7389d8b590d884f285d11d8a3a27ecb198011aef3` |
| `package.json` | `e35c7a21851cee10de15f0204ab9c339d6d5ac5ea0c3eee130d00cd887c3c205` |

## Completion rule

Production readiness is reached only when every P0 item in the audit is closed, every wave's acceptance criteria pass, a blinded dual-reviewed corpus produces a truthful scored one-run result, and the installable release artifact passes supply-chain and end-to-end gates. Passing the current unit suite is necessary but not sufficient.
