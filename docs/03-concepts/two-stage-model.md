# The two-stage model

Many security tools start analysing immediately. Security Reviewer starts with a conversation about scope.

## Stage 1: make the plan

The planner first reads or searches the supplied repository through its read-only file tools, then uses the inventory and selected context to propose attack vectors such as authorization gaps, injection paths, secret exposure, or unsafe deserialization. It can inspect any eligible text source file, including an unfamiliar language or extension; it never executes the code. Each vector explains:

- what part of the code is in scope;
- why it might matter;
- what evidence to look for;
- what would count as a meaningful result;
- what the review may not be able to prove.

The output is an editable executable plan. It may also contain separate additional observations for human review. Those are suggestions to consider for a later plan change, not findings and not hidden extra audit work. It is not a vulnerability report.

## Stage 2: run the supplied plan

The auditor investigates enabled vectors independently, using the configured concurrency. For each vector it first maps neutral source facts, relevant controls, unanswered questions, and limitations inside the plan’s file scope. Only then can it form a map-bound hypothesis and have a verifier challenge it. Each model stage receives the same complete plan-scoped path manifest and read-only file tools; the tool does not use a hidden language-specific detector to decide where a vulnerability exists.

Before a result becomes a finding, the reviewer verifies that its vector, file, line, and persisted excerpt all match the plan-scoped evidence. The finding also identifies which plan-owned review obligations it answers; the independent verifier must confirm that link as well as identify both a security-relevant operation and why it is unsafe from its own scoped source inspection. The operation must be the statement that actually performs the relevant action—not merely a nearby lookup, declaration, or setup step. A single keyword or API name is not enough. Invalid, contradicted, or out-of-scope suggestions are visible as incomplete evidence; they are not quietly promoted into the report. If inspected evidence shows a business-level check does not apply, it is marked not applicable with a crisp reason; that is neutral, not a passed check or finding.

~~~mermaid
sequenceDiagram
  participant O as Operator
  participant P as Planner
  participant H as Human reviewer
  participant A as Auditor
  O->>P: target + context
  P-->>O: editable plan
  O->>H: review and edit
  H-->>A: edited plan (optional)
  A->>A: scope, map facts, investigate, and independently verify scoped evidence
  A-->>O: confirmed claims and limitations
~~~

## Plan review is external

The plan is an ordinary artifact that can be reviewed, stored, edited, approved, and compared in your organization’s own workflow. Security Reviewer deliberately does not store or enforce that approval state. It executes a strict plan only when its target and context fingerprints match the current audit input.
