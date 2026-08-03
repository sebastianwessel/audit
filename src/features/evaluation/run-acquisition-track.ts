import {
  loadRealWorldAcquisitionTrack,
  validateRealWorldAcquisitionTrack,
} from './acquisition-track.js';

try {
  const track = await loadRealWorldAcquisitionTrack(
    'evaluation/acquisition/real-world-multilingual-v1.json',
  );
  const summary = await validateRealWorldAcquisitionTrack({ track, repositoryRoot: process.cwd() });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unexpected acquisition track failure.';
  process.stderr.write(`security-reviewer acquisition: ${message}\n`);
  process.exitCode = 2;
}
