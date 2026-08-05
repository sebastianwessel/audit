# Source-review adjudication for real-world cases

Real-world evaluation cases measure the reviewer against source code that existed
in a real project. They need more care than a small regression fixture: an
advisory, dataset label, or fixing commit is useful evidence, but it is not the
final answer key.

## Diagnostic and reliability evidence

One traceable AI-assisted, source-only review can create a targeted answer key
for a single internal diagnostic run. It is useful for finding weaknesses in
the workflow, but cannot support general precision, provider selection,
external reliability, or a readiness gate.

## Internal development calibration

An AI-assisted review can additionally make one exact development pair available
for **internal development calibration**. This is deliberately narrower than a
pilot or reliability claim. The evaluator requires all of the following:

- A real-world vulnerable/patched pair with distinct pinned revisions and
  validated snapshot checksums.
- The normal matching AI-assisted source-only review and a patched expectation
  of no matching finding.
- A recorded causal-patch validation: who checked it, when, the protocol
  fingerprint, and a concise source-only note that the patch addresses the
  reviewed condition.
- An explicit uncertainty and conflict state. High uncertainty or an open
  conflict keeps the case diagnostic.

The resulting `development-calibration` label means only that this exact
source-pinned pair is suitable for improving the local workflow. It is not a
model score, a general recall or precision result, provider-selection evidence,
independent validation, or a readiness gate. It never makes the corpus pilot
or reliability ready.

Two independent human source reviews are the stronger route for a pilot or
reliability claim. They do not replace the separate semantic plan evaluator:
that evaluator runs after product work closes, sees only the sealed generated
plan and a source-free rubric, and is always diagnostic evidence.

## What independent reviewers do

Each reviewer works independently from the vulnerable and patched source snapshots. They record a decision to include or exclude the candidate, then capture only what a static source review can fairly establish.

| Review item | What to confirm |
| --- | --- |
| Pair integrity | Both revisions are from the same project lineage and their checksums match the recorded snapshots. |
| Source-only suitability | The concern can be assessed from source and approved optional context; it does not require running the application or an exploit. |
| Expected plan scenario | Explicit expected-finding ids and the relevant paths a useful human review should cover. |
| Expected finding | Scoped operation and unsafe-condition source locations for the vulnerable revision. |
| Patched negative | Whether the repaired revision should have no matching finding. |
| Evidence boundary | Why the listed source locations support the judgment, plus relevant limitations. |

The two reviews remain separate evaluator records. They are never shown to an
audit model and are not used to build prompts, rules, or patches. An
AI-generated audit result, including an item in the human-review queue, is
never a source-review record.

## Resolve disagreements

If the reviews disagree, preserve both records. A resolver can add a separate decision and rationale after reading the evidence. Do not edit either original review to make them appear to agree.

A case becomes dual-reviewed only when it has two distinct human `include`
records that agree with the exact final plan scenarios, at least one vulnerable
finding, patched-negative expectation, and source-only applicability. A
scenario has a stable id, explicit expected-finding ids, and one-or-more
relevant paths; every id must correspond to an expected finding on one of those
paths. A paired case must explicitly expect no matching finding after the
patch. Review order, dates, and notes may differ. An AI-assisted key remains a
diagnostic case, and a provisional case can help organize acquisition work;
neither can count toward a pilot, a reliability gate, or a published provider
result.

## Keep the holdout genuinely unseen

Choose the project-level split before either reviewer writes an answer key. Keep every vulnerable/patched pair from one repository in that one split. A `private-holdout` pack lives in a physically separate, steward-controlled location and remains unavailable to people tuning prompts, policies, or implementation from development measurements. It must not be run through a provider until its answer keys are frozen and the development change is complete.

Before a private-holdout provider run, the corpus steward signs a small detached attestation offline. It contains no source or answer keys: only the holdout pack identity and checksum plus the checksum of the already-frozen readiness decision. The operator supplies that attestation and the steward’s public key to the evaluator. The evaluator verifies both before it calls a provider, records only non-sensitive identifiers and digests with the result, and never reads a private signing key.

Reviewers work from the same locally verified source snapshots, but independently: neither reviewer sees the other review, proposed answer key, provider output, or a previous evaluation report before recording their judgment. Record the exact source license decision and immutable revision with the review. A source lead from an advisory or benchmark remains provisional until that local verification and both reviews are complete.

## Safely add a local pack

1. Collect source snapshots outside the product and record upstream URL, immutable revision, license, attribution, retrieval date, and checksum.
2. Assign the repository-level development, test, or private-holdout split before adjudication. Keep source views, answer keys, reviewed plans, and acquisition notes in separate directories. Put the private-holdout pack outside the development/test corpus location.
3. For a diagnostic key, complete one traceable AI-assisted source-only review.
   To make that exact pair available for internal development calibration, add
   the causal-patch, protocol, uncertainty, and conflict record described
   above. For a readiness claim, complete the independent human reviews and,
   if needed, a resolver record. A resolver records disagreement but cannot
   promote it.
4. Import the local pack with the offline importer.
5. Run the readiness report before running a provider evaluation. Do not use a provisional lead or a human-review queue item as ground truth.

The importer never downloads, executes, builds, or modifies a reviewed project.
The readiness report deliberately shows diagnostic and provisional progress
separately from the dual-reviewed evidence that can support a claim.

## What does not qualify

- A benchmark’s original label without independent source review.
- A fixing patch used as the answer key by itself.
- A case selected because the current model succeeds on it.
- A result that depends on target execution, a network call, or a proof of exploitability.
- A model-generated review presented as a human adjudication.
- An AI-assisted calibration label presented as a model-quality, provider-selection,
  pilot, or reliability result.
