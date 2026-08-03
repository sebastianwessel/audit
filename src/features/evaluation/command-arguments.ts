import { SecurityReviewerError } from '../../shared/errors/security-reviewer-error.js';

/**
 * Parses the deliberately small evaluation CLI grammar. A leading Bun argument
 * separator is accepted, but every remaining value must be a unique --key value pair.
 */
export function parseEvaluationOptionPairs(
  argv: readonly string[],
): Readonly<Record<string, string>> {
  const argumentsWithoutSeparator = argv[0] === '--' ? argv.slice(1) : argv;
  const values: Record<string, string> = {};
  for (let index = 0; index < argumentsWithoutSeparator.length; index += 2) {
    const key = argumentsWithoutSeparator[index];
    const value = argumentsWithoutSeparator[index + 1];
    if (
      key === undefined ||
      value === undefined ||
      !key.startsWith('--') ||
      key.length < 3 ||
      values[key.slice(2)] !== undefined
    ) {
      throw invalidOptionPairs();
    }
    values[key.slice(2)] = value;
  }
  return Object.freeze(values);
}

function invalidOptionPairs(): SecurityReviewerError {
  return new SecurityReviewerError(
    'invalid-input',
    'Evaluation options must be unique --key value pairs.',
  );
}
