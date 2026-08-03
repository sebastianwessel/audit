# Untrusted evidence-map fact quarantine

Status: implementation refactor authorized after the `gpt-5.6-terra` same-route diagnostic exposed repeated evidence-map output validation failures. This is a generic contract-boundary repair. It introduces no detector, parser, language-specific behavior, benchmark exception, answer-key input, or relaxed persisted evidence rule.

## Problem and decision

The persisted evidence-map contract is intentionally strict: every retained fact has a recognized role, canonical source evidence, a unique identifier, and exact approved-plan references. The model-facing map was incorrectly derived from that final contract. A single malformed or out-of-plan model fact therefore failed the whole model response before the existing fact verifier could quarantine it. That contradicted the documented per-fact integrity behavior and discarded independent valid facts.

CAP-082 separates the two boundaries:

1. The model-facing envelope remains closed and bounded, but carries only untrusted primitive fact fields and source pointers.
2. `audit-execution/evidence-map/verify` is the sole projector. It validates each fact's identifier, recognized fact role, bounded statement, exact approved-plan binding, unique retained identity, target path, and source line.
3. A bad fact is counted as rejected; it cannot affect another fact, become a limitation, expand scope, or persist any model-authored path, line, snippet, kind, or evidence role.
4. Canonical evidence is reconstructed from the scoped source. Its kind follows the source document, its range is the validated line, and no model-supplied evidence role survives.

This permits strict canonical reports and checkpoints while making the model-output boundary robust to independent local defects. It does not infer security semantics, repair a claim, reinterpret an invalid plan reference, or turn an incomplete map into clean coverage.

## Recovery and compatibility

The existing verified-map draft is the recovery boundary. This change increments the map-contract and whole-workflow protocol fingerprints, so older map drafts, terminal audit results, and provider-evaluation artifacts are not reused or compared as though their model-output boundary were the same. The persisted evidence-map and report shapes do not change because only their predecessor is corrected.

Provider diagnostics retain only counts and normalized validation error codes. They must not retain raw model output, rejected source pointers, source text, prompts, or tool transcripts. A rejected fact contributes to existing map/rejection coverage and may leave an approved obligation visibly unanswered or incomplete.

## Acceptance

1. A model envelope with one invalid fact role, invalid plan reference, source pointer, duplicate retained identifier, or invalid evidence token retains independent valid facts and increments the rejected-fact count.
2. No invalid model role, source kind, source path, source line, source snippet, or plan reference can appear in a persisted fact.
3. All retained facts still pass the original strict `EvidenceMapSchema` and exact approved-plan/source checks.
4. Unknown-language files use the same projection path; no parser or filename rule is introduced.
5. Evidence-map, recovery, audit, privacy, report, schema-artifact, and full local verification suites pass before a repeat provider measurement.

## Measurement record

The repaired protocol was measured on `security-reviewer-real-world-seed@0.2.1`, development split, reviewed-plan profile, tool-assisted evidence, same-route verification, serial vectors, default retry, and five repetitions per variant. Both runs completed all 30 trials with no model-stage contract failure.

| Model | Estimated cost | True positives | False positives | False negatives | Recall median | p95 latency |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `openai/gpt-5.3-codex` | $1.542857 | 11 | 4 | 9 | 1.000 | 35.624 s |
| `openai/gpt-5.6-terra` | $1.617611 | 4 | 6 | 16 | 0.000 | 56.777 s |

The strict `primary-model-experiment` comparison is comparable and attributes only the primary same-route model difference. Terra is not adopted: it costs $0.074754 more, has seven fewer true positives, two more false positives, seven more false negatives, and 21.153 seconds higher p95 latency on this diagnostic seed. The model-output quarantine remains adopted because it removed the previously observed whole-map validation failure without accepting invalid canonical evidence. Neither run is a provider-quality claim: this corpus remains diagnostic-only until the dual-reviewed, repository-disjoint corpus gate is met.
