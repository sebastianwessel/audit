# OSV Go provenance acquisition

Date: 2026-07-31

## Decision

Extend the evaluator-only multilingual acquisition track with one Go OSV Git-range lead and its byte-verified vulnerable/patched source workspace. This is provenance coverage only; it does not alter product admission, corpus import, answer-key, readiness, or provider-quality semantics.

## Contract

- The pinned OSV response must contain the selected repository and one exact adjacent non-sentinel `introduced` then `fixed` Git revision pair. The existing OSV candidate validator verifies this local metadata binding without interpreting advisory details.
- The local source-pair command materializes all tracked regular files for both exact revisions and records their modes and byte digests in a closed workspace. It never runs or labels the Go target.
- The queue-balancing target-control-family value is acquisition metadata only. It is not an expected finding, source classification, answer key, or model-visible value.
- The candidate and source pair have `unverified` upstream source-license status. They cannot contribute to corpus inclusion, evaluation readiness, a baseline, or a provider-quality claim until the existing dual-review and offline-import gates are met.

## Verification

The OSV registry validates against the checked-in advisory snapshot. The acquisition-track test and command verify the registry link and aggregate lead count. The closed-workspace validator rechecks the complete Go pair alongside all existing acquired pairs without a provider, target jail, answer key, build, or target execution.
