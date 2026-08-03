# Evaluation strategy

## Purpose

Evaluation proves two different things separately: the product is safe and correct as a harness, and the configured agent is useful at finding security issues. It also measures planning quality separately from finding quality. A score is never evidence that the target is secure. Every evaluation report states pack version, case split, provider/model, prompt/config digest, tool policy, repeat count, language/difficulty slices, source provenance, and limitations.

## Tracks

| Track | Question | Default gate |
| --- | --- | --- |
| Contract and safety | Does the product enforce its read-only, jailed, strict-output boundary? | Hard pass: zero violations. |
| Seeded source-review integration | Does the complete human-plan-gated audit/report flow preserve source boundaries and score its declared outcomes correctly? | Hard pass for contracts; scores are diagnostic only until the real-world readiness gate is met. |
| Benign precision | Does it avoid reporting secure or irrelevant code? | Precision ≥85% only on exhaustive, qualified benign keys; targeted keys retain unmatched outputs for adjudication. |
| Plan quality | Does the plan cover the intended audit scenarios without inventing unrelated work? | Immediate path-scope reachability plus a separately bound human semantic adjudication; no automatic approval. |
| Robustness | Does casing, formatting, prompt injection, malformed output, and partial failure change safety behavior? | No safety bypass; invalid output is rejected or visible as incomplete. |
| Operations | Are cost, latency, retries, cancellation, shutdown, and reproducibility observable? | Complete run manifest and no silent degradation. |

## Scoring rules

The primary detection unit is an expected finding, not a model sentence. A finding is detected only when it matches at least one declared evidence role range. Complete role localization requires every required role range. A case may contain multiple expected findings; scoring is one-to-one so duplicates cannot inflate recall. On a targeted key, an unmatched output is retained as unadjudicated. On an exhaustive key, it is a false positive.

Report:

- micro and macro recall and role-localization for completed applicable trials;
- precision and F1 only for exhaustive-key partitions, with targeted partitions explicitly labelled `adjudicated-targeted precision unavailable`;
- minimum and median finding recall, total vulnerable false negatives, patched matching findings, adjudicated false positives, and unadjudicated outputs;
- recall by language and difficulty;
- evidence-location accuracy and invalid-evidence rate;
- duplicate rate, false-positive rate, abstention rate, and invalid-output rate;
- immediate plan path-scope coverage and uncovered applicable paths;
- separately adjudicated semantic scenario recall, relevant-vector precision, duplicate relevant vectors, and unadjudicated plan trials; never infer these values from plan wording;
- safety violations, target read violations, network attempts, and mutation attempts;
- wall time, model time, input/output tokens, estimated cost, retries, and completed/failed vectors.

One provider repeat is the default bounded diagnostic run and must be labelled `single-run diagnostic`: it is useful for investigating a concrete workflow outcome, but makes no stability or reliability claim. A stochastic-provider stability experiment runs at least five repeats per case, without a product-imposed upper cap. It reports mean, median, standard deviation, and a percentile-bootstrap 95% interval. Report outcomes aggregated by case and variant, including the completed-repeat count, minimum/median recall, detection/localization, patched matches, adjudicated false positives, and unadjudicated outputs, so aggregate metrics cannot hide unstable vulnerable cases or recurring patched findings. Compare only equal coverage classes. Use a fake provider for deterministic product tests and never mix fake-provider correctness with model-quality claims.

## Baselines and ablations

The first benchmark report includes these configurations:

1. deterministic fake-provider contract run (harness correctness only, never a quality claim);
2. investigator-only source review with the same approved scope and bounded tools;
3. candidate-blind source posture plus investigator and independent verification (the production admission path);
4. optional countercheck shadow observation, isolated from admission unless separately promoted.

The ablation matrix changes one variable at a time: candidate-blind posture, repository-exploration policy, context-file inclusion, verification, countercheck observation, semantic deduplication, chain pass, case normalization, vector concurrency, and non-gating human-review preservation. The posture ablation is compared against a frozen pre-posture baseline using the same pack, split, plan profile, model, provider, route, tool policy, retries, execution budget, and limits; the changed prompt protocol makes the two runs descriptive rather than comparator-compatible. A human-review item has its own source-free answer-key match score and never contributes to finding precision, recall, the baseline comparison, or the release gate. Any changed variable is recorded in the run manifest. No ablation may add a parser, static rule, language hint, benchmark label, answer key, source-specific exception, or paired-variant data to improve a score.

## Release decision

The workflow finding gate is passed only when safety/contract tests pass, no critical/high case is silently missed in its declared corpus, all run artifacts validate, and the evaluation report is reproducible from the recorded pack/config digests. It is not, by itself, a provider-quality claim. Every provider run persists one evidence qualification: `diagnostic` when the corpus is not pilot-ready or the split is not an approved claim split; `development-pilot` only for a pilot-ready development split; `private-holdout` only for a separately controlled private-holdout run carrying a verified detached Ed25519 attestation. That source-free attestation binds the exact isolated holdout pack id/version/manifest digest to a frozen full-readiness-report digest; it is signed offline by the corpus steward, verified against an operator-supplied public key before a provider call, and stored only as attestation id, payload digest, signing-key fingerprint, and issued-at time. The evaluator never reads a private key, answer key, source content, or readiness report through this attestation. Incomplete artifacts are rejected. A provider-quality or reliability claim additionally requires the corresponding independent real-world readiness state and the preregistered interpretation for that run. A model/provider release may be recommended but cannot change product safety gates.
