# CI/CD usage

Security Reviewer fits into a pipeline as two explicit jobs. The plan can be generated or checked on demand; the saved plan becomes a reviewable input to the audit job.

~~~mermaid
flowchart LR
  P[Plan job] --> A[Plan artifact]
  A --> R[Optional human review and edits]
  R -->|matching plan artifact| T[Audit job]
  T --> J[JSON report]
  J --> G{Threshold}
  G -->|no blocking finding| OK[Pass]
  G -->|finding or incomplete coverage| FAIL[Fail / review]
~~~

| Stage | Action | Why |
| --- | --- | --- |
| Pull request | Reuse or regenerate a plan for the changed area. | Keeps scope visible. |
| Human review | Review or edit the plan in your own process. | Keeps business and governance context with the plan without imposing a product workflow. |
| Audit | Run with the matching plan and provider-signalled context recovery. | Produces repeatable CI input without pre-trimming eligible source. |
| Gate | Read JSON, not Markdown. | JSON has stable fields and exit semantics. |
| Handoff | Publish Markdown as a build artifact. | Humans get a readable explanation. |

Each command runs locally and keeps the plan-owned target scope intact. If a provider reports a context-window error, the reviewer uses its lossless recovery flow for the same eligible source and context; if it cannot safely complete a decision, it records incomplete coverage rather than dropping evidence or reporting a clean result.
