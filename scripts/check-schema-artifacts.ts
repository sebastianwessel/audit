import { assertSchemaArtifactsCurrent } from './schema-artifacts.js';

await assertSchemaArtifactsCurrent('artifacts/schemas');
process.stdout.write('Generated schema artifacts are current.\n');
