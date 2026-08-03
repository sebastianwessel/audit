# Closed acquisition metadata gaps

Date: 2026-07-31

## Decision

Evolve the evaluator-only real-world acquisition-track artifact so a lane whose
metadata is unavailable has one explicit, closed reason. This makes the absence
of admissible candidate provenance machine-checkable without creating a
candidate, source pair, corpus case, answer key, or quality claim.

## Contract

- `metadata-unavailable` is an evidence state, not an empty metadata registry.
  It must declare exactly one reason: `dataset-distribution-not-present`,
  `record-set-not-present`, or `revision-provenance-incomplete`.
- `scouting` and `metadata-ready` lanes cannot declare an unavailable reason.
  A ready lane still requires its validated metadata-only candidate registry;
  a lane without a registry must claim zero leads.
- The current CVEfixes and DiverseVul pins are explicitly unavailable. Their
  selected repositories cannot produce candidate leads at those pins, and no
  evaluator may infer revisions, labels, a vulnerable/patched pair, or source
  inclusion from their descriptions.
- The artifact remains content-free evaluator metadata. It cannot read source,
  call a provider, construct answer keys, affect readiness, or enter an
  agent-visible target view.

## Verification

Feature-local schema tests reject a missing reason on an unavailable lane and a
reason on a ready lane. The deterministic acquisition command validates the
signed track and reports the unavailable count separately from metadata-ready
lead counts.
