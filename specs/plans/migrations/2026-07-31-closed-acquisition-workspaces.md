# Closed acquisition workspaces

Date: 2026-07-31

## Decision

Strengthen CAP-089 source-pair provenance without changing corpus admission or evaluation semantics. An acquired pair is now a closed evaluator-only workspace, and a deterministic aggregate command validates every checked-in workspace before human curation uses it.

## Contract

- A workspace contains exactly `snapshot.json`, `vulnerable/`, and `patched/`. Any extra root entry, missing declared entry, symlink, non-regular file, altered mode, altered byte, malformed manifest, or digest mismatch fails closed.
- Aggregate validation reads only the acquisition root and emits content-free pair summaries. It rejects duplicate snapshot identifiers and duplicate registry/candidate identities so one pair cannot be counted twice through copied workspaces.
- Validation never reads target code through the audit jail, answer keys, plans, provider credentials, or model outputs. It does not fetch, execute, update candidate state, import a corpus case, decide a source license, or change readiness.

## Verification

Feature-local tests cover valid aggregate loading plus unexpected root entries, workspace symlinks, and duplicate identity rejection. The deterministic command rechecks every checked-in workspace and is included in the offline validation path.
