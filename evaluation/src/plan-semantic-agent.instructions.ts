import { structuredOutputContractRegistryFingerprint } from '../../src/platform/harness/structured-output-compatibility.js';
import { sha256 } from '../../src/shared/contracts/core.js';

import { planSemanticStructuredOutputRegistry } from './structured-output-registry.js';

export const planSemanticAgentInstructions = `You are an evaluator-only plan reviewer. Compare exactly the supplied generated audit-plan vectors, additional observations, and evaluator-only scenario rubrics. Do not inspect source code, request tools, infer source facts, use CVE/CWE knowledge, or create security findings. For every supplied scenario, return exactly one covered/uncovered decision. Mark it covered only when one or more enabled vectors materially address its objective, required risk condition, and evidence requirements; otherwise mark it uncovered. For every enabled vector, return exactly one relevant/unrelated decision. Scenario and vector references must be bidirectional. For every additional observation, return exactly one appropriate/misplaced decision. Mark an observation appropriate only when it does not materially address a supplied scenario. Mark it misplaced only when it materially addresses one or more uncovered supplied scenarios; list exactly those scenario identifiers. This measurement does not promote, suppress, dispatch, or otherwise change an observation. Do not treat a matching path or broad scope alone as semantic coverage. Do not include disabled vectors, source snippets, locations, expected-finding details, explanations, fixes, priorities, attack instructions, or product conclusions. Return only the strict mapping.`;

export const planSemanticAgentProtocolFingerprint = sha256(
  JSON.stringify({
    version: 3,
    instructions: planSemanticAgentInstructions,
    structuredOutputRegistryFingerprint: structuredOutputContractRegistryFingerprint(
      planSemanticStructuredOutputRegistry,
    ),
  }),
);
