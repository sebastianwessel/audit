# Fixture authoring

Each case directory contains the target view plus a trusted `case.json` answer key. The evaluator must construct an agent-visible view that excludes the answer key before invoking the plan/audit workflow.

Required case properties:

- vulnerable/fixed or benign source files;
- expected evidence ranges, role expectations, and an adjudication note;
- provenance and license status, even for repository-authored fixtures;
- no live credentials, network calls, exploit execution, or destructive payloads.

Keep cases small enough to understand and large enough to test context boundaries. Prefer one primary weakness per case, then add multi-file cases for shared helpers, callers, and controls.
