# Plan authoring protocol

## Editable surface

An `AttackPlanDraft` contains `schemaVersion`, `basePlanId`, `basePlanDigest`, and `vectors`. Only vector content is editable. A vector contains:

- `title`: clear review focus;
- `rationale`: why this bounded review matters;
- `enabled`: whether the vector executes;
- `scopeGlobs`: exact source paths the later audit may inspect;
- `reviewObligations`: stable IDs, risk-positive statements, and required source evidence;
- `limitations`: known static-review limits.

## Required outcomes

- A valid changed draft reseals to a different plan ID and writes both JSON and Markdown.
- A malformed draft, a draft linked to another base plan, or an unchanged draft fails without replacing the base plan.
- A plan change never records approval. Executing the new valid plan remains the product's approval signal.

## Refuse or stop

Stop and request a new plan run when the change needs a different target, context package, or inventory. Stop when a request asks to add a finding, priority, remediation, source evidence, runtime test, attack action, provider call, target execution, or an unbounded scope. Those are not plan-authoring actions.
