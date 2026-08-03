# Evaluator terminal telemetry preservation

Date: 2026-07-31

## Decision

Evaluation trials retain every completed source-free model-stage observation and any returned source-free audit projection when a later evaluator operation fails.

## Contract

- A failed or cancelled trial is always score-ineligible, but it does not erase planning or audit observations already reached.
- `modelObservation: null` means no model stage was reached before the terminal error; it is not a fallback for a later persistence, projection, or scoring failure.
- Existing source-free vector coverage, candidate funnels, and finding keys are retained when the audit already returned. Prompts, source, tool payloads, raw output, answer keys, and credentials remain absent.

## Verification

A fake-provider runner regression completes generated planning, forces evaluator planning-checkpoint persistence to fail, and asserts that the failed trials retain only their completed planning observations with null scores.
