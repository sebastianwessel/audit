# AI-assisted source-only calibration protocol v1

This protocol governs the internal development-calibration record for this
local, pinned source pair. It is not an independent human review, a
reliability study, or a model-selection procedure.

1. Review the pinned vulnerable and patched source trees without running either
   target, contacting a service, or using an upstream label as the answer key.
2. State one source-only risk condition and map each expected evidence role to
   an exact line range in the vulnerable tree.
3. Independently inspect the patch and confirm whether it removes that same
   source-level condition. Record `confirmed`, `inconclusive`, or
   `not-confirmed`; do not infer runtime exploitability.
4. Record whether any unresolved source disagreement remains and state the
   calibration uncertainty. A high uncertainty or open conflict is not eligible
   for development calibration.
5. Keep the result targeted: outputs outside the labelled source condition stay
   unadjudicated and cannot become precision evidence.

The answer key stores only this protocol's SHA-256 fingerprint and a concise
source-only validation record. This document and the answer key remain
evaluator-only; neither is mounted into an audited target or model prompt.
