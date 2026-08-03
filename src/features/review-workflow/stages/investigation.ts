import type { ModelProvider } from '@purista/harness';
import type { HarnessExecutionConfiguration } from '../../../platform/harness/security-reviewer-harness.js';
import { SecurityReviewerError } from '../../../shared/errors/security-reviewer-error.js';
import type { AuditInvestigationRequest } from '../../audit-execution/audit.schema.js';
import {
  HypothesisSeedSchema,
  InvestigationObligationClosureSchema,
  type UnverifiedHypothesisSeed,
  type UnverifiedInvestigationObligationClosure,
} from '../../audit-execution/investigation/contract.js';
import {
  deriveSourcePostureProvenance,
  mergeUniqueIdentifiers,
} from '../../audit-execution/source-posture/provenance.js';
import type { ModelCostCeiling, ModelPricing } from '../../model-operations/model-operations.js';
import type { ContextDocument } from '../../target-inventory/inventory.schema.js';
import type { SourceRepository } from '../../target-inventory/source-snapshot.js';
import type {
  ContextOverflowTopology,
  ContextOverflowTopologyEvent,
} from '../runtime/context-overflow.js';
import { scopedInspectionRequirement } from '../tools/contract.js';
import { runScopedModelStage } from './scoped-model-stage.js';

/** Executes only the investigator's scoped model stage and records its own numeric ledger. */
export async function runInvestigationStage(input: {
  modelProvider: ModelProvider;
  filesystem: SourceRepository;
  request: AuditInvestigationRequest;
  context: readonly ContextDocument[];
  sessionId: string;
  modelName: string | undefined;
  harnessExecution: HarnessExecutionConfiguration;
  modelCacheRoutingKey: string | undefined;
  modelPricing: ModelPricing;
  modelCostCeiling?: ModelCostCeiling;
  cacheRoutingEnabled: boolean;
  overflowTopology?: Readonly<{
    prior?: ContextOverflowTopology;
    onTransition: (event: ContextOverflowTopologyEvent) => Promise<void>;
  }>;
}) {
  const result = await runScopedModelStage({
    stage: 'investigation',
    route: 'primary',
    stageId: input.request.vector.vectorId,
    modelProvider: input.modelProvider,
    filesystem: input.filesystem,
    availableSourcePaths: input.request.availableSourcePaths,
    context: input.context,
    sessionId: input.sessionId,
    modelName: input.modelName,
    harnessExecution: input.harnessExecution,
    modelCacheRoutingKey: input.modelCacheRoutingKey,
    modelPricing: input.modelPricing,
    modelCostCeiling: input.modelCostCeiling,
    cacheRoutingEnabled: input.cacheRoutingEnabled,
    ...(input.overflowTopology === undefined ? {} : { overflowTopology: input.overflowTopology }),
    requireScopedSourceInspection: true,
    invoke: (session, _attempt, scope) =>
      session.workflows.review_vector.prompt({
        ...input.request,
        availableSourcePaths: [...scope.sourcePaths],
        context: [...scope.context],
        inspectionRequirement: scopedInspectionRequirement(scope.sourcePaths),
      }),
    reduceRecoveredOutputs: (leaves) => ({
      seeds: mergeSeeds(leaves.flatMap((leaf) => leaf.output.seeds)),
      closures: mergeClosures(leaves.flatMap((leaf) => leaf.output.closures)),
    }),
  });
  if (result.status === 'completed') {
    return {
      seeds: projectSeeds(result.output.seeds, input.request),
      closures: projectClosures(result.output.closures, input.request),
      modelObservation: result.modelObservation,
    };
  }
  return { seeds: [], closures: [], modelObservation: result.modelObservation };
}

function projectSeeds(
  seeds: readonly UnverifiedHypothesisSeed[],
  request: AuditInvestigationRequest,
) {
  return seeds.map((seed) => {
    const provenance = deriveSourcePostureProvenance(seed.planObligations, request.sourcePosture);
    return HypothesisSeedSchema.parse({
      ...seed,
      evidenceMapFactIds: mergeUniqueIdentifiers(
        seed.evidenceMapFactIds,
        provenance.evidenceMapFactIds,
      ),
      sourcePostureAssessmentIds: provenance.sourcePostureAssessmentIds,
    });
  });
}

function projectClosures(
  closures: readonly UnverifiedInvestigationObligationClosure[],
  request: AuditInvestigationRequest,
) {
  return closures.map((closure) => {
    const provenance = deriveSourcePostureProvenance(
      [closure.planObligation],
      request.sourcePosture,
    );
    return InvestigationObligationClosureSchema.parse({
      ...closure,
      evidenceMapFactIds: mergeUniqueIdentifiers(
        closure.evidenceMapFactIds,
        provenance.evidenceMapFactIds,
      ),
      sourcePostureAssessmentIds: provenance.sourcePostureAssessmentIds,
    });
  });
}

function mergeSeeds<T extends { seedId: string }>(seeds: readonly T[]): T[] {
  const byId = new Map<string, T>();
  for (const seed of seeds) {
    const existing = byId.get(seed.seedId);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(seed)) {
      throw new SecurityReviewerError(
        'provider-context-overflow',
        'Context recovery produced conflicting discovery seed identities.',
      );
    }
    byId.set(seed.seedId, seed);
  }
  return [...byId.values()].sort((left, right) => left.seedId.localeCompare(right.seedId));
}

function mergeClosures(
  closures: readonly UnverifiedInvestigationObligationClosure[],
): UnverifiedInvestigationObligationClosure[] {
  const byObligation = new Map<string, UnverifiedInvestigationObligationClosure[]>();
  for (const closure of closures) {
    const key = closure.planObligation.obligationId;
    byObligation.set(key, [...(byObligation.get(key) ?? []), closure]);
  }
  return [...byObligation.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, grouped]) => {
      const first = grouped[0];
      if (first === undefined) throw new Error('Expected a recovered closure.');
      const dispositions = new Set(grouped.map((closure) => closure.disposition));
      const disposition: UnverifiedInvestigationObligationClosure['disposition'] = dispositions.has(
        'incomplete',
      )
        ? 'incomplete'
        : dispositions.has('candidate-raised')
          ? dispositions.has('not-applicable')
            ? 'incomplete'
            : 'candidate-raised'
          : dispositions.has('not-applicable')
            ? dispositions.size === 1
              ? 'not-applicable'
              : 'incomplete'
            : 'no-source-backed-candidate';
      return {
        planObligation: first.planObligation,
        disposition,
        evidenceMapFactIds: uniqueSorted(grouped.flatMap((closure) => closure.evidenceMapFactIds)),
        limitations: uniqueSorted([
          ...grouped.flatMap((closure) => closure.limitations),
          ...(disposition === 'incomplete' && dispositions.size > 1
            ? ['Approved-scope context recovery produced conflicting obligation closures.']
            : []),
        ]),
      };
    });
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
