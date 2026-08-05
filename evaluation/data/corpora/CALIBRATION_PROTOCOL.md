# Source-only development calibration protocol v1

This protocol governs the evaluator-only `developmentCalibration` record for
the pinned `ossf-cve-2018-16492` source pair. It supports internal workflow
calibration only. It is not independent human review, provider-selection
evidence, a model-quality claim, or a readiness gate.

1. Validate the manifest's vulnerable and patched source digests before review.
2. Review both source trees statically. Do not execute target code, contact a
   service, use a parser-derived security conclusion, or rely on the upstream
   CVE label as an answer key.
3. Confirm that the vulnerable snapshot has the reviewed condition: inherited
   special-property reads can reach ordinary target-object writes during the
   recursive merge.
4. Confirm that the patched snapshot removes that same source-level condition:
   special-property reads require own-property access and special-property
   writes use own-property definition rather than ordinary assignment.
5. Record only a confirmed/inconclusive causal-patch outcome, uncertainty, and
   conflict state. Keep the record source-only, concise, and outside every
   model input and product-admission path.

The reviewed change adds guarded property access and a dedicated property-write
helper. This protocol does not claim runtime exploitability, exhaustive issue
coverage, or absence of unrelated concerns.
