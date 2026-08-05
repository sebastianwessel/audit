# Audit execution

Owns evidence/finding schemas, vector orchestration, deterministic validation/deduplication, and colocated tests for timeouts, cancellation, partial coverage, and per-vector model-stage attribution.

Each semantic step (`evidence-map/`, `source-posture/`, `investigation/`, `candidate-grounding/`, and `verification/`) keeps its contracts and pure rules beside an `agent/` facade and a separate `stage/` facade. The harness loads only agent facades; workflow composition loads stages. This prevents startup cycles while keeping each audit step self-contained.
