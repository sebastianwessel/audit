# Generated-plan recovery

Date: 2026-07-31

## Decision

Extend evaluator retry from audit-only recovery to the preceding generated-plan phase. A completed planning call must not be repeated merely because a later audit phase failed or the process stopped.

## Contract

- Only the provider evaluation path writes a generated-plan checkpoint. Reviewed-plan evaluation has no model planning phase and never creates one.
- The checkpoint contains only the strict draft plan, its content-free model observation, trial id, configuration fingerprint, target/context fingerprints, and timestamp. It contains no prompt, source, tool payload, raw model output, answer key, or provider credential.
- Resume re-inventories the selected source/context and reuses a checkpoint only under an exact configuration/trial/target/context match. It then applies the ordinary evaluator approval projection to that same draft and lets existing audit checkpoints resume after it.
- A changed binding rejects the checkpoint. No compatibility reader, inferred plan, or fallback reuse is permitted.

## Verification

Feature-local artifact tests prove exact binding and mismatch rejection. Runner tests retain fake-provider-only evaluation. Full deterministic checks validate the strict schema and existing audit-phase recovery path.
