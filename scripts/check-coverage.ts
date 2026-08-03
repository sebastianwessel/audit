const minimumPercent = 80;
const lcov = await Bun.file('coverage/lcov.info').text();
let coveredLines = 0;
let totalLines = 0;
let coveredFunctions = 0;
let totalFunctions = 0;

for (const line of lcov.split('\n')) {
  if (line.startsWith('LH:')) coveredLines += parseCount(line, 'LH:');
  if (line.startsWith('LF:')) totalLines += parseCount(line, 'LF:');
  if (line.startsWith('FNH:')) coveredFunctions += parseCount(line, 'FNH:');
  if (line.startsWith('FNF:')) totalFunctions += parseCount(line, 'FNF:');
}

const linePercent = ratio(coveredLines, totalLines);
const functionPercent = ratio(coveredFunctions, totalFunctions);
if (linePercent < minimumPercent || functionPercent < minimumPercent) {
  throw new Error(
    `Coverage gate failed: lines ${linePercent.toFixed(2)}%, functions ${functionPercent.toFixed(2)}%; minimum is ${minimumPercent}%.`,
  );
}
process.stdout.write(
  `Coverage gate passed: lines ${linePercent.toFixed(2)}%, functions ${functionPercent.toFixed(2)}%.\n`,
);

function parseCount(line: string, prefix: string): number {
  const value = Number(line.slice(prefix.length));
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid LCOV count: ${line}`);
  return value;
}

function ratio(covered: number, total: number): number {
  if (total === 0) throw new Error('LCOV report contains no measurable coverage.');
  return (covered / total) * 100;
}
