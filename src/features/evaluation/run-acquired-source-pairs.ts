import { validateAcquiredSourcePairCollection } from './source-pair-acquisition.js';

try {
  const summary = await validateAcquiredSourcePairCollection('evaluation/acquisition-snapshots');
  process.stdout.write(`${JSON.stringify(summary)}\n`);
} catch (error) {
  const message =
    error instanceof Error ? error.message : 'Unexpected source-pair validation failure.';
  process.stderr.write(`security-reviewer acquisition snapshots: ${message}\n`);
  process.exitCode = 2;
}
