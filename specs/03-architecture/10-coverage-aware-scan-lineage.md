# Coverage-aware scan lineage

Status: implemented behavior for CAP-071.

## Purpose and boundary

The `lineage` command compares two persisted, validated audit reports from the same separate artifact root. It reads neither a target repository nor context files, does not create a provider, and never invokes a model. It is a review-tracking aid, not a new audit or a proof that a finding was fixed.

The lineage feature owns `audit-lineage/`: a strict Zod contract, deterministic matching/projection, colocated tests, and a Markdown renderer. The CLI only reads/writes artifacts through the existing artifact-store adapter. It must not reuse evaluation comparison code, which compares like-for-like evaluation metrics rather than report coverage.

## Matching and state machine

The feature owns two deterministic finding projections. The run-local identity is derived from the vector id, sorted exact plan obligations, and complete operation/unsafe-condition evidence references (role, kind, path, range, and content digest); it owns report identity and in-run duplicate collapse. The cross-scan fingerprint excludes ranges only, so a pure line shift does not look like a resolved/new finding; it owns lineage and comparison only. Both exclude claim wording and do not use source text, embeddings, language hints, parsers, classification, urgency, or model reasoning to create a fuzzy/root-cause match.

For an exact identity in both reports:

1. Emit `persisting` only if the corresponding vector is `completed` in both reports.
2. Otherwise emit `unknown` with `exact-match-but-coverage-incomplete-or-missing`.

For an identity only in the current report:

1. Emit `new` only if the corresponding vector is `completed` in both reports.
2. Otherwise emit `unknown` with `no-exact-match-and-coverage-incomplete-or-missing`.

For an identity only in the previous report:

1. Emit `resolved` only if the corresponding vector is `completed` in both reports.
2. Otherwise emit `unknown` with `no-exact-match-and-coverage-incomplete-or-missing`.

Missing vectors, skipped vectors, failed vectors, incomplete vectors, or vector-id changes are incomplete coverage. They cannot create `new` or `resolved` claims. One entry is emitted for every identity in the union, ordered by opaque identity. Exact matching intentionally cannot identify a relocated or rewritten root cause; that case remains a pair of coverage-qualified `new`/`resolved` or `unknown` entries for human review. A future ambiguous model-assisted matcher requires a separately specified, source-free, non-admission experiment.

## Artifact and privacy contract

`AuditReportLineageSchema` is version 2. It records only lineage id, generation time, prior/current report identities, aggregate counts, and sorted entries. An entry contains opaque deterministic finding ids, vector ids, state, and a closed reason token. It does not contain source paths, snippets, statements, classifications, urgency, impacts, fixes, limitations, prompts, model output, tool data, credentials, or report source text.

Both inputs must validate as the current `PublicAuditReportSchema`; earlier report versions are rejected at the artifact boundary. Each report must have unique coverage vector ids and unique deterministic finding identities. Invalid/malformed/duplicate artifacts fail before a lineage artifact is written. The command may compare different plan and target fingerprints because change is the point of tracking; it records both identities and makes no cross-version quality claim.

## CLI and recovery

`audit lineage --previous <report.json> --current <report.json>` requires relative JSON paths in the configured public artifact root. It writes `lineage/<lineage-id>.json` atomically and prints the Markdown projection. It returns zero for a valid comparison regardless of the number of new, resolved, persisting, or unknown entries; CI policy belongs to a later separately specified gate. The operation is deterministic and replayable; rerunning the same report pair overwrites the same validated artifact atomically. It loads runtime configuration only to resolve the public root; it has no target state, provider state, credential requirement, checkpoint, or network dependency.

## Acceptance

- Exact identity matching is delegated to the single-owned finding identity function.
- Incomplete coverage cannot produce a `new`, `resolved`, or `persisting` conclusion requiring complete predecessor/successor coverage.
- A lineage artifact and Markdown projection contain no source-derived content beyond opaque ids and vector ids.
- The artifact reader/writer rejects traversal, symlink escape, malformed JSON, stale report schemas, duplicate identities, and unknown fields.
- The feature remains language-neutral: no language hint, extension, parser, regex, or static rule participates in matching or state derivation.
