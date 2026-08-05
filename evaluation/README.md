# Evaluation workspace

This directory contains safe, versioned evaluation data for contributors and CI. It is not a target repository and is never mounted into an audit agent together with its answer keys.

```text
evaluation/
  src/          evaluator-only TypeScript; never included in the product package
  data/         checked-in, evaluator-only datasets
    fixtures/        small reviewed cases and safety probes
    corpora/         pinned offline source snapshots, manifests, and trusted answer keys
    research-corpora/ explicit local diagnostic and calibration packs
    acquisition/
      tracks/        metadata acquisition tracks
      metadata/      pinned upstream metadata records
      snapshots/     unlabelled vulnerable/patched source pairs
    curation/
      dossiers/      source-only preparation for future targeted internal cases
    candidates/      metadata-only acquisition registries
    stage-isolated/  evaluator-private isolated-stage packs
  runs/         generated output; ignored by Git
```

`bun run eval:corpus:integration` validates the mixed JavaScript, Java, and C seed without a provider credential. Pass `bun run eval:corpus:integration -- --corpus <path>` to validate a different local pack; the command rejects unsupported flags and never silently substitutes the configured corpus. It is a deterministic workflow, isolation, and artifact check—not a model-quality measurement. `bun run eval:corpus:readiness` separately proves whether the trusted corpus has enough real-world paired, independently reviewed, repository-disjoint data for a pilot or reliability claim. It may also label a development pair as available for **internal development calibration** when that exact source-pinned vulnerable/patched pair has one AI-assisted source review, a confirmed causal-patch validation, a protocol fingerprint, and no open conflict or high uncertainty. That label is not a readiness gate and cannot support provider selection, model-quality, pilot, or reliability claims. Synthetic and semantic-regression cases cannot inflate either result. `bun run eval:provider` is explicit, requires a configured provider, defaults to one diagnostic repeat, and writes ignored run artifacts under `evaluation/runs/`. Repeated experiments record the selected count and report agreement or distribution only when defined; no fixed repeat threshold creates a reliability claim. Compare two new like-for-like artifacts with `bun run eval:compare --baseline <run> --candidate <run>`; it rejects a comparison if exact corpus manifest, selected population, or benchmark protocol differs. Broader datasets require provenance, licensing, repository-level split controls, source-review adjudication, and an offline import review.

The checked-in `data/research-corpora/private-mixed-language-v1` pack provides six source-pinned vulnerable/patched semantic-regression pairs across C#, Go, PHP, Python, Ruby, and Rust. Run it only by explicit corpus path. It verifies language-neutral workflow and artifact behavior, never model quality or real-world reliability.

`bun run eval:candidates --registry <registry>` validates any metadata-only acquisition registry. With `--source <already-local-checkout>`, it checks every referenced metadata file against its pinned digest without downloading anything; OpenSSF records receive their additional field-level metadata check, while OSV records must bind the candidate to one exact adjacent Git `introduced`/`fixed` event pair. This checks provenance only—not a vulnerability label, category, source semantics, acquired-snapshot state, human adjudication, or answer key. Candidates are not corpus cases, are never mounted to an agent, and do not count toward readiness or a quality claim.

`bun run eval:acquisition` reports both metadata-ready and metadata-unavailable lanes. An unavailable lane carries one closed, machine-validated reason: it is an explicit evidence gap—its pinned source did not provide a complete locally verifiable record set—rather than an empty registry or a source of inferred candidates.

Evaluation profiles are mutually exclusive: `planning-generated` measures the generated audit plan only, `audit-reviewed-plan` measures audit execution against an evaluator-authored plan, and the default `end-to-end-generated` measures both stages. Profile identity is bound into every checkpoint, report, and baseline, so results from different profiles cannot be compared.

Path reachability is the immediate plan observation: it says whether enabled
vector scopes reach evaluator-declared relevant paths. It is not semantic plan
quality. That metric is available only from a completed
`single-ai-assisted-development-review` for the exact sealed generated plan;
missing or failed adjudication remains unavailable rather than becoming zero.

`bun run eval:stages` is deterministic lifecycle conformance, not a
provider-quality measurement. `bun run eval:stage-semantic` separately runs
one explicit evaluator-private stage pack after its product stage closes. Its
pack supplies evaluator-authored canonical predecessors and never passes answer
keys, semantic rubrics, or stage expectations into the product jail. The
semantic command requires explicit provider configuration and its output is
only an internal single-review diagnostic.

`data/stage-isolated/registry.json` prepares four source-pinned, non-qualifying
diagnostic packs for evidence mapping, candidate grounding, verification, and
planning speculation. Their prepared pack files contain canonical input bindings
and source-free rubrics—not a product output or projection. Validate them
offline before any model call; use the smallest unresolved stage pack first,
then inspect the source-free result of an actual isolated product-stage run.

For generated-plan profiles, the provider evaluation itself runs the AI-assisted, source-free semantic evaluator after each product trial closes. It receives only the sealed generated plan and evaluator semantic rubric; it never opens target source or exposes repository tools. The rubric excludes answer-key paths, expected-finding identifiers, source ranges, and other location data. Deterministic reachability and finding scoring retain those fields outside the evaluator call. Its checkpoint binds the exact run, trial, plan, target/context fingerprints, semantic-rubric digest, evaluator protocol, and route before it records semantic scenario recall and relevant-vector precision. It does not alter product audit results. A missing, incomplete, or cancelled measurement is retained on that trial as unavailable evidence; it is never converted to zero or treated as a completed evaluation.

`bun run eval:acquire -- --registry <registry> --candidate <id> --repository <local-git-repository> --output <directory>` copies one vulnerable/patched pair from an already-local Git object store into `data/acquisition/snapshots/`. It verifies the registry binding, exact revisions, every tracked regular-file mode, and every byte digest before atomically publishing the snapshot. It never fetches, runs, builds, labels, reviews, or mounts target source for a model. An acquired pair is provenance work for source-only curation, not an evaluation case or a readiness contribution.

`bun run eval:acquisition-snapshots` rechecks every checked-in acquisition workspace. It verifies the manifest, file modes, and every stored byte; rejects symlinks, unexpected workspace entries, and duplicate workspace identities; and prints only snapshot identifiers, file counts, and digests. It never reads an answer key, changes a candidate, imports a case, calls a provider, or opens a target through the audit jail.

`evaluation/data/curation/dossiers/` prepares every acquired pair before a paid provider run. A dossier binds an already-validated pair to independent advisory provenance, a source-only review question, and a paired-negative condition. It is never model input or an answer key. A `ready-for-key-authoring` dossier still requires a separate AI-assisted key, reviewed plan, and isolated corpus copy before it can be measured; `materialized` points only to that already-created separate case.
