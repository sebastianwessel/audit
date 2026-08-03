import { importCorpusPack } from './importer.js';

function option(argv: readonly string[], name: string): string {
  const index = argv.indexOf(name);
  const value = index < 0 ? undefined : argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new TypeError(
      `Missing ${name}. Usage: bun run eval:import --source <directory> --output <directory>`,
    );
  }
  return value;
}

const imported = await importCorpusPack({
  sourceRoot: option(Bun.argv.slice(2), '--source'),
  outputRoot: option(Bun.argv.slice(2), '--output'),
  importedAt: new Date().toISOString(),
});
process.stdout.write(
  `Imported ${imported.packId}@${imported.packVersion} with ${imported.content.length} files.\n`,
);
