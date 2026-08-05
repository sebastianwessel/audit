import { describe, expect, test } from 'bun:test';
import { renderCliHelp } from './command-catalog.js';
import { productCliCommands } from './command-options.js';

describe('CLI command catalog', () => {
  test('explains every option accepted by every product command', () => {
    for (const command of productCliCommands) {
      const help = renderCliHelp(command);
      expect(help).toContain('Options:');
      expect(help).not.toContain(' — Required.\n');
      expect(help).not.toContain(' — Optional.\n');
    }
  });

  test('distinguishes private plan paths from public report paths', () => {
    expect(renderCliHelp('audit')).toContain('Private-work path of the matching sealed plan JSON');
    expect(renderCliHelp('guidance')).toContain('Public-artifact path of the accepted report JSON');
  });
});
