# Single-owner acquisition state

Date: 2026-07-31

## Decision

Remove source-snapshot and human-adjudication states from the strict metadata-only candidate registry. They duplicated facts owned by closed source-pair workspaces and strict corpus answer keys, and could become stale after an acquisition or review.

## Contract

- A candidate registry owns only pinned source metadata, selected repository/revisions, metadata digest, and observed upstream source-license status.
- A source-pair workspace is the sole authority that a vulnerable/patched snapshot was acquired. Its immutable manifest retains the registry identity and digest observed at acquisition time, together with complete byte/mode provenance.
- A corpus answer key is the sole authority for human review, resolution, exclusion, and finalized adjudication. No registry field may mirror or anticipate it.
- This is a breaking schema change. Registries containing the removed fields are rejected; no compatibility reader, field-defaulting, migration adapter, or copied state is allowed.

## Verification

Schema tests reject the retired fields. Candidate-registry and acquisition-track tests validate the new metadata-only shape. Existing source-pair manifests remain self-contained provenance records and are rechecked byte-for-byte by the aggregate acquisition validator.
