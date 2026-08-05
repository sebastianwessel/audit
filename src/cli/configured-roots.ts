import {
  ensureSafeOutputRoot,
  type RootTopology,
  validateRootTopology,
} from '../platform/artifact-store/root-topology.js';
import type { RuntimeConfiguration } from '../platform/configuration/environment.js';

/** Prepares the configured private-work root for commands that do not open a target. */
export function prepareConfiguredPrivateWorkRoot(
  configuration: Pick<RuntimeConfiguration, 'privateWorkDirectory'>,
): Promise<string> {
  return ensureSafeOutputRoot(configuration.privateWorkDirectory);
}

/** Prepares the configured public-artifact root for source-free report commands. */
export function prepareConfiguredPublicArtifactRoot(
  configuration: Pick<RuntimeConfiguration, 'publicArtifactDirectory'>,
): Promise<string> {
  return ensureSafeOutputRoot(configuration.publicArtifactDirectory);
}

/**
 * Resolves target-facing roots from the single runtime configuration boundary,
 * then proves that they remain disjoint before target or artifact work starts.
 */
export async function prepareConfiguredProductRoots(input: {
  configuration: Pick<RuntimeConfiguration, 'privateWorkDirectory' | 'publicArtifactDirectory'>;
  targetRoot: string;
  contextRoot?: string;
}): Promise<RootTopology> {
  const initial = await validateRootTopology({
    targetRoot: input.targetRoot,
    contextRoot: input.contextRoot,
    publicArtifactRoot: input.configuration.publicArtifactDirectory,
    privateWorkRoot: input.configuration.privateWorkDirectory,
  });
  await ensureSafeOutputRoot(initial.publicArtifactRoot);
  await ensureSafeOutputRoot(initial.privateWorkRoot);
  return validateRootTopology({
    targetRoot: initial.targetRoot,
    contextRoot: initial.contextRoot,
    publicArtifactRoot: initial.publicArtifactRoot,
    privateWorkRoot: initial.privateWorkRoot,
  });
}
