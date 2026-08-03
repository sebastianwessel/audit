# Acquired source pairs

This directory holds evaluator-only, unlabelled vulnerable/patched source pairs obtained from already-local Git object stores. It is a provenance workspace for human curation, not a corpus and never model input.

Each snapshot contains complete tracked regular files for both pinned revisions and a `snapshot.json` manifest. The manifest binds the pair to its metadata-only candidate, verifies each file mode and byte digest, and records a content-root digest. It contains no expected finding, category, priority, reviewer judgment, answer key, reviewed plan, or model output.

Create a pair only with the local acquisition command:

```bash
bun run eval:acquire -- \
  --registry evaluation/candidates/<registry>.json \
  --candidate <candidate-id> \
  --repository /path/to/already-local/repository \
  --output evaluation/acquisition-snapshots
```

The command never fetches, executes, builds, tests, labels, or sends source to a provider. It rejects missing revisions, unsafe paths, symlinks, submodules, and tampered snapshots. Human reviewers may use a validated pair to prepare independent source-only reviews; only a separately accepted and imported corpus case can contribute to evaluation readiness.

Each workspace contains only `snapshot.json`, `vulnerable/`, and `patched/`. Recheck the complete set at any time with `bun run eval:acquisition-snapshots`; it validates every manifest, copied byte, and mode without reading an answer key or calling a provider.

The current pairs are unreviewed and have recorded source-license status `unverified`, so none is an approved corpus inclusion:

| Snapshot | Candidate | Language | Files (vulnerable/patched) |
| --- | --- | --- | ---: |
| `source-pair-f2d690530afa8fe5` | CWE-Bench-Java CVE-2016-9177 (Spark) | Java | 187 / 186 |
| `source-pair-e7f2be359ec3b494` | OpenSSF CVE-2017-16023 (decamelize) | JavaScript | 9 / 9 |
| `source-pair-2be21bd89c0aa2b3` | OSV CVE-2023-45803 (urllib3) | Python | 151 / 148 |
| `source-pair-b04707ed51b422f0` | OSV CVE-2026-34165 (go-git) | Go | 387 / 476 |
