import { auditWorkflowStructuredOutputRegistry } from '../../platform/harness/audit-harness.js';
import { structuredOutputContractRegistryFingerprint } from '../../platform/harness/structured-output-compatibility.js';
import { sha256 } from '../../shared/contracts/core.js';
import { planningAgentInstructions } from '../attack-planning/planner/agent/index.js';
import { candidateGroundingAgentInstructions } from '../audit-execution/candidate-grounding/index.js';
import { countercheckAgentInstructions } from '../audit-execution/countercheck/index.js';
import { evidenceMapAgentInstructions } from '../audit-execution/evidence-map/index.js';
import { investigationAgentInstructions } from '../audit-execution/investigation/index.js';
import { sourcePostureAgentInstructions } from '../audit-execution/source-posture/index.js';
import { verificationAgentInstructions } from '../audit-execution/verification/index.js';
import { ReviewRepositoryToolDescriptions, ReviewRepositoryToolIds } from './tools/contract.js';

/**
 * Content-free identity of the model-visible protocol. Provider evaluations use
 * this to reject comparisons across prompt or repository-tool-description drift.
 */
export const reviewWorkflowPromptProtocolFingerprint = sha256(
  JSON.stringify({
    version: 9,
    agents: {
      planning: planningAgentInstructions,
      evidenceMapping: evidenceMapAgentInstructions,
      sourcePosture: sourcePostureAgentInstructions,
      investigation: investigationAgentInstructions,
      candidateGrounding: candidateGroundingAgentInstructions,
      verification: verificationAgentInstructions,
      countercheck: countercheckAgentInstructions,
    },
    repositoryTools: {
      ids: ReviewRepositoryToolIds,
      descriptions: ReviewRepositoryToolDescriptions,
    },
    structuredOutputRegistryFingerprint: structuredOutputContractRegistryFingerprint(
      auditWorkflowStructuredOutputRegistry,
    ),
  }),
);

/** Prevents a map checkpoint from being reused after mapper-contract drift. */
export const evidenceMapProtocolFingerprint = sha256(
  JSON.stringify({
    version: 3,
    instructions: evidenceMapAgentInstructions,
    repositoryTools: {
      ids: ReviewRepositoryToolIds,
      descriptions: ReviewRepositoryToolDescriptions,
    },
  }),
);

/** Narrow protocol binding used to prevent verifier checkpoint reuse across contract drift. */
export const verificationProtocolFingerprint = sha256(
  JSON.stringify({
    version: 3,
    instructions: verificationAgentInstructions,
    repositoryTools: {
      ids: ReviewRepositoryToolIds,
      descriptions: ReviewRepositoryToolDescriptions,
    },
  }),
);

/** Exact planning-stage protocol identity for evaluator-only isolated measurements. */
export const planningProtocolFingerprint = sha256(
  JSON.stringify({
    version: 1,
    instructions: planningAgentInstructions,
    repositoryTools: {
      ids: ReviewRepositoryToolIds,
      descriptions: ReviewRepositoryToolDescriptions,
    },
  }),
);

/**
 * Both discovery and grounding are required to close this isolated stage, so
 * its evaluator identity binds their shared repository-tool protocol together.
 */
export const investigationGroundingProtocolFingerprint = sha256(
  JSON.stringify({
    version: 1,
    agents: {
      investigation: investigationAgentInstructions,
      candidateGrounding: candidateGroundingAgentInstructions,
    },
    repositoryTools: {
      ids: ReviewRepositoryToolIds,
      descriptions: ReviewRepositoryToolDescriptions,
    },
  }),
);
