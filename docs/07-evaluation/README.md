# Evaluation

Audit is evaluated as a complete system: the plan gate, scoped read-only tools, agent loop, evidence validation, deduplication, and report. Model quality and product safety are measured separately.

Before a paid provider evaluation, run `bun run eval:provider:preflight`. It checks the selected route's credential presence, price, corpus inputs, and structured-output compatibility locally. It does not construct a provider, write an artifact, or make a network call. A compatibility failure happens before corpus or target access; it is an operational setup problem, not a security finding or model-quality measurement.

Optional evaluation debugging is private and off by default. When enabled for local development, it records only allowlisted source-free operational failure metadata for audit, plan-semantic, and isolated-stage evaluator calls outside normal evaluation artifacts. It does not change a trial result, stage observation, score, baseline, comparison, checkpoint, or public report. A diagnostic-write failure is best-effort only and never changes the result.

```mermaid
flowchart LR
  A[Reviewed fixture pack] --> B[Agent-visible target view]
  B --> C[Normal plan and audit flow]
  C --> D[Validated report]
  D --> E[Trusted scorer]
  E --> F[Metrics and CI gate]
```

Start with [fixture authoring](./fixture-authoring.md), then learn about the [offline real-world corpus](./real-world-corpus.md), [human adjudication](./human-adjudication.md), [source acquisition](./source-acquisition.md), the [multilingual real-world acquisition track](./real-world-acquisition.md), and [benchmarking](./benchmarking.md).
