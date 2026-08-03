# Offline source-pair acquisition

Date: 2026-07-31

## Decision

Add CAP-089: evaluator-only acquisition of a complete vulnerable/patched source pair from an already-local Git object store. This fills the gap between a metadata-only candidate lead and independent human corpus curation without treating benchmark data as an answer key.

## Contract

- `eval:acquire` requires a strict metadata registry, selected candidate id, already-local Git repository, and output root.
- It verifies the exact candidate binding and both pinned Git revisions before reading source blobs. It reads Git objects only; it does not fetch, clone, invoke a shell, execute target code, run a build/test, call a provider, or modify the local repository.
- It enumerates the complete tracked tree for each revision. Every regular file is copied with its Git mode and SHA-256 byte digest. Unsafe paths, symlinks, submodules, non-regular tracked entries, missing commits, and output collisions fail closed. There is no file, language, extension, match, or source-size cap that can silently omit a tracked regular file.
- It publishes `<output>/<snapshotId>/vulnerable`, `patched`, and `snapshot.json` atomically. The manifest binds registry identity/digest, candidate/source-record identity, repository URL, exact revisions, ordered files, per-variant content-root digests, and a pair digest. Loading rechecks every stored byte, mode, and manifest digest.
- A snapshot is unlabelled provenance material only. Its manifest cannot contain a plan, expected finding, category, priority, source range/excerpt, reviewer record, answer key, provider result, or model-visible path. It has no corpus, readiness, baseline, or provider-quality weight.
- The recorded source-license status is copied from the candidate only as provenance. Acquisition never interprets it as a license approval or source-inclusion decision. Existing corpus-import license and inclusion controls remain the promotion boundary.

## Verification

Feature-local tests cover exact acquisition, missing revisions, unsafe Git entries, and snapshot tampering. The first generated Spark pair binds the CWE-Bench-Java CVE-2016-9177 lead and is verified as 187 vulnerable plus 186 patched tracked regular files. It is not a corpus case and contributes no readiness count.
