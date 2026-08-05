# Overview

Audit helps a team inspect repository source code for security weaknesses with an AI assistant while keeping the important decision with a human. A use case can optionally provide allowlisted Markdown context about surrounding systems, deployment, data classification, setup, and controls.

It follows two steps:

1. Create a proposed list of attack vectors to investigate.
2. Review or edit that list in your own process, then investigate the matching sealed plan and write a report.

The separation lets a reviewer ask, “Are these the right things to test?” before the expensive analysis starts. The product does not model organizational approval: executing an exact matching sealed plan is its acceptance signal.

## Target languages

Audit is implemented in TypeScript and runs on Bun, but it can inspect every eligible regular UTF-8 source file from any programming language. Language hints improve inventory and reporting when recognized; they never decide whether a file may be reviewed. A finding always states its evidence and limitations, especially where a language-specific semantic check is unavailable.

## What it is good at

- Finding suspicious code paths and security-sensitive patterns.
- Explaining why an accepted source-backed claim may matter.
- Connecting a finding to source evidence.
- Connecting the claim to source evidence so a developer can decide the next fix; a human still owns the final risk and change decision.
- Running as a file-based step in CI/CD.
- Reviewing possible PII, secret, credential, tenant-data, and proprietary-data leakage from source evidence.

## What it is not

Version 1 is a static source review. It does not send requests to your application, run your application, install dependencies, execute shell commands, edit files, or prove that an issue is exploitable in production. It is not a tool for conducting real attacks against running instances.

Treat every result as a review candidate. A security engineer or code owner still decides whether it is a real vulnerability and how to fix it.

~~~mermaid
flowchart LR
  A[Source repository] --> B[Plan]
  B --> C[Human review]
  C -->|sealed plan executed| D[Read-only audit]
  D --> E[Evidence-backed report]
  E --> F[Developer fixes and verifies]
~~~
