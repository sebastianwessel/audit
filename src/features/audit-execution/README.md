# Audit execution

Owns evidence/finding schemas, vector orchestration, deterministic validation/deduplication, and colocated tests for timeouts, cancellation, partial coverage, and per-vector model-stage attribution.

Each semantic step (`evidence-map/`, `source-posture/`, `investigation/`, `candidate-grounding/`, and `verification/`) keeps its contracts and pure rules beside an `agent/` facade and a separate `stage/` facade. The harness loads only agent facades; workflow composition loads stages. This prevents startup cycles while keeping each audit step self-contained.

`candidate-aware/` owns the shared verifier/countercheck queue, exact resume binding, context-overflow topology, terminal normalization, and durable state transitions. `checkpoint-persistence.ts` owns the one source-free persistence-error boundary shared by vector orchestration and that lifecycle.
