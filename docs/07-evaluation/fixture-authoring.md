# Fixture authoring

Fixtures are small, safe code samples with a reviewed expected outcome. Include a vulnerable/fixed pair, a benign control where useful, operation and unsafe-condition evidence ranges, and provenance/license information.

The checked-in deterministic fixture track spans several language labels. It proves runner, isolation, and scoring behavior without claiming an AI provider's semantic reasoning or static detection quality. Keep fixtures language-diverse and include unknown-extension evidence to verify that language metadata never excludes source evidence.

The evaluator keeps the answer key outside the agent-visible target. This prevents the agent from succeeding by reading labels instead of analyzing code. Do not add credentials, live endpoints, destructive payloads, or instructions that require target execution.

Public benchmark content can be present in model training data. Keep repository-level splits clean and maintain a private synthetic holdout for release confidence.
