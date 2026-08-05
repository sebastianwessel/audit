import { expect, test } from 'bun:test';
import { planningAgentInstructions } from '../../attack-planning/index.js';

import { candidateGroundingAgentInstructions } from '../../audit-execution/candidate-grounding/index.js';
import { countercheckAgentInstructions } from '../../audit-execution/countercheck/index.js';
import {
  evidenceMapAgentInstructions,
  evidenceMapRepairAgentInstructions,
} from '../../audit-execution/evidence-map/index.js';
import { investigationAgentInstructions } from '../../audit-execution/investigation/index.js';
import { sourcePostureAgentInstructions } from '../../audit-execution/source-posture/index.js';
import { verificationAgentInstructions } from '../../audit-execution/verification/index.js';
import { developerGuidanceAgentInstructions } from '../../developer-guidance/index.js';
import { retryGuidanceInstruction } from './retry-guidance-instructions.js';
import { scopedInspectionFirstActionInstruction } from './scoped-inspection-instructions.js';

test('gives every source-deciding agent one shared mandatory first-action instruction', () => {
  for (const instructions of [
    evidenceMapAgentInstructions,
    planningAgentInstructions,
    sourcePostureAgentInstructions,
    investigationAgentInstructions,
    candidateGroundingAgentInstructions,
    verificationAgentInstructions,
    countercheckAgentInstructions,
    evidenceMapRepairAgentInstructions,
  ]) {
    expect(instructions).toContain(scopedInspectionFirstActionInstruction);
    expect(instructions).toContain('FIRST ACTION');
  }
});

test('requires model evidence to use exact tool-issued line coordinates', () => {
  expect(scopedInspectionFirstActionInstruction).toContain('exact { line, text } records');
  expect(scopedInspectionFirstActionInstruction).toContain('never calculate or estimate');
  expect(evidenceMapAgentInstructions).toContain('directly supports the neutral statement');
  expect(evidenceMapRepairAgentInstructions).toContain('not an inferred or nearby line');
});

test('gives every live model stage the same content-free retry guidance', () => {
  for (const instructions of [
    evidenceMapAgentInstructions,
    planningAgentInstructions,
    sourcePostureAgentInstructions,
    investigationAgentInstructions,
    candidateGroundingAgentInstructions,
    verificationAgentInstructions,
    countercheckAgentInstructions,
    evidenceMapRepairAgentInstructions,
    developerGuidanceAgentInstructions,
  ]) {
    expect(instructions).toContain(retryGuidanceInstruction);
    expect(instructions).toContain('output-validation');
    expect(instructions).toContain('source-inspection');
  }
});

test('keeps speculative planning suggestions outside executable audit vectors', () => {
  expect(planningAgentInstructions).toContain(
    'Put only target-specific, materially security-relevant',
  );
  expect(planningAgentInstructions).toContain('put it in additionalObservations instead');
});

test('keeps planning obligations atomic and preserves context gaps as incomplete', () => {
  expect(planningAgentInstructions).toContain('Keep obligations atomic');
  expect(planningAgentInstructions).toContain('context-dependent consequence/reachability');
  expect(verificationAgentInstructions).toContain('context-required');
  expect(verificationAgentInstructions).toContain(
    'source-visible behavior without that consequence',
  );
});

test('requires plans and verifier decisions to establish the exact security consequence', () => {
  expect(planningAgentInstructions).toContain(
    'source condition and the protected security consequence',
  );
  expect(candidateGroundingAgentInstructions).toContain('rather than an adjacent code pattern');
  expect(verificationAgentInstructions).toContain('missing generic guard, an adjacent risk');
  expect(sourcePostureAgentInstructions).toContain(
    'generic missing guard or adjacent source pattern',
  );
});

test('asks the verifier for only the active decision branch fields', () => {
  expect(verificationAgentInstructions).toContain(
    'fields that are meaningful for the selected decision',
  );
  expect(verificationAgentInstructions).toContain('do not add inactive null or empty fields');
  expect(verificationAgentInstructions).toContain('For accepted, return claimEvidenceBundles');
  expect(verificationAgentInstructions).toContain(
    'For rejected, return contradictionEvidenceSelections',
  );
  expect(verificationAgentInstructions).toContain('For incomplete, return the closed reasonCode');
});

test('keeps discovery source-inspected but free of canonical role selection', () => {
  expect(investigationAgentInstructions).toContain(
    'not operation or unsafe-condition evidence selections',
  );
  expect(investigationAgentInstructions).toContain(
    'canonical grounding independently selects those roles',
  );
});

test('requires grounding to independently select role evidence from its same-obligation map basis', () => {
  expect(candidateGroundingAgentInstructions).toContain(
    'Discovery does not select either claim role',
  );
  expect(candidateGroundingAgentInstructions).toContain(
    'select every valid same-obligation map item that directly establishes the operation or unsafe-condition relation',
  );
  expect(candidateGroundingAgentInstructions).toContain(
    'Never select a fact from another approved obligation',
  );
});
