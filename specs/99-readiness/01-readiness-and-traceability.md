# Readiness and traceability

## Approval

auto-approved on 2026-07-28 at the user's explicit request. The separate readiness approval step is skipped for this bootstrap; implementation verification and future material review remain required. This is a workflow exception, not evidence that implementation is complete.

## Checklist walk

~~~yaml
checklist_walk:
  status: passed
  approval: auto-approved-by-user
  blocking_findings_count: 0
  topics:
    core: covered
    end_to_end: covered
    architecture_structure: covered
    contracts_generation: covered
    security_abuse: covered
    ai_ml_automation: covered
    testing_verification: covered
    dependencies_research: covered
    evaluation_data_and_metrics: covered
    runtime_platform: covered
    operations_release: covered
    frontend_ux: not_applicable
    persistence_database: not_applicable
    remote_integrations: not_applicable
~~~

## Traceability

| Requirement | Source | Contract | Owner | Verification |
| --- | --- | --- | --- | --- |
| REQ-001 Two-stage editable-plan workflow | product | sealed plan/vector/report | workflows | CAP-004, CAP-102 |
| REQ-002 Read-only/no-network | security | tool/runtime config | filesystem/harness | REQ-001, REQ-004, REQ-009 |
| REQ-003 Single schema source | contracts | schema registry | contracts | REQ-003, drift check |
| REQ-004 Restricted evidence | architecture/security | read/list/grep tools | filesystem | REQ-004 |
| REQ-005 Strict normalized boundary tokens | product/contracts | finding/report | auditing/reporting | REQ-006, REQ-007 |
| REQ-006 CI reporting | product/quality | report/run | CLI/reports | REQ-007, REQ-008 |
| REQ-007 Optional providers/lifecycle | architecture/research | runtime config | harness adapter | REQ-010, CAP-014 |
| REQ-008 Evaluation safety and answer-key isolation | evaluation/security | evaluation contracts | evaluation feature | REQ-012, REQ-015 |
| REQ-009 Detection quality and reproducibility | evaluation/quality | evaluation run | evaluation feature | REQ-013, REQ-014, CAP-022 |
| REQ-010 Fixture provenance | evaluation/data | case/pack manifest | evaluation feature | REQ-016, CAP-025 |
| REQ-017 Context semantics and digest binding | product/security/contracts | context package and plan digest | target inventory/planning | REQ-017, CAP-003 |
| REQ-018 Scoped complete vector investigation | product/architecture/contracts | snapshot-backed vector coverage and investigation request | audit execution | CAP-031, CAP-032, CAP-101, CAP-103 |
| REQ-019 Verified model evidence only | product/security/contracts | finding verification record | audit execution | CAP-033, scope/evidence rejection tests |
| REQ-020 Deterministic integrity and chain synthesis | architecture/quality | integrity, finding, and chain contracts | audit execution | CAP-031, CAP-034, synthesis tests |
| REQ-021/022 Content-free model cost accounting and provider cache routing | architecture/contracts/quality | model observation and run manifest | model operations | CAP-035, schema drift and stage aggregation tests |
| REQ-023 Per-stage model attribution | architecture/contracts/quality | planning/investigation stage ledger and vector coverage | model operations/review workflow | CAP-035, service/evaluation report tests |
| REQ-046 Independent verifier experiment | independent verifier diversity/security/quality | evaluation-only route configuration, checkpoint fingerprint, and stage route token | configuration/harness/model operations | CAP-063 configuration, route, checkpoint, telemetry, and comparison tests; promotion blocked by qualified corpus |
| REQ-049–054 Immutable boundary and terminal truth | product/architecture/contracts/security/quality | root topology, snapshot, sealed plan, exact checkpoint, terminal reducer, lease | target inventory/artifact store/audit execution | CAP-100–105 and Wave 1 verification matrix |

Known assumptions: v1 is a CLI/file-artifact product; provider traffic is opt-in and separate from target tools; the operator is authorized; humans may edit strict JSON plans externally before validation/resealing and execution. A future UI/API requires a new specification. Language-specific parser and fact-pipeline experiments were removed rather than retained as evaluator shortcuts; all provider quality evidence uses the same language-neutral source-review path as the product.

CAP-063 is implemented only as an opt-in provider-evaluation route. Production promotion still requires an independently readiness-qualified real-world corpus; the current seed and metadata-only candidate registry are insufficient by design.

## Self-audit

The current v1 is static and intentionally does not claim dynamic exploit proof, runtime reachability proof, remote dependency enrichment, patch application, or complete language coverage. Those are explicit non-goals. Audit work is decomposed into snapshot-bound source preparation, complete scoped model investigation, independent source verification, deterministic synthesis, and redacted artifact projection. Provider-quality evidence remains separate from fake-provider and deterministic-corpus wiring evidence.
