import { expect, test } from 'bun:test';

import { candidateGroundingAgentInstructions } from './candidate-grounding/instructions.js';
import { countercheckAgentInstructions } from './countercheck/instructions.js';
import { evidenceMapAgentInstructions } from './evidence-map/instructions.js';
import { investigationAgentInstructions } from './investigation/instructions.js';
import { scopedInspectionFirstActionInstruction } from './scoped-inspection-instructions.js';
import { sourcePostureAgentInstructions } from './source-posture/instructions.js';
import { verificationAgentInstructions } from './verification/instructions.js';

test('gives every source-deciding agent one shared mandatory first-action instruction', () => {
  for (const instructions of [
    evidenceMapAgentInstructions,
    sourcePostureAgentInstructions,
    investigationAgentInstructions,
    candidateGroundingAgentInstructions,
    verificationAgentInstructions,
    countercheckAgentInstructions,
  ]) {
    expect(instructions).toContain(scopedInspectionFirstActionInstruction);
    expect(instructions).toContain('FIRST ACTION');
  }
});
