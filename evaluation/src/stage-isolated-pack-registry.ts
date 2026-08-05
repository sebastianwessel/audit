import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { reviewWorkflowPromptProtocolFingerprint } from '../../src/features/review-workflow/prompt-protocol.js';
import { AuditRuntimeError } from '../../src/shared/errors/audit-runtime-error.js';
import { loadCorpusPack } from './corpus.js';
import { buildStageIsolatedCanonicalInput } from './stage-isolated.js';
import { stageIsolatedAdjudicationAgentProtocolFingerprint } from './stage-isolated-adjudication-agent.instructions.js';
import { prepareStageIsolatedCanonicalFixture } from './stage-isolated-canonical-fixture.js';
import {
  type StageIsolatedDiagnosticPackRegistry,
  StageIsolatedDiagnosticPackRegistrySchema,
} from './stage-isolated-diagnostic-pack.schema.js';
import { stageIsolatedDiagnosticStageProtocolFingerprint } from './stage-isolated-protocol.js';
import {
  type StageIsolatedPreparedDiagnosticPack,
  StageIsolatedPreparedDiagnosticPackSchema,
} from './stage-semantic-pack.schema.js';

/** Loads four source-pinned, evaluator-private packs from the evaluator data root. */
export async function loadStageIsolatedDiagnosticPackRegistry(
  dataRoot: string,
): Promise<StageIsolatedDiagnosticPackRegistry> {
  const root = resolve(dataRoot);
  const registry = StageIsolatedDiagnosticPackRegistrySchema.parse(
    JSON.parse(
      await readFile(
        resolveStageIsolatedDiagnosticPath(root, 'stage-isolated/registry.json'),
        'utf8',
      ),
    ),
  );
  for (const descriptor of registry.packs) {
    const [corpus, preparedPack] = await Promise.all([
      loadCorpusPack(resolveStageIsolatedDiagnosticPath(root, descriptor.corpusRoot)),
      readPreparedPack(
        resolveStageIsolatedDiagnosticPath(root, `stage-isolated/${descriptor.semanticPackPath}`),
      ),
    ]);
    const loadedCase = corpus.cases.find((entry) => entry.case.caseId === descriptor.caseId);
    const digest = loadedCase?.case.sourceDigests[descriptor.variant];
    if (loadedCase === undefined) {
      throw new AuditRuntimeError(
        'artifact-invalid',
        'A stage-isolated diagnostic pack does not select a corpus case.',
      );
    }
    const canonical = buildStageIsolatedCanonicalInput(
      await prepareStageIsolatedCanonicalFixture({ descriptor, corpus, loadedCase }),
    );
    assertStageIsolatedDiagnosticPackBinding({
      descriptor,
      corpus: corpus.manifest,
      sourceDigest: digest,
      preparedPack,
      canonicalInputFingerprint: canonical.fingerprint,
    });
  }
  return registry;
}

/** Verifies every sealed identity before any stage/provider dependency can exist. */
export function assertStageIsolatedDiagnosticPackBinding(input: {
  descriptor: StageIsolatedDiagnosticPackRegistry['packs'][number];
  corpus: Readonly<{ packId: string; packVersion: string; manifestDigest: string }>;
  sourceDigest: string | undefined;
  preparedPack: StageIsolatedPreparedDiagnosticPack;
  canonicalInputFingerprint: string;
}): void {
  const { descriptor, corpus, sourceDigest, preparedPack, canonicalInputFingerprint } = input;
  if (
    corpus.packId !== descriptor.corpusPackId ||
    corpus.packVersion !== descriptor.corpusPackVersion ||
    corpus.manifestDigest !== descriptor.corpusManifestFingerprint ||
    sourceDigest !== descriptor.corpusSourceDigest ||
    preparedPack.pack.packId !== descriptor.diagnosticId ||
    preparedPack.pack.stage !== descriptor.stage ||
    preparedPack.pack.planProfile !== descriptor.planProfile ||
    preparedPack.pack.corpusPackId !== descriptor.corpusPackId ||
    preparedPack.pack.corpusPackVersion !== descriptor.corpusPackVersion ||
    preparedPack.pack.corpusManifestFingerprint !== descriptor.corpusManifestFingerprint ||
    preparedPack.pack.caseId !== descriptor.caseId ||
    preparedPack.pack.variant !== descriptor.variant ||
    preparedPack.pack.corpusSourceDigest !== descriptor.corpusSourceDigest ||
    preparedPack.pack.targetFingerprint !== descriptor.targetFingerprint ||
    preparedPack.canonicalInputFingerprint !== canonicalInputFingerprint ||
    preparedPack.pack.workflowProtocolFingerprint !== reviewWorkflowPromptProtocolFingerprint ||
    preparedPack.pack.stageProtocolFingerprint !==
      stageIsolatedDiagnosticStageProtocolFingerprint(descriptor.stage) ||
    preparedPack.pack.evaluatorProtocolFingerprint !==
      stageIsolatedAdjudicationAgentProtocolFingerprint
  ) {
    throw new AuditRuntimeError(
      'artifact-invalid',
      'A stage-isolated diagnostic pack does not match its sealed corpus, protocol, or canonical input.',
    );
  }
}

async function readPreparedPack(path: string) {
  return StageIsolatedPreparedDiagnosticPackSchema.parse(JSON.parse(await readFile(path, 'utf8')));
}

export function resolveStageIsolatedDiagnosticPath(root: string, candidate: string): string {
  if (isAbsolute(candidate))
    throw new AuditRuntimeError('unsafe-path', 'Diagnostic pack paths must be relative.');
  const resolved = resolve(root, candidate);
  if (relative(root, resolved).startsWith('..')) {
    throw new AuditRuntimeError(
      'unsafe-path',
      'Diagnostic pack paths must stay inside evaluator data.',
    );
  }
  return resolved;
}
