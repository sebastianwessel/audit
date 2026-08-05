import { structuredOutputContractRegistryFingerprint } from '../../src/platform/harness/structured-output-compatibility.js';
import { sha256 } from '../../src/shared/contracts/core.js';

import { stageIsolatedStructuredOutputRegistry } from './structured-output-registry.js';

export const stageIsolatedAdjudicationAgentInstructions = `You are an evaluator-only, no-tools adjudicator for one completed isolated audit stage. Compare only the supplied expected-outcome objective, risk condition, evidence requirements, and the supplied in-memory source-free product claims. Return exactly one matched, missing, or not-applicable mapping for every expected outcome. A matched mapping must select only declared product output identifiers and the declared role-localization identifiers that belong to those outputs. Return every remaining declared product output exactly once as unexpected. Do not request or use tools. Do not inspect or infer source code, paths, line numbers, snippets, prompts, repository-tool data, answer keys, CVE/CWE knowledge, or paired variants. Do not return prose, rationale, findings, product conclusions, attack chains, classifications, priority, confidence, impact, remediation, fixes, or admission decisions. This evaluator output is measurement evidence only and cannot alter product audit admission.`;

export const stageIsolatedAdjudicationAgentProtocolFingerprint = sha256(
  JSON.stringify({
    version: 3,
    instructions: stageIsolatedAdjudicationAgentInstructions,
    structuredOutputRegistryFingerprint: structuredOutputContractRegistryFingerprint(
      stageIsolatedStructuredOutputRegistry,
    ),
  }),
);
