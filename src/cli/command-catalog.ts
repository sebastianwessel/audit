import {
  commandOptionNames,
  isProductCliCommand,
  type ProductCliCommand,
  productCliCommands,
  requiredCommandOptionNames,
} from './command-options.js';

const descriptions = {
  plan: 'Create a sealed, executable audit plan from a source repository.',
  'plan-draft': 'Create a constrained editable draft from one sealed plan.',
  'plan-reseal': 'Validate a draft and publish a new sealed plan pair.',
  audit: 'Execute a matching sealed plan and publish its report artifacts.',
  guidance: 'Create non-gating developer guidance for accepted report findings.',
  discard: 'Discard one exact stopped audit run from private work only.',
  lock: 'Inspect or explicitly release one known-abandoned product private-work lease.',
  report: 'Render one validated report as Markdown.',
  lineage: 'Compare two validated reports using exact finding identity.',
} satisfies Record<ProductCliCommand, string>;

const examples = {
  plan: 'audit plan --target ./repository',
  'plan-draft': 'audit plan-draft --plan plans/<plan-id>.json --draft plan-drafts/review.json',
  'plan-reseal': 'audit plan-reseal --plan plans/<plan-id>.json --draft plan-drafts/review.json',
  audit: 'audit audit --target ./repository --plan plans/<plan-id>.json',
  guidance:
    'audit guidance --target ./repository --plan plans/<plan-id>.json --report reports/<report-id>.json',
  discard: 'audit discard --plan plans/<plan-id>.json --run-id audit-<run-id>',
  lock: 'audit lock --run-id audit-<run-id>',
  report: 'audit report --report reports/<report-id>.json',
  lineage: 'audit lineage --previous reports/<previous>.json --current reports/<current>.json',
} satisfies Record<ProductCliCommand, string>;

/**
 * Human-facing meanings for every accepted CLI option. The command schemas
 * remain the authority for validation; rendering fails loudly if a schema
 * gains an option without its user-facing explanation.
 */
const optionDescriptions = {
  plan: {
    context: 'Directory of optional Markdown context documents about the system around the target.',
    'result-format': 'Use `json` for a machine-readable command result.',
    resume: 'Use `true` only to finish a previously interrupted plan publication.',
    'run-id': 'Plan run identity; required together with `--resume true`.',
    target: 'Root directory of the repository to inspect.',
    'target-name': 'Human-readable target label shown in plan artifacts.',
  },
  'plan-draft': {
    draft: 'New private-work path for the editable JSON draft to create.',
    plan: 'Private-work path of the sealed plan JSON to edit.',
    'result-format': 'Use `json` for a machine-readable command result.',
  },
  'plan-reseal': {
    draft: 'Private-work path of the edited JSON draft to validate and reseal.',
    plan: 'Private-work path of the sealed plan JSON the draft was created from.',
    'result-format': 'Use `json` for a machine-readable command result.',
    resume: 'Use `true` only to finish a previously interrupted reseal publication.',
    'run-id': 'Reseal run identity; required together with `--resume true`.',
  },
  audit: {
    context: 'Directory of optional Markdown context documents bound to the plan target.',
    plan: 'Private-work path of the matching sealed plan JSON to execute.',
    'result-format': 'Use `json` for a machine-readable command result.',
    resume: 'Use `true` to resume the exact stopped audit run named by `--run-id`.',
    'retry-unfinished': 'Use `true` with resume to retry explicitly unfinished stage work.',
    'run-id': 'Audit run identity; required when resuming an existing run.',
    target: 'Root directory of the repository that matches the sealed plan.',
    'target-name': 'Human-readable target label shown in report artifacts.',
  },
  guidance: {
    context: 'Directory of optional Markdown context documents bound to the plan target.',
    plan: 'Private-work path of the matching sealed plan JSON.',
    report: 'Public-artifact path of the accepted report JSON to explain.',
    'result-format': 'Use `json` for a machine-readable command result.',
    resume: 'Use `true` to resume the exact stopped guidance run named by `--run-id`.',
    'retry-unfinished': 'Use `true` with resume to retry explicitly unfinished guidance work.',
    'run-id': 'Guidance run identity; required when resuming an existing run.',
    target: 'Root directory of the repository that matches the sealed plan.',
    'target-name': 'Human-readable target label shown in guidance artifacts.',
  },
  discard: {
    plan: 'Private-work path of the sealed plan bound to the stopped audit run.',
    'result-format': 'Use `json` for a machine-readable command result.',
    'run-id': 'Exact stopped audit run identity to discard from private work.',
  },
  lock: {
    operation: 'Required confirmation of the locked operation when releasing a lease.',
    release: 'Use `true` with `--operation` to release the exact known-abandoned lease.',
    'result-format': 'Use `json` for a machine-readable command result.',
    'run-id': 'Identity of the private-work lease to inspect or release.',
  },
  report: {
    report: 'Public-artifact path of the validated report JSON to render as Markdown.',
    'result-format': 'Use `json` for a machine-readable command result.',
  },
  lineage: {
    current: 'Public-artifact path of the newer validated report JSON.',
    previous: 'Public-artifact path of the earlier validated report JSON.',
    'result-format': 'Use `json` for a machine-readable command result.',
  },
} satisfies Record<ProductCliCommand, Readonly<Record<string, string>>>;

function commandUsage(command: ProductCliCommand): string {
  const required = requiredCommandOptionNames(command).map((option) => `--${option} <value>`);
  const optional = commandOptionNames(command)
    .filter((option) => !requiredCommandOptionNames(command).includes(option))
    .map((option) => `[--${option} <value>]`);
  return `audit ${command} ${[...required, ...optional].join(' ')}`.trim();
}

function optionDescription(command: ProductCliCommand, option: string): string {
  const descriptionsForCommand: Readonly<Record<string, string>> = optionDescriptions[command];
  const description = descriptionsForCommand[option];
  if (description === undefined) {
    throw new Error(`Missing CLI help description for ${command} --${option}.`);
  }
  return description;
}

export function renderCliHelp(command?: ProductCliCommand | null): string {
  if (command !== undefined && command !== null) {
    const required = new Set(requiredCommandOptionNames(command));
    const options = commandOptionNames(command).map(
      (option) =>
        `- \`--${option} <value>\` — ${required.has(option) ? 'Required.' : 'Optional.'} ${optionDescription(command, option)}`,
    );
    return [
      `# audit ${command}`,
      '',
      descriptions[command],
      '',
      'Usage:',
      '',
      `\`${commandUsage(command)}\``,
      '',
      'Options:',
      '',
      ...options,
      '',
      'Example:',
      '',
      `\`${examples[command]}\``,
      '',
      'Run `audit --help` to list commands.',
      '',
    ].join('\n');
  }

  return [
    '# audit',
    '',
    'Read-only, language-neutral static security audit planning and execution.',
    '',
    'Commands:',
    '',
    ...productCliCommands.map((entry) => `- \`${entry}\` — ${descriptions[entry]}`),
    '',
    'Use `audit help <command>` or `audit <command> --help` for exact options.',
    '',
  ].join('\n');
}

export function parseHelpRequest(argv: readonly string[]): ProductCliCommand | null | undefined {
  const [first, second, ...remaining] = argv;
  if (remaining.length > 0) return undefined;
  if (first === '--help' || first === '-h') return second === undefined ? null : undefined;
  if (first === 'help') {
    if (second === undefined) return null;
    return isProductCliCommand(second) ? second : undefined;
  }
  if (
    first !== undefined &&
    isProductCliCommand(first) &&
    (second === '--help' || second === '-h')
  ) {
    return first;
  }
  return undefined;
}
