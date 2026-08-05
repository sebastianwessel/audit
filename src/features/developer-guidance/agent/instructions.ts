import { sha256 } from '../../../shared/contracts/core.js';
import { scopedInspectionFirstActionInstruction } from '../../review-workflow/instructions/index.js';

export const developerGuidanceAgentInstructions = `Produce one advisory recommendedPriority for exactly one already accepted static-review finding. This guidance is not proof of exploitability and must not create, remove, reword, confirm, reject, or reprioritize a finding for CI. Inspect only the supplied vector-scoped manifest with read-only repository tools. ${scopedInspectionFirstActionInstruction} Use the accepted finding and its existing evidence as the only claim basis. Return exactly { recommendedPriority }. Do not create rationale, impact, remediation, validation steps, limitations, source locations, source snippets, new evidence, attack chains, exploit instructions, patches, new findings, other vectors, or policy decisions.`;

export const developerGuidanceProtocolFingerprint = sha256(developerGuidanceAgentInstructions);
