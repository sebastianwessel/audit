# Line-addressable evidence and exact obligation semantics

Date: 2026-08-04

## Change

`repo_read` now returns strict physical `{ line, text }` records instead of an
unnumbered text block. Evidence mapping and verification must cite only a
directly returned line. Review obligations now explicitly require a source
condition, protected security consequence, and the source relationships and
controls that establish or negate it.

## Reason

An observed reviewed-plan evaluation let a model estimate line coordinates and
admit the same generic missing-guard concern in both vulnerable and patched
variants. That neither proved the intended source location nor discriminated
the plan's target security consequence.

## Clean break

This is a strict protocol change. The former unnumbered read output and any
checkpoint or protocol fingerprint that depends on it are rejected; there is
no compatibility reader, translation, migration code, source-specific rule,
or answer-key range expansion. Fresh exact-scope recovery uses the current
tool and instruction fingerprints.

## Verification

Focused tool-contract, source-tool, scoped-instruction, operation-telemetry,
and harness tests prove the new contract before a single paired provider
re-evaluation is used to measure its effect.
