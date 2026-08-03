import { runFixtureEvaluation } from './runner.js';

const result = await runFixtureEvaluation();
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
// This provider-free command proves harness isolation and schema wiring only.
// Its intentionally blank semantic responder leaves gatePassed false; that is
// reported data, not a command failure. Safety violations remain hard failures.
if (result.safetyViolations > 0) process.exitCode = 1;
