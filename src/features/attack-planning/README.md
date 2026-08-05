# Attack planning

Owns executable attack-plan/vector schemas, planner orchestration, and colocated tests for casing normalization and target/context identity binding.

- `plan/` owns the sealed plan, editable draft, and Markdown projection.
- `plan/index.ts` is the narrow cross-feature facade for sealed-plan contracts and identity.
- `planner/agent/` exposes the construction-safe model contract and instructions.
- `planner/stage/` exposes the executable planning call used by workflow composition.
- `index.ts` is the broad attack-planning facade for product composition.
