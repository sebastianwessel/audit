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
