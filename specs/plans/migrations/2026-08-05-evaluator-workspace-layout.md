# Evaluator workspace layout update

Date: 2026-08-05

This development-only repository restructuring has no persisted artifact format migration or compatibility path.

## Changes

- The evaluator has exactly three top-level ownership roots: `evaluation/src/`, `evaluation/data/`, and ignored `evaluation/runs/`.
- All checked-in evaluator fixtures, corpus packs, acquisition records, source-pair snapshots, curation dossiers, candidate registries, and isolated-stage packs moved below `evaluation/data/`.
- Empty `evaluation/baselines/` and placeholder-only `evaluation/benchmarks/` were removed. A baseline remains an explicitly supplied validated artifact, not an evaluator data directory.
- Evaluator data-root bindings and the acquisition-track digest were resealed after the move; product package boundaries and persisted artifact schemas are unchanged.
