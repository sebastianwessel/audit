# Reviewing a plan

Treat the plan as a short security test proposal.

| Question | Action |
| --- | --- |
| Is this area part of the product? | Narrow or remove the vector if not. |
| Is the scope specific enough? | Add paths or patterns rather than “check everything”. |
| Is the risk statement answerable from source? | Rewrite it if it needs runtime traffic or secrets. |
| Is the review focus understandable? | Rename it so a reviewer can understand the question without treating it as a category or severity. |
| Would a missed check be costly? | Enable it and add a clear evidence requirement. |
| Is the limitation honest? | Keep the limitation visible. |

Your organization may review, edit, or record approval externally. Security Reviewer does not model that workflow: it executes the supplied plan when it matches the current target and optional context.

Use the paired Markdown plan as the review document. To make an agreed change, create a JSON draft with `plan-draft`, edit the vector content, then use `plan-reseal` to publish a new immutable JSON/Markdown pair. The draft cannot change the target, context, or inventory binding. Do not edit a sealed plan JSON directly, and do not substitute YAML or Markdown for the executable JSON plan.

Large generic plans create noise. Short project-specific context is more valuable when it names a few authentication helpers, middleware paths, trust boundaries, or sensitive data flows.
