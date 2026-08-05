/**
 * Removes duplicates and orders string identifiers deterministically for
 * persisted artifacts, fingerprints, and human-readable summaries.
 */
export function uniqueSorted<TValue extends string>(values: readonly TValue[]): TValue[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
