import { z } from 'zod';

import {
  IdentifierSchema,
  IsoDateTimeSchema,
  SchemaVersion,
  Sha256Schema,
} from '../../shared/contracts/core.js';

/** The source-free payload that an independent corpus steward signs offline. */
export const HoldoutAttestationPayloadSchema = z.strictObject({
  schemaVersion: SchemaVersion,
  attestationId: IdentifierSchema,
  issuedAt: IsoDateTimeSchema,
  issuer: z.string().trim().min(1).max(160),
  purpose: z.literal('private-holdout-provider-evaluation'),
  holdoutPackId: IdentifierSchema,
  holdoutPackVersion: z.string().trim().min(1).max(32),
  holdoutManifestDigest: Sha256Schema,
  readinessReportDigest: Sha256Schema,
  benchmarkProtocolFingerprint: Sha256Schema,
});

/** Detached Ed25519 envelope; its public key is supplied separately by the operator. */
export const HoldoutAttestationSchema = z.strictObject({
  payload: HoldoutAttestationPayloadSchema,
  signatureAlgorithm: z.literal('ed25519'),
  publicKeyFingerprint: Sha256Schema,
  signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/u),
});

/** The only attestation data persisted with a provider evaluation artifact. */
export const HoldoutAttestationReferenceSchema = z.strictObject({
  attestationId: IdentifierSchema,
  payloadDigest: Sha256Schema,
  publicKeyFingerprint: Sha256Schema,
  issuedAt: IsoDateTimeSchema,
});

export type HoldoutAttestation = z.infer<typeof HoldoutAttestationSchema>;
export type HoldoutAttestationReference = z.infer<typeof HoldoutAttestationReferenceSchema>;
