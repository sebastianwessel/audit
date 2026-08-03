import {
  loadCandidateRegistry,
  verifyCandidateMetadataSource,
  verifyCweBenchJavaCandidateSource,
  verifyOpenSsfCandidateSource,
  verifyOsvCandidateSource,
} from './candidate-registry.js';

function option(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--'))
    throw new TypeError(`Missing value for ${name}.`);
  return value;
}

try {
  const argv = Bun.argv.slice(2);
  const registryPath =
    option(argv, '--registry') ?? 'evaluation/candidates/openssf-candidate-pilot.json';
  const registry = await loadCandidateRegistry(registryPath);
  const source = option(argv, '--source');
  if (source === undefined) {
    process.stdout.write(
      `Validated ${registry.registryId} with ${registry.candidates.length} metadata-only candidates.\n`,
    );
  } else {
    const result =
      registry.source.datasetId === 'openssf-cve-benchmark'
        ? await verifyOpenSsfCandidateSource({ registry, sourceRoot: source })
        : registry.source.datasetId === 'cwe-bench-java'
          ? await verifyCweBenchJavaCandidateSource({ registry, sourceRoot: source })
          : registry.source.datasetId === 'osv-api'
            ? await verifyOsvCandidateSource({ registry, sourceRoot: source })
            : await verifyCandidateMetadataSource({ registry, sourceRoot: source });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
} catch (error) {
  const message =
    error instanceof Error ? error.message : 'Unexpected candidate validation failure.';
  process.stderr.write(`security-reviewer candidates: ${message}\n`);
  process.exitCode = 2;
}
