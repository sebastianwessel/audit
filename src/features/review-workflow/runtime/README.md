# Review-workflow runtime adapters

This folder owns reusable runtime glue shared by agent stages. It contains no agent prompts, output contracts, security-semantic rules, or persisted shapes.

- `source-tools.ts` adapts the jailed filesystem to the single-owned repository-tool contract and enforces an optional vector path set.
- `invocation.ts` owns bounded same-input retries and content-free provider error normalization.

Stage-specific prompts and schemas remain under `../agents/`; the service composes those feature-owned boundaries with the Purista harness.
