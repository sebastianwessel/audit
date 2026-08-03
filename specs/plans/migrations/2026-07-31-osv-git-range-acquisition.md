# OSV Git-range acquisition provenance

Date: 2026-07-31

## Decision

Extend the existing CAP-062 metadata-only candidate validation with one evaluator-only OSV provenance route. It supports a private Python acquisition lead while preserving the boundary between advisory metadata, source-pair provenance, human adjudication, and corpus admission.

## Contract

- The checked-in OSV advisory response is a locally digested metadata snapshot. It is not target source and is never mounted into an audit agent.
- OSV validation accepts a candidate only when the pinned record id and repository match and its Git event list contains the candidate's exact adjacent `introduced` then `fixed` revisions.
- The validator reads no advisory description, reference, category, package, source excerpt, answer key, or model-facing data to make an inclusion or security decision. A successful check proves only the registry's revision provenance.
- The acquired urllib3 pair `source-pair-2be21bd89c0aa2b3` binds that candidate to complete local Git trees: 151 vulnerable and 148 patched regular files, with pair digest `406d6844891ee3cd082f7dd87fbc2b0cb1b157b41a63881c65565ff930e76a25`.
- The pair remains unlabelled and source-license status remains `unverified`. It has no answer key, human adjudication, corpus import, readiness, baseline, provider-run, or model-input effect.

## Verification

Feature-local candidate-registry tests cover the exact OSV pair, a mismatch, and the checked-in snapshot. The offline candidate and source-pair loaders revalidate the registry/snapshot and every acquired file byte and mode. No provider call is part of this change.
