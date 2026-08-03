# Source layout

Use capability-owned vertical slices. A feature owns its schema, pure logic, application use case, and colocated unit tests. Platform code implements external boundaries; shared code is restricted to true cross-feature primitives.

```text
src/
  shared/      cross-feature contracts, errors, and observability only
  features/    target-inventory, attack-planning, audit-execution, audit-report, evaluation
  platform/    configuration, filesystem, harness, artifact-store adapters
  cli/         command parsing and process exit mapping
```

The application has two target-side evidence classes: repository source and optional, explicitly allowlisted Markdown/frontmatter context. The context loader belongs to target-inventory because it validates and digests input; the evaluation feature has its own isolated fixture/answer-key boundary.
