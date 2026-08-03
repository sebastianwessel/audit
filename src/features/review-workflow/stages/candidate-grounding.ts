import type { ModelProvider } from '@purista/harness';
import type { HarnessExecutionConfiguration } from '../../../platform/harness/security-reviewer-harness.js';
import { SecurityReviewerError } from '../../../shared/errors/security-reviewer-error.js';
import type {
  CandidateGroundingRequest,
  CanonicalCandidateGroundingOutput,
} from '../../audit-execution/candidate-grounding/contract.js';
import { canonicalizeCandidateGroundingOutput } from '../../audit-execution/candidate-grounding/identity.js';
import type { EvidenceMap } from '../../audit-execution/evidence-map/contract.js';
import type { HypothesisSeed } from '../../audit-execution/investigation/contract.js';
import type { SourceDocument } from '../../audit-execution/phase-input/contract.js';
import type { SourcePosture } from '../../audit-execution/source-posture/contract.js';
import type { ModelCostCeiling, ModelPricing } from '../../model-operations/model-operations.js';
import type { ContextDocument } from '../../target-inventory/inventory.schema.js';
import type { SourceRepository } from '../../target-inventory/source-snapshot.js';
import type {
  ContextOverflowRecoveredLeaf,
  ContextOverflowTopology,
  ContextOverflowTopologyEvent,
  ContextRecoveryScope,
} from '../runtime/context-overflow.js';
import { scopedInspectionRequirement } from '../tools/contract.js';
import {
  evidenceMapFactIsWithinRecoveryScope,
  sourceEvidenceIntersectsRecoveryScope,
  sourceEvidenceIsWithinRecoveryScope,
} from './scoped-evidence.js';
import { runScopedModelStage } from './scoped-model-stage.js';

/** Grounds a bounded batch of discovery seeds without permitting new discovery. */
export async function runCandidateGroundingStage(input: {
  modelProvider: ModelProvider;
  filesystem: SourceRepository;
  request: CandidateGroundingRequest;
  /** Immutable in-memory snapshot projection used before persisting recovery work. */
  sources: readonly SourceDocument[];
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
    priorRecoveredLeaves?: readonly ContextOverflowRecoveredLeaf<CanonicalCandidateGroundingOutput>[];
    onTransition: (event: ContextOverflowTopologyEvent) => Promise<void>;
    onRecoveredLeafCompleted?: (input: {
      childKey: string;
      scope: ContextRecoveryScope;
      scopeFingerprint: string;
      output: CanonicalCandidateGroundingOutput;
    }) => Promise<void>;
  }>;
}) {
  const overflowTopology = (() => {
    if (input.overflowTopology === undefined) return undefined;
    const { priorRecoveredLeaves, onRecoveredLeafCompleted, ...topology } = input.overflowTopology;
    return {
      ...topology,
      ...(priorRecoveredLeaves === undefined ? {} : { priorRecoveredLeaves }),
      ...(onRecoveredLeafCompleted === undefined
        ? {}
        : {
            onRecoveredLeafCompleted: async (leaf: {
              childKey: string;
              attempt: number;
              scope: ContextRecoveryScope;
              scopeFingerprint: string;
              output: CanonicalCandidateGroundingOutput;
            }) => {
              const scoped = candidateGroundingScopeProjection(
                input.request,
                input.sources,
                leaf.scope,
              );
              assertCanonicalGroundingWithinScope(leaf.output, scoped, leaf.scope);
              await onRecoveredLeafCompleted({
                childKey: leaf.childKey,
                scope: leaf.scope,
                scopeFingerprint: leaf.scopeFingerprint,
                output: leaf.output,
              });
            },
          }),
    };
  })();
  return runScopedModelStage<CanonicalCandidateGroundingOutput>({
    stage: 'candidate-grounding',
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
    ...(overflowTopology === undefined ? {} : { overflowTopology }),
    requireScopedSourceInspection: true,
    hasModelWorkInScope: (scope) =>
      candidateGroundingScopeProjection(input.request, input.sources, scope).request.seeds.length >
      0,
    emptyScopeOutput: () => ({ groundings: [] }),
    allowContextSplitting: false,
    invoke: async (session, _attempt, scope: ContextRecoveryScope) => {
      const scoped = candidateGroundingScopeProjection(input.request, input.sources, scope);
      if (scoped.request.seeds.length === 0) {
        throw new SecurityReviewerError(
          'artifact-invalid',
          'Candidate grounding dispatched a recovery scope without a complete seed basis.',
        );
      }
      return canonicalizeCandidateGroundingOutput({
        vector: input.request.vector,
        seeds: scoped.request.seeds,
        output: await session.workflows.ground_vector_candidates.prompt({
          ...scoped.request,
          availableSourcePaths: [...scope.sourcePaths],
          context: [...scope.context],
          inspectionRequirement: scopedInspectionRequirement(scope.sourcePaths),
        }),
        evidenceMap: scoped.request.evidenceMap,
        sourcePosture: scoped.request.sourcePosture,
        sources: scoped.sources,
      });
    },
    reduceRecoveredOutputs: (leaves) => ({
      groundings: input.request.seeds.map((seed) => {
        const groundings = leaves.flatMap((leaf) =>
          leaf.output.groundings.filter((grounding) => grounding.seedId === seed.seedId),
        );
        if (groundings.length !== 1) {
          throw new SecurityReviewerError(
            'provider-context-overflow',
            'Context recovery must return exactly one canonical grounding for every requested seed.',
          );
        }
        const grounding = groundings[0];
        if (grounding === undefined) {
          throw new SecurityReviewerError(
            'provider-context-overflow',
            'Context recovery did not retain a canonical grounding outcome.',
          );
        }
        return grounding;
      }),
    }),
  });
}

/** Projects only the complete, exact seed basis a recovery child can inspect. */
function candidateGroundingScopeProjection(
  request: CandidateGroundingRequest,
  sources: readonly SourceDocument[],
  scope: Pick<ContextRecoveryScope, 'sourcePaths' | 'lineRanges'>,
) {
  const factsById = new Map(request.evidenceMap.facts.map((fact) => [fact.factId, fact] as const));
  const scopedFacts = request.evidenceMap.facts.filter((fact) =>
    evidenceMapFactIsWithinRecoveryScope(fact, scope),
  );
  const scopedFactIds = new Set(scopedFacts.map((fact) => fact.factId));
  const scopedAssessments = request.sourcePosture.assessments.filter((assessment) =>
    assessment.evidenceMapFactIds.every((factId) => scopedFactIds.has(factId)),
  );
  const scopedAssessmentIds = new Set(
    scopedAssessments.map((assessment) => assessment.assessmentId),
  );
  const seeds = request.seeds.flatMap((seed) => {
    const facts = seed.evidenceMapFactIds.map((factId) => factsById.get(factId));
    if (facts.some((fact) => fact === undefined)) {
      throw new SecurityReviewerError(
        'artifact-invalid',
        'Candidate grounding received a seed with an unknown evidence-map fact.',
      );
    }
    const complete = seed.evidenceMapFactIds.every((factId) => scopedFactIds.has(factId));
    if (!complete) {
      if (facts.some((fact) => fact !== undefined && evidenceMapFactTouchesScope(fact, scope))) {
        throw new SecurityReviewerError(
          'provider-context-overflow',
          'A discovery seed cannot be losslessly assigned to one recovered source scope.',
        );
      }
      return [];
    }
    if (
      !seed.sourcePostureAssessmentIds.every((assessmentId) =>
        scopedAssessmentIds.has(assessmentId),
      )
    ) {
      throw new SecurityReviewerError(
        'artifact-invalid',
        'Candidate grounding received a seed without its complete source-posture basis.',
      );
    }
    return [seed];
  });
  return {
    request: {
      vector: request.vector,
      evidenceMap: {
        facts: scopedFacts,
        unansweredPlanObligations: request.evidenceMap.unansweredPlanObligations,
        limitations: request.evidenceMap.limitations,
      },
      sourcePosture: {
        assessments: scopedAssessments,
        limitations: request.sourcePosture.limitations,
      },
      seeds,
      availableSourcePaths: [...scope.sourcePaths],
    },
    sources: sources.filter((source) => scope.sourcePaths.includes(source.path)),
  };
}

function evidenceMapFactTouchesScope(
  fact: EvidenceMap['facts'][number],
  scope: Pick<ContextRecoveryScope, 'sourcePaths' | 'lineRanges'>,
): boolean {
  return fact.evidence.some((evidence) => sourceEvidenceIntersectsRecoveryScope(evidence, scope));
}

function assertCanonicalGroundingWithinScope(
  output: CanonicalCandidateGroundingOutput,
  scoped: Readonly<{
    request: Readonly<{
      evidenceMap: EvidenceMap;
      sourcePosture: SourcePosture;
      seeds: readonly HypothesisSeed[];
    }>;
  }>,
  scope: Pick<ContextRecoveryScope, 'sourcePaths' | 'lineRanges'>,
): void {
  const seeds = new Map(scoped.request.seeds.map((seed) => [seed.seedId, seed] as const));
  const facts = new Map(
    scoped.request.evidenceMap.facts.map((fact) => [fact.factId, fact] as const),
  );
  if (output.groundings.length !== seeds.size) {
    throw new SecurityReviewerError(
      'artifact-invalid',
      'A recovered grounding artifact does not retain exactly its assigned seed outcomes.',
    );
  }
  for (const grounding of output.groundings) {
    const seed = seeds.get(grounding.seedId);
    if (seed === undefined) {
      throw new SecurityReviewerError(
        'artifact-invalid',
        'A recovered grounding artifact references a seed outside its exact approved scope.',
      );
    }
    if (grounding.disposition !== 'grounded') continue;
    for (const factId of grounding.hypothesis.evidenceMapFactIds) {
      const fact = facts.get(factId);
      if (fact === undefined || !evidenceMapFactIsWithinRecoveryScope(fact, scope)) {
        throw new SecurityReviewerError(
          'artifact-invalid',
          'A recovered grounding artifact references map evidence outside its exact approved scope.',
        );
      }
    }
    if (
      grounding.hypothesis.evidence.some(
        (evidence) => !sourceEvidenceIsWithinRecoveryScope(evidence, scope),
      )
    ) {
      throw new SecurityReviewerError(
        'artifact-invalid',
        'A recovered grounding artifact references source evidence outside its exact approved scope.',
      );
    }
  }
}
