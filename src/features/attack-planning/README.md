# Attack planning

Owns executable attack-plan/vector schemas, planner orchestration, and colocated tests for casing normalization and target/context identity binding.

- `plan/` owns the sealed plan, editable draft, and Markdown projection.
- `planner/agent/` exposes the construction-safe model contract and instructions.
- `planner/stage/` exposes the executable planning call used by workflow composition.
- `index.ts` is the broad plan contract facade.
