# Evaluation workspace

This directory contains safe, versioned evaluation data for contributors and CI. It is not a target repository and is never mounted into an audit agent together with its answer keys.

```text
evaluation/
  fixtures/     small reviewed cases and safety probes
  corpora/      pinned offline source snapshots, manifests, and trusted answer keys
  acquisition-snapshots/  unlabelled, evaluator-only vulnerable/patched source pairs
  curation-dossiers/  source-only preparation for future targeted internal cases
  baselines/    reviewed regression thresholds for a corpus pack
  benchmarks/   future benchmark-pack definitions
  runs/         generated output; ignored by Git
```

`bun run eval:corpus:integration` validates the mixed JavaScript, Java, and C seed without a provider credential. Pass `bun run eval:corpus:integration -- --corpus <path>` to validate a different local pack; the command rejects unsupported flags and never silently substitutes the configured corpus. It is a deterministic workflow, isolation, and artifact check—not a model-quality measurement. `bun run eval:corpus:readiness` separately proves whether the trusted corpus has enough real-world paired, independently reviewed, repository-disjoint data for a pilot or reliability claim; synthetic and semantic-regression cases cannot inflate that count. `bun run eval:provider` is explicit, requires a configured provider, defaults to one diagnostic repeat, and writes ignored run artifacts under `evaluation/runs/`. Five or more repeats are required for stability or reliability evidence. Compare two new like-for-like artifacts with `bun run eval:compare --baseline <run> --candidate <run>`; it rejects a comparison if exact corpus manifest, selected population, or benchmark protocol differs. Broader datasets require provenance, licensing, repository-level split controls, human adjudication, and an offline import review.

`bun run eval:candidates --registry <registry>` validates any metadata-only acquisition registry. With `--source <already-local-checkout>`, it checks every referenced metadata file against its pinned digest without downloading anything; OpenSSF records receive their additional field-level metadata check, while OSV records must bind the candidate to one exact adjacent Git `introduced`/`fixed` event pair. This checks provenance only—not a vulnerability label, category, source semantics, acquired-snapshot state, human adjudication, or answer key. Candidates are not corpus cases, are never mounted to an agent, and do not count toward readiness or a quality claim.

`bun run eval:acquisition` reports both metadata-ready and metadata-unavailable lanes. An unavailable lane carries one closed, machine-validated reason: it is an explicit evidence gap—its pinned source did not provide a complete locally verifiable record set—rather than an empty registry or a source of inferred candidates.

`bun run eval:plan-semantic` is the offline follow-up for a generated-plan provider run. Use `--template <output-relative-json>` first to create an intentionally incomplete source-free mapping, then complete it through human review and validate it with `--adjudication <output-relative-json>`. The command binds it to the exact run, generated plan, target/context fingerprints, and answer-key scenario digest before writing semantic scenario recall and relevant-vector precision. It does not call a provider or alter product audit results.

`bun run eval:plan-semantic:summary -- --output <root> --run-id <id>` aggregates only completed semantic adjudications for that generated-plan run. It writes source-free JSON/Markdown and reports the missing-adjudication count explicitly; partial review never becomes a zero or a complete plan-quality result.

`bun run eval:acquire -- --registry <registry> --candidate <id> --repository <local-git-repository> --output <directory>` copies one vulnerable/patched pair from an already-local Git object store into `acquisition-snapshots/`. It verifies the registry binding, exact revisions, every tracked regular-file mode, and every byte digest before atomically publishing the snapshot. It never fetches, runs, builds, labels, reviews, or mounts target source for a model. An acquired pair is provenance work for source-only curation, not an evaluation case or a readiness contribution.

`bun run eval:acquisition-snapshots` rechecks every checked-in acquisition workspace. It verifies the manifest, file modes, and every stored byte; rejects symlinks, unexpected workspace entries, and duplicate workspace identities; and prints only snapshot identifiers, file counts, and digests. It never reads an answer key, changes a candidate, imports a case, calls a provider, or opens a target through the audit jail.

`evaluation/curation-dossiers/` prepares every acquired pair before a paid provider run. A dossier binds an already-validated pair to independent advisory provenance, a source-only review question, and a paired-negative condition. It is never model input or an answer key. A `ready-for-key-authoring` dossier still requires a separate AI-assisted key, reviewed plan, and isolated corpus copy before it can be measured; `materialized` points only to that already-created separate case.
