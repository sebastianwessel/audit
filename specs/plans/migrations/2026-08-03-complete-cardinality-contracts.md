# Complete cardinality contracts

## Contract

Product repository tools, audit lineage, and evaluator artifacts must not reject or truncate complete declared collections because of a fixed product cardinality. This applies to include/exclude glob sets, lineage entries, per-trial plan/finding/review-required identities, readiness distributions/criteria/limitations, comparison incompatibilities, and comparison stage rows.

Per-item validation, closed objects/enums, path-jail checks, exact finite enum projections, and operational timeouts remain in force. A product boundary may fail an invalid item or record incomplete coverage, but it may not use a fixed collection total as a shortcut for omission.

## Verification

- Unit tests parse collections above each retired ceiling and retain every item.
- Filesystem integration accepts more than 32 requested include globs without omitting an eligible file.
- Schema snapshots regenerate deterministically and the complete offline check stays green.
