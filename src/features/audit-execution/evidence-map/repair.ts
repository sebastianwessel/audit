import { z } from 'zod';

import { sha256 } from '../../../shared/contracts/core.js';
import { AuditRuntimeError } from '../../../shared/errors/audit-runtime-error.js';
import type { AttackVector } from '../../attack-planning/plan/index.js';
import type { SourceEvidenceResolver } from '../source-evidence-resolver.js';
import {
  type EvidenceMap,
  type EvidenceMapInsufficiencies,
  EvidenceMapInsufficienciesSchema,
  EvidenceMapSchema,
  type UnverifiedEvidenceMapRepair,
  UnverifiedEvidenceMapRepairSchema,
} from './contract.js';
import { verifyEvidenceMapFragment } from './verify.js';

export const EvidenceMapRepairApplicationSchema = z.strictObject({
  evidenceMap: EvidenceMapSchema,
  appendedFactCount: z.number().int().nonnegative(),
});

export type EvidenceMapRepairApplication = z.infer<typeof EvidenceMapRepairApplicationSchema>;

/** Canonical, source-free identity used to stop an unchanged repair loop. */
export function evidenceMapInsufficiencySignature(
  insufficiencies: EvidenceMapInsufficiencies,
): string {
  return JSON.stringify(
    insufficiencies
      .map((insufficiency) => ({
        obligationIds: [...insufficiency.obligationIds].sort((left, right) =>
          left.localeCompare(right),
        ),
        needs: [...insufficiency.needs].sort((left, right) => left.localeCompare(right)),
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  );
}

/** Exact deterministic identity of the canonical neutral map, without raw model output. */
export function evidenceMapFingerprint(evidenceMap: EvidenceMap): string {
  return sha256(
    JSON.stringify({
      facts: evidenceMap.facts.map((fact) => ({
        factId: fact.factId,
        role: fact.role,
        summary: fact.summary,
        evidence: fact.evidence.map((evidence) => ({
          path: evidence.path,
          startLine: evidence.startLine,
          endLine: evidence.endLine,
          contentDigest: evidence.contentDigest,
          kind: evidence.kind,
        })),
        planObligations: fact.planObligations.map((obligation) => ({
          obligationId: obligation.obligationId,
        })),
      })),
      unansweredPlanObligations: evidenceMap.unansweredPlanObligations.map((obligation) => ({
        obligationId: obligation.obligationId,
      })),
      limitations: evidenceMap.limitations,
    }),
  );
}

/** Rejects a gap signal that is not bound to the current approved vector. */
export function verifyEvidenceMapInsufficiencies(
  vector: AttackVector,
  insufficiencies: EvidenceMapInsufficiencies,
): EvidenceMapInsufficiencies {
  const parsed = EvidenceMapInsufficienciesSchema.parse(insufficiencies);
  const approved = new Set(vector.reviewObligations.map((obligation) => obligation.obligationId));
  if (
    parsed.some((insufficiency) =>
      insufficiency.obligationIds.some((obligationId) => !approved.has(obligationId)),
    )
  ) {
    throw new AuditRuntimeError(
      'artifact-invalid',
      'An evidence-map repair signal referenced an obligation outside the approved vector.',
    );
  }
  return parsed;
}

/**
 * Appends validated neutral facts only. Existing fact identity is immutable;
 * an unchanged repair is explicitly observable by its zero append count.
 */
export async function applyEvidenceMapRepair(input: {
  vector: AttackVector;
  evidenceMap: EvidenceMap;
  repair: UnverifiedEvidenceMapRepair;
  sourceEvidence: SourceEvidenceResolver;
}): Promise<EvidenceMapRepairApplication> {
  const repair = UnverifiedEvidenceMapRepairSchema.parse(input.repair);
  const fragment = await verifyEvidenceMapFragment(
    input.vector,
    {
      facts: repair.facts,
      controlCoverage: [],
      unansweredPlanObligations: [],
      limitations: [],
    },
    input.sourceEvidence,
  );
  if (fragment.rejectedFactCount > 0) {
    throw new AuditRuntimeError(
      'artifact-invalid',
      'An evidence-map repair contained an invalid neutral source fact.',
    );
  }
  return appendCanonicalEvidenceMapFacts({
    evidenceMap: input.evidenceMap,
    facts: fragment.evidenceMap.facts,
  });
}

/** Appends only canonical facts and deterministically derives the next neutral map. */
export function appendCanonicalEvidenceMapFacts(input: {
  evidenceMap: EvidenceMap;
  facts: readonly EvidenceMap['facts'][number][];
}): EvidenceMapRepairApplication {
  const existingFactIds = new Set(input.evidenceMap.facts.map((fact) => fact.factId));
  if (input.facts.some((fact) => existingFactIds.has(fact.factId))) {
    throw new AuditRuntimeError(
      'artifact-invalid',
      'An evidence-map repair attempted to replace an existing neutral fact.',
    );
  }
  const facts = [...input.evidenceMap.facts, ...input.facts].sort((left, right) =>
    left.factId.localeCompare(right.factId),
  );
  const mappedObligationIds = new Set(
    facts.flatMap((fact) => fact.planObligations.map((obligation) => obligation.obligationId)),
  );
  return EvidenceMapRepairApplicationSchema.parse({
    evidenceMap: EvidenceMapSchema.parse({
      facts,
      unansweredPlanObligations: input.evidenceMap.unansweredPlanObligations.filter(
        (obligation) => !mappedObligationIds.has(obligation.obligationId),
      ),
      limitations: input.evidenceMap.limitations,
    }),
    appendedFactCount: input.facts.length,
  });
}

/**
 * Re-derives the append operation from a canonical stage result. This guards
 * the audit boundary and makes mocked or resumed repair results obey the same
 * append-only invariant as a live model stage.
 */
export function applyCanonicalEvidenceMapRepair(input: {
  evidenceMap: EvidenceMap;
  repairedEvidenceMap: EvidenceMap;
}): EvidenceMapRepairApplication {
  const priorById = new Map(input.evidenceMap.facts.map((fact) => [fact.factId, fact] as const));
  const additions = input.repairedEvidenceMap.facts.flatMap((fact) => {
    const prior = priorById.get(fact.factId);
    if (prior === undefined) return [fact];
    if (JSON.stringify(prior) !== JSON.stringify(fact)) {
      throw new AuditRuntimeError(
        'artifact-invalid',
        'A canonical evidence-map repair changed an existing neutral fact.',
      );
    }
    return [];
  });
  if (
    additions.length + input.evidenceMap.facts.length !==
    input.repairedEvidenceMap.facts.length
  ) {
    throw new AuditRuntimeError(
      'artifact-invalid',
      'A canonical evidence-map repair omitted an existing neutral fact.',
    );
  }
  return appendCanonicalEvidenceMapFacts({ evidenceMap: input.evidenceMap, facts: additions });
}
