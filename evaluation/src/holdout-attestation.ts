import { createPublicKey, verify } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';

import { canonicalJson, sha256 } from '../../src/shared/contracts/core.js';
import { AuditRuntimeError } from '../../src/shared/errors/audit-runtime-error.js';

import type { LoadedCorpusPack } from './corpus.js';
import { corpusReadinessDecisionDigest } from './corpus-readiness.js';
import {
  type HoldoutAttestation,
  HoldoutAttestationReferenceSchema,
  HoldoutAttestationSchema,
} from './holdout-attestation.schema.js';

/**
 * Verifies a source-free detached attestation before a private-holdout provider
 * run. It never reads evaluator answer keys or target source beyond the already
 * validated manifest identity.
 */
export async function verifyHoldoutAttestation(
  input: Readonly<{
    attestationPath: string;
    publicKeyPath: string;
    pack: LoadedCorpusPack;
    benchmarkProtocolFingerprint: string;
  }>,
) {
  const attestation = await readHoldoutAttestation(input.attestationPath);
  const publicKeyPem = await readRegularUtf8File(input.publicKeyPath, 'Holdout public key');
  const publicKeyFingerprint = sha256(publicKeyPem);
  if (attestation.publicKeyFingerprint !== publicKeyFingerprint) {
    throw attestationError('Holdout public key fingerprint does not match the attestation.');
  }
  const publicKey = createPublicKey(publicKeyPem);
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    throw attestationError('Holdout public key must be Ed25519.');
  }
  if (
    attestation.payload.holdoutPackId !== input.pack.manifest.packId ||
    attestation.payload.holdoutPackVersion !== input.pack.manifest.packVersion ||
    attestation.payload.holdoutManifestDigest !== input.pack.manifest.manifestDigest
  ) {
    throw attestationError('Holdout attestation does not bind this corpus manifest.');
  }
  if (attestation.payload.readinessReportDigest !== corpusReadinessDecisionDigest(input.pack)) {
    throw attestationError('Holdout attestation does not bind this readiness decision.');
  }
  if (attestation.payload.benchmarkProtocolFingerprint !== input.benchmarkProtocolFingerprint) {
    throw attestationError('Holdout attestation does not bind this benchmark protocol.');
  }
  const payload = canonicalJson(attestation.payload);
  const signature = Buffer.from(attestation.signature, 'base64');
  if (!verify(null, Buffer.from(payload), publicKey, signature)) {
    throw attestationError('Holdout attestation signature is invalid.');
  }
  return HoldoutAttestationReferenceSchema.parse({
    attestationId: attestation.payload.attestationId,
    payloadDigest: sha256(payload),
    publicKeyFingerprint,
    issuedAt: attestation.payload.issuedAt,
  });
}

async function readRegularUtf8File(path: string, label: string): Promise<string> {
  const status = await lstat(path).catch(() => undefined);
  if (status === undefined || !status.isFile() || status.isSymbolicLink()) {
    throw attestationError(`${label} must be a regular non-symlink file.`);
  }
  const content = await readFile(path, 'utf8').catch(() => {
    throw attestationError(`${label} is unreadable.`);
  });
  return content;
}

async function readHoldoutAttestation(path: string): Promise<HoldoutAttestation> {
  const content = await readRegularUtf8File(path, 'Holdout attestation');
  try {
    return HoldoutAttestationSchema.parse(JSON.parse(content));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw attestationError('Holdout attestation is not valid JSON.');
    }
    throw error;
  }
}

function attestationError(message: string): AuditRuntimeError {
  return new AuditRuntimeError('invalid-input', `Invalid holdout attestation: ${message}`);
}
