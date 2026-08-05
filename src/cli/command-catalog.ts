import {
  commandOptionNames,
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

export function isProductCliCommand(value: string): value is ProductCliCommand {
  return productCliCommands.includes(value as ProductCliCommand);
}

function commandUsage(command: ProductCliCommand): string {
  const required = requiredCommandOptionNames(command).map((option) => `--${option} <value>`);
  const optional = commandOptionNames(command)
    .filter((option) => !requiredCommandOptionNames(command).includes(option))
    .map((option) => `[--${option} <value>]`);
  return `audit ${command} ${[...required, ...optional].join(' ')}`.trim();
}

export function renderCliHelp(command?: ProductCliCommand | null): string {
  if (command !== undefined && command !== null) {
    const required = new Set(requiredCommandOptionNames(command));
    const options = commandOptionNames(command).map(
      (option) => `- \`--${option}\` — ${required.has(option) ? 'required' : 'optional'}.`,
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
