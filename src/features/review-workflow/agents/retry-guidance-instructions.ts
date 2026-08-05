/**
 * Shared model-facing explanation for the content-free retry contract. Every
 * stage owns its task semantics, while this module owns only how a retried
 * stage must interpret the closed retry-guidance field.
 */
export const retryGuidanceInstruction = `Read retryGuidance before responding. initial means produce the normal strict output. output-validation means recreate one complete output for the same exact scope while correcting the named schema-path fields; it contains no rejected values, source details, or prior model output. source-inspection means the prior completion did not complete the required scoped read/search action, so inspect the same allowed scope before returning. Never broaden scope, invent source evidence, repeat rejected content, or treat retry guidance as a new security conclusion.`;
