# Private mixed-language diagnostic corpus

Date: 2026-07-31

## Decision

Add CAP-083 and a separately addressed private mixed-language paired corpus. It supplies immediate, reproducible workflow diagnosis without changing the qualified real-world reliability contract.

## Boundaries

- Cases are locally authored `semantic-regression` data with provisional evaluator-only answer keys.
- Target mounts, prompt inputs, product code, finding admission, and reports never receive answer keys, paired-variant relationships, labels, or source-pattern rules.
- Metrics are always `diagnostic`; they cannot set a baseline or support provider-quality, pilot, holdout, or reliability claims.
- An explicitly selected corpus never inherits the unrelated seed baseline; only an explicit compatible baseline enables a regression comparison.
- External acquisition remains an independent track. Its provenance and dual-human-review requirements are unchanged.

## Impact

The evaluation corpus specification, capability inventory, public evaluation guide, and the new local pack must remain aligned. No product audit behavior changes.
