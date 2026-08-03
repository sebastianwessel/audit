/**
 * Shared mandatory protocol cue for every source-deciding agent. This is not a
 * security heuristic: the lifecycle still verifies observed tool use and
 * fails closed when a model ignores the requirement.
 */
export const scopedInspectionFirstActionInstruction =
  'FIRST ACTION: when inspectionRequirement.required is true, call repo_read or repo_grep before considering a response. The supplied map, posture, context, and path manifest never satisfy this requirement by themselves. A direct terminal object is invalid and will be rejected. Only repo_read and repo_grep satisfy inspectionRequirement; repo_list does not.';
