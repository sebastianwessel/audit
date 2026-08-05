import { readFile } from 'node:fs/promises';

type PackageScripts = Readonly<Record<string, string>>;

type PackageManifest = Readonly<{
  packageManager?: string;
  scripts?: PackageScripts;
}>;

const literalBunRunPattern = /^\s*(?:-\s*)?run:\s*bun run ([a-zA-Z0-9:_-]+)(?:\s|$)/gmu;
const dynamicBunRunPattern = /^\s*(?:-\s*)?run:\s*bun run \S+/gmu;
const bunPackageManagerPattern = /^bun@(?<version>\d+\.\d+\.\d+)$/u;

export function assertWorkflowBunVersion(
  workflow: string,
  packageManager: string | undefined,
  workflowPath = '.github/workflows/ci.yml',
): void {
  const version = bunPackageManagerPattern.exec(packageManager ?? '')?.groups?.version;
  if (version === undefined) {
    throw new Error('package.json must declare an exact Bun packageManager version.');
  }
  const escapedVersion = version.replaceAll('.', '\\.');
  const workflowVersionPattern = new RegExp(
    `\\bbun-version:\\s*['"]?${escapedVersion}['"]?\\s*$`,
    'mu',
  );
  if (!workflowVersionPattern.test(workflow)) {
    throw new Error(`${workflowPath} must install Bun ${version} from package.json.`);
  }
}

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
  const parsedPackage = JSON.parse(packageJson) as PackageManifest;
  const scripts = parsedPackage.scripts ?? {};
  assertWorkflowBunScripts(ciWorkflow, scripts, '.github/workflows/ci.yml');
  assertWorkflowBunScripts(releaseWorkflow, scripts, '.github/workflows/release.yml');
  assertWorkflowBunVersion(ciWorkflow, parsedPackage.packageManager, '.github/workflows/ci.yml');
  assertWorkflowBunVersion(
    releaseWorkflow,
    parsedPackage.packageManager,
    '.github/workflows/release.yml',
  );
  process.stdout.write('Workflow Bun script references are valid.\n');
}
