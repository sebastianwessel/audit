import { readFile } from 'node:fs/promises';

type PackageScripts = Readonly<Record<string, string>>;

const literalBunRunPattern = /^\s*(?:-\s*)?run:\s*bun run ([a-zA-Z0-9:_-]+)(?:\s|$)/gmu;
const dynamicBunRunPattern = /^\s*(?:-\s*)?run:\s*bun run \S+/gmu;

export function assertWorkflowBunScripts(
  workflow: string,
  scripts: PackageScripts,
  workflowPath = '.github/workflows/ci.yml',
): void {
  const literalCommands = [...workflow.matchAll(literalBunRunPattern)];
  const allBunRuns = [...workflow.matchAll(dynamicBunRunPattern)];
  if (literalCommands.length !== allBunRuns.length) {
    throw new Error(
      `${workflowPath} contains a non-literal bun run command; declare a literal package script instead.`,
    );
  }
  for (const match of literalCommands) {
    const scriptName = match[1];
    if (scriptName === undefined || scripts[scriptName] === undefined) {
      throw new Error(
        `${workflowPath} references missing package script: ${scriptName ?? '<unknown>'}.`,
      );
    }
  }
}

if (import.meta.main) {
  const [ciWorkflow, releaseWorkflow, packageJson] = await Promise.all([
    readFile('.github/workflows/ci.yml', 'utf8'),
    readFile('.github/workflows/release.yml', 'utf8'),
    readFile('package.json', 'utf8'),
  ]);
  const parsedPackage = JSON.parse(packageJson) as { scripts?: PackageScripts };
  const scripts = parsedPackage.scripts ?? {};
  assertWorkflowBunScripts(ciWorkflow, scripts, '.github/workflows/ci.yml');
  assertWorkflowBunScripts(releaseWorkflow, scripts, '.github/workflows/release.yml');
  process.stdout.write('Workflow Bun script references are valid.\n');
}
