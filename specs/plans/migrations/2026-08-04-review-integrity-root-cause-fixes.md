# Review-integrity root-cause fixes

Date: 2026-08-04

## Changes

- Stage-isolated diagnostic packs are now resealed only from their local,
  checksummed canonical fixture through the contributor command. A protocol
  change cannot silently leave a stale static pack that looks current.
- The experimental countercheck remains an evaluator-only observation. Its
  decision can never add, remove, downgrade, or make incomplete a verifier
  admission or product vector coverage result.
- Scoped repository-tool telemetry preserves the stable jailed-filesystem
  failure family instead of collapsing it to an undifferentiated tool failure.
- The obsolete countercheck-specific public audit-error vocabulary is removed.
  Current reports and checkpoints reject it rather than interpreting it as a
  supported terminal product error.
- The optional observed-cost guard is described consistently as an operational
  dispatch stop, never as an estimated-cost gate, a required smoke setting, or
  a cap on approved evidence, tools, output, or queued work.

## Compatibility

This is intentionally breaking. Existing diagnostic packs with stale sealed
identities must be resealed from their locally pinned corpus inputs. Earlier
artifacts that rely on a removed countercheck public error code are rejected by
the current strict schema. No reader, translator, or fallback is provided.
