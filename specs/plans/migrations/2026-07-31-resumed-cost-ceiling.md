# Resumed cost-ceiling integrity

Date: 2026-07-31

## Decision

An exact generated-plan checkpoint contributes its observed source-free stage cost to the existing shared evaluator cost guard before resumed audit work begins.

## Contract

- Exact persisted model-stage observations are registered once by content-free structural identity.
- A matching trial wrapper cannot double count that same stage.
- An orphaned plan checkpoint is not free: a configured observed-cost ceiling sees it before the next dispatch.

## Verification

The model-operations unit test registers one checkpointed stage twice and proves it counts once and blocks the next request at the configured ceiling.
