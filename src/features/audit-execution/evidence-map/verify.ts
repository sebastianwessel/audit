import { textLinesWithoutEndings } from '../../../platform/filesystem/text-lines.js';
import { BoundedTextSchema } from '../../../shared/contracts/core.js';
import {
  type AttackVector,
  hasApprovedPlanObligations,
  planObligationKey,
} from '../../attack-planning/plan.schema.js';
import type { SourceDocument } from '../audit.schema.js';
import { redactArtifactText } from '../investigation/redaction.js';
import {
  type EvidenceMap,
  EvidenceMapFactRoleSchema,
  EvidenceMapSchema,
  mappedControlFactIdsForObligation,
  type UnverifiedEvidenceMap,
} from './contract.js';

export type EvidenceMapVerificationResult = Readonly<{
  evidenceMap: EvidenceMap;
  rejectedFactCount: number;
  complete: boolean;
}>;

/**
 * Checks only source-location and plan-binding integrity. It deliberately does
 * not determine whether a fact is security-relevant or whether a control works.
 */
export function verifyEvidenceMap(
  vector: AttackVector,
  evidenceMap: UnverifiedEvidenceMap | EvidenceMap,
  sources: readonly SourceDocument[],
): EvidenceMapVerificationResult {
  const byPath = new Map(sources.map((source) => [source.path, source] as const));
  const retainedFactIds = new Set<string>();
  const facts = evidenceMap.facts.flatMap((fact) => {
    const role = EvidenceMapFactRoleSchema.safeParse(fact.role);
    const statement = BoundedTextSchema.min(1).safeParse(fact.statement);
    if (!role.success || !statement.success || retainedFactIds.has(fact.factId)) return [];
    if (!hasApprovedPlanObligations(vector, fact.planObligations)) return [];
    const evidence = fact.evidence.flatMap((item) => {
      const source = byPath.get(item.path);
      if (source === undefined) return [];
      const sourceLine = textLinesWithoutEndings(source.content)[item.startLine - 1];
      if (sourceLine === undefined) return [];
      return [
        {
          path: source.path,
          startLine: item.startLine,
          endLine: item.startLine,
          snippet: redactArtifactText(sourceLine),
          kind:
            source.languageHint === 'configuration'
              ? ('configuration' as const)
              : ('source' as const),
        },
      ];
    });
    if (evidence.length !== fact.evidence.length) return [];
    retainedFactIds.add(fact.factId);
    return [
      {
        factId: fact.factId,
        role: role.data,
        statement: redactArtifactText(statement.data),
        evidence,
        planObligations: fact.planObligations,
      },
    ];
  });
  const mappedObligationKeys = new Set(
    facts.flatMap((fact) => fact.planObligations.map(planObligationKey)),
  );
  const unansweredPlanObligations = evidenceMap.unansweredPlanObligations.filter(
    (reference) =>
      hasApprovedPlanObligations(vector, [reference]) &&
      !mappedObligationKeys.has(planObligationKey(reference)),
  );
  const verified = EvidenceMapSchema.parse({
    facts,
    unansweredPlanObligations,
    limitations: uniqueSorted(evidenceMap.limitations.map(redactArtifactText)),
  });
  const representedObligations = new Set([
    ...verified.facts.flatMap((fact) => fact.planObligations.map(planObligationKey)),
    ...verified.unansweredPlanObligations.map(planObligationKey),
  ]);
  const declaredControlCoverage =
    'controlCoverage' in evidenceMap
      ? evidenceMap.controlCoverage
      : vector.reviewObligations.map((obligation) => ({
          obligationId: obligation.obligationId,
          controlFactIds: mappedControlFactIdsForObligation(verified, obligation.obligationId),
        }));
  const completeControlCoverage = vector.reviewObligations.every((obligation) => {
    const declared = declaredControlCoverage.filter(
      (coverage) => coverage.obligationId === obligation.obligationId,
    );
    if (declared.length !== 1) return false;
    const expected = mappedControlFactIdsForObligation(verified, obligation.obligationId);
    const actual = [...new Set(declared[0]?.controlFactIds ?? [])].sort((left, right) =>
      left.localeCompare(right),
    );
    return (
      expected.length === actual.length &&
      expected.every((factId, index) => factId === actual[index])
    );
  });
  return Object.freeze({
    evidenceMap: verified,
    rejectedFactCount: evidenceMap.facts.length - verified.facts.length,
    complete:
      completeControlCoverage &&
      vector.reviewObligations.every((obligation) =>
        representedObligations.has(planObligationKey({ obligationId: obligation.obligationId })),
      ),
  });
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
