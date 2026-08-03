# Decamelize observed-output adjudication

Status: internal, source-only, AI-assisted development evidence. This record
does not upgrade the corpus case to exhaustive coverage, dual review, or a
provider-quality claim.

## Confirmed expected issue

The vulnerable variant interpolates `sep` directly into `new RegExp(...)`.
This matches CVE-2017-16023: an unescaped separator can create a
denial-of-service condition. The patched variant passes `sep` through
`escape-string-regexp` before construction, so it has no matching finding.

## Extra outputs from `limit-removal-generated-20260803`

The run produced three patched-variant outputs outside the targeted expected
finding. They are all plan-scoped, independently verifier-accepted model
claims, but they are not security findings supported by this source pair:

| Output theme | Decision | Reason |
| --- | --- | --- |
| Normal input-size processing | Not a security finding | The static source shows ordinary linear string replacement. It does not establish attacker-reachable superlinear work, catastrophic backtracking, or a resource-exhaustion boundary. |
| Non-string separator behavior | Not a security finding | The source pair does not establish that the optional separator accepts arbitrary types or that a resulting exception crosses an attacker-controlled security boundary. |
| Exception propagation | Duplicate non-security concern | It is the same unsupported type/error-path concern, not a distinct data-protection, authorization, injection, or availability issue. |

The vulnerable run also emitted an additional regex-runtime-cost formulation at
the same construction. It describes the already-labelled CVE root cause rather
than a second independent issue.

## Evaluation consequence

The answer key remains `targeted`. The observed outputs must remain
`unadjudicated` in generic metrics: this single source pair does not establish
exhaustive negative coverage for every possible model claim. This record is
development feedback for prompt and plan-noise reduction, not a mechanism to
turn a favourable one-off outcome into precision.

## Follow-up evaluation after plan v3

The one-repeat generated-plan run `additional-observations-terra-20260803`
used the pinned pair with `openai/gpt-5.6-terra`. It spent `$0.282983` across
32 model calls. The vulnerable variant completed and matched the expected CVE,
although one expected evidence role was mislocalized. The patched variant was
marked `incomplete`, not clean: its generated plan contained two speculative
executable vectors and their investigator closures did not close every
obligation.

This does **not** change the targeted answer key or create a precision claim.
It identifies a planning-quality issue: speculative or adjacent concerns must
be routed to the separate human-review observation channel rather than become
automatic audit work. The planning contract and regression test now enforce
that generic distinction. The attempted `openai/gpt-5.3-codex` run returned no
model response and has no cost observation, so it is provider-availability
evidence only, not a model comparison.
