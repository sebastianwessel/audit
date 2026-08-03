# Candidate-blind contradiction barrier

The five-repeat `plan-obligation-reconciliation-reviewed-20260730` diagnostic completed all 30 trials but still admitted 24 of 30 model candidates, with zero verifier rejections, six vulnerable false negatives, and eight patched/benign false positives. Exact evidence provenance alone therefore did not prevent a candidate-aware verifier from confirming a claim against earlier candidate-blind source review.

CAP-077 makes a validated, tool-inspected candidate-blind `contradicted` conclusion an admission barrier for every later hypothesis using that evidence question. Later candidate-aware stages may still investigate an `inconclusive` conclusion and may never treat `supported` as proof. The boundary consumes the prior scoped model judgment only; it adds no parser, language condition, static rule, source-specific exception, benchmark label, answer-key signal, alternate model, or real-world attack capability. The admission funnel records a blocked accepted verdict as a verifier-evidence rejection.

The evaluator protocol fingerprint changes. The next five-repeat measurement is descriptive until a qualified repository-disjoint corpus and holdout make a pre-registered comparison possible.

Superseded by `2026-07-30-contested-review-queue.md`: the completed comparable measurement reduced false positives from 10 to 5 but reduced true positives from 14 to 11. The barrier is therefore not retained as product admission behavior.
