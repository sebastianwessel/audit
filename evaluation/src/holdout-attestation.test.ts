import { expect, test } from 'bun:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { canonicalJson, sha256 } from '../../src/shared/contracts/core.js';

import { loadCorpusPack } from './corpus.js';
import { corpusReadinessDecisionDigest } from './corpus-readiness.js';
import { verifyHoldoutAttestation } from './holdout-attestation.js';

test('verifies a detached Ed25519 attestation bound to the loaded corpus manifest', async () => {
  const pack = await loadCorpusPack('evaluation/data/corpora');
  const directory = await mkdtemp(join(tmpdir(), 'audit-holdout-attestation-'));
  const keyPair = generateKeyPairSync('ed25519');
  const publicKeyPem = keyPair.publicKey.export({ format: 'pem', type: 'spki' }).toString();
  const payload = {
    schemaVersion: 1 as const,
    attestationId: 'holdout-attestation-01',
    issuedAt: '2026-07-30T12:00:00.000Z',
    issuer: 'evaluation-steward',
    purpose: 'private-holdout-provider-evaluation' as const,
    holdoutPackId: pack.manifest.packId,
    holdoutPackVersion: pack.manifest.packVersion,
    holdoutManifestDigest: pack.manifest.manifestDigest,
    readinessReportDigest: corpusReadinessDecisionDigest(pack),
    benchmarkProtocolFingerprint: 'a'.repeat(64),
  };
  const signature = sign(null, Buffer.from(canonicalJson(payload)), keyPair.privateKey).toString(
    'base64',
  );
  const attestationPath = join(directory, 'attestation.json');
  const publicKeyPath = join(directory, 'holdout-public.pem');
  await writeFile(
    attestationPath,
    JSON.stringify({
      payload,
      signatureAlgorithm: 'ed25519',
      publicKeyFingerprint: sha256(publicKeyPem),
      signature,
    }),
    'utf8',
  );
  await writeFile(publicKeyPath, publicKeyPem, 'utf8');

  await expect(
    verifyHoldoutAttestation({
      attestationPath,
      publicKeyPath,
      pack,
      benchmarkProtocolFingerprint: payload.benchmarkProtocolFingerprint,
    }),
  ).resolves.toEqual({
    attestationId: payload.attestationId,
    payloadDigest: sha256(canonicalJson(payload)),
    publicKeyFingerprint: sha256(publicKeyPem),
    issuedAt: payload.issuedAt,
  });
});

test('rejects an attestation whose signature does not bind its payload', async () => {
  const pack = await loadCorpusPack('evaluation/data/corpora');
  const directory = await mkdtemp(join(tmpdir(), 'audit-holdout-attestation-'));
  const keyPair = generateKeyPairSync('ed25519');
  const publicKeyPem = keyPair.publicKey.export({ format: 'pem', type: 'spki' }).toString();
  const payload = {
    schemaVersion: 1 as const,
    attestationId: 'holdout-attestation-02',
    issuedAt: '2026-07-30T12:00:00.000Z',
    issuer: 'evaluation-steward',
    purpose: 'private-holdout-provider-evaluation' as const,
    holdoutPackId: pack.manifest.packId,
    holdoutPackVersion: pack.manifest.packVersion,
    holdoutManifestDigest: pack.manifest.manifestDigest,
    readinessReportDigest: corpusReadinessDecisionDigest(pack),
    benchmarkProtocolFingerprint: 'b'.repeat(64),
  };
  const attestationPath = join(directory, 'attestation.json');
  const publicKeyPath = join(directory, 'holdout-public.pem');
  await writeFile(
    attestationPath,
    JSON.stringify({
      payload,
      signatureAlgorithm: 'ed25519',
      publicKeyFingerprint: sha256(publicKeyPem),
      signature: sign(
        null,
        Buffer.from(canonicalJson({ ...payload, issuer: 'other' })),
        keyPair.privateKey,
      ).toString('base64'),
    }),
    'utf8',
  );
  await writeFile(publicKeyPath, publicKeyPem, 'utf8');

  await expect(
    verifyHoldoutAttestation({
      attestationPath,
      publicKeyPath,
      pack,
      benchmarkProtocolFingerprint: payload.benchmarkProtocolFingerprint,
    }),
  ).rejects.toThrow('signature is invalid');
});

test('rejects an attestation that does not bind the current readiness decision or protocol', async () => {
  const pack = await loadCorpusPack('evaluation/data/corpora');
  const directory = await mkdtemp(join(tmpdir(), 'audit-holdout-attestation-'));
  const keyPair = generateKeyPairSync('ed25519');
  const publicKeyPem = keyPair.publicKey.export({ format: 'pem', type: 'spki' }).toString();
  const payload = {
    schemaVersion: 1 as const,
    attestationId: 'holdout-attestation-03',
    issuedAt: '2026-07-30T12:00:00.000Z',
    issuer: 'evaluation-steward',
    purpose: 'private-holdout-provider-evaluation' as const,
    holdoutPackId: pack.manifest.packId,
    holdoutPackVersion: pack.manifest.packVersion,
    holdoutManifestDigest: pack.manifest.manifestDigest,
    readinessReportDigest: corpusReadinessDecisionDigest(pack),
    benchmarkProtocolFingerprint: 'd'.repeat(64),
  };
  const attestationPath = join(directory, 'attestation.json');
  const publicKeyPath = join(directory, 'holdout-public.pem');
  await writeFile(
    attestationPath,
    JSON.stringify({
      payload,
      signatureAlgorithm: 'ed25519',
      publicKeyFingerprint: sha256(publicKeyPem),
      signature: sign(null, Buffer.from(canonicalJson(payload)), keyPair.privateKey).toString(
        'base64',
      ),
    }),
    'utf8',
  );
  await writeFile(publicKeyPath, publicKeyPem, 'utf8');

  await expect(
    verifyHoldoutAttestation({
      attestationPath,
      publicKeyPath,
      pack,
      benchmarkProtocolFingerprint: 'e'.repeat(64),
    }),
  ).rejects.toThrow('does not bind this benchmark protocol');

  const stalePayload = { ...payload, readinessReportDigest: 'c'.repeat(64) };
  await writeFile(
    attestationPath,
    JSON.stringify({
      payload: stalePayload,
      signatureAlgorithm: 'ed25519',
      publicKeyFingerprint: sha256(publicKeyPem),
      signature: sign(null, Buffer.from(canonicalJson(stalePayload)), keyPair.privateKey).toString(
        'base64',
      ),
    }),
    'utf8',
  );
  await expect(
    verifyHoldoutAttestation({
      attestationPath,
      publicKeyPath,
      pack,
      benchmarkProtocolFingerprint: payload.benchmarkProtocolFingerprint,
    }),
  ).rejects.toThrow('does not bind this readiness decision');
});
