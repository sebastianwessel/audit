# Context documents

The repository is the primary evidence source. A use case may also provide Markdown documents with frontmatter describing the surrounding system, deployment shape, data classification, trust boundaries, or known controls.

```text
---
kind: data-flow
title: Customer export handling
sensitivity: confidential
appliesTo:
  - src/export/**
---

Customer identifiers must not appear in debug logs and exports are retained briefly.
```

Context is advisory evidence. It can help the reviewer understand how code is intended to operate, but source evidence is still required for a finding. Text inside a context document is treated as untrusted data and cannot approve a plan, enable a tool, permit network access, or suppress a concern.

The system reads only explicitly allowlisted Markdown files (the `.md` extension is case-insensitive), validates the frontmatter, preserves the document exactly, and records a digest in the plan. It does not impose a fixed document-count or body-size cut-off; if a provider reports a context-window limit, the review retries exact partitions and reports incomplete coverage if it cannot merge safely. Changing context after planning invalidates the plan for audit until a plan matching the new context is supplied.
