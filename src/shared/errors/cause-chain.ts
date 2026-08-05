/**
 * Traverses wrapped errors without reading their messages or metadata. Both
 * runtime normalization and evaluator-private diagnostics use this one walk
 * so an AggregateError cannot receive contradictory classifications.
 */
export function errorCauseChain(error: unknown): readonly unknown[] {
  const causes: unknown[] = [];
  const seen = new Set<object>();
  const pending: unknown[] = [error];
  while (pending.length > 0) {
    const current = pending.shift();
    if (typeof current !== 'object' || current === null || seen.has(current)) continue;
    causes.push(current);
    seen.add(current);
    if ('cause' in current) pending.push(current.cause);
    if (current instanceof AggregateError) pending.push(...current.errors);
  }
  return causes;
}
