export const CanonicalPersistedArtifactVersions = [
  {
    artifact: 'Attack plan',
    version: 4,
    sourcePath: 'src/features/attack-planning/plan/plan.schema.ts',
    schemaName: 'AttackPlanSchema',
  },
  {
    artifact: 'Audit report',
    version: 21,
    sourcePath: 'src/features/audit-execution/audit.schema.ts',
    schemaName: 'AuditReportSchema',
  },
  {
    artifact: 'Audit vector checkpoint',
    version: 17,
    sourcePath: 'src/features/audit-execution/audit.schema.ts',
    schemaName: 'AuditVectorCheckpointSchema',
  },
  {
    artifact: 'Candidate-grounding draft',
    version: 11,
    sourcePath: 'src/features/audit-execution/audit.schema.ts',
    schemaName: 'AuditCandidateGroundingDraftSchema',
  },
  {
    artifact: 'Candidate-aware checkpoint',
    version: 5,
    sourcePath: 'src/features/audit-execution/audit.schema.ts',
    schemaName: 'AuditCandidateAwareCheckpointSchema',
  },
  {
    artifact: 'Evidence-map draft',
    version: 5,
    sourcePath: 'src/features/audit-execution/audit.schema.ts',
    schemaName: 'AuditEvidenceMapDraftSchema',
  },
  {
    artifact: 'Source-posture draft',
    version: 4,
    sourcePath: 'src/features/audit-execution/audit.schema.ts',
    schemaName: 'AuditSourcePostureDraftSchema',
  },
  {
    artifact: 'Audit report lineage',
    version: 2,
    sourcePath: 'src/features/audit-lineage/contract.ts',
    schemaName: 'AuditReportLineageSchema',
  },
  {
    artifact: 'Audit run manifest',
    version: 2,
    sourcePath: 'src/features/audit-execution/audit.schema.ts',
    schemaName: 'AuditRunManifestSchema',
  },
  {
    artifact: 'Audit run attempt',
    version: 3,
    sourcePath: 'src/features/audit-execution/audit.schema.ts',
    schemaName: 'AuditRunAttemptSchema',
  },
] as const;

export const CanonicalPersistedArtifactVersionMarker =
  '<!-- spec-check: canonical-persisted-artifact-versions -->';

/** The contributor-facing reading order must expose every top-level spec area. */
export const CanonicalSpecReadingOrderSections = [
  '1. Governance and decisions',
  '2. Scope and workflow',
  '3. Capability inventory',
  '4. System architecture, language-neutral evidence reasoning, and independent-verifier experiment design',
  '5. Artifact contracts',
  '6. Security model',
  '7. Verification and operations',
  '8. Evaluation strategy and reliability',
  '9. Dependency research',
  '10. Readiness and traceability',
] as const;

export function canonicalPersistedArtifactVersionRow(
  artifact: (typeof CanonicalPersistedArtifactVersions)[number],
): string {
  return `| ${artifact.artifact} | ${artifact.version} |`;
}

export function duplicateNumberedSpecPrefixes(paths: readonly string[]): readonly string[] {
  const prefixes = new Map<string, string[]>();
  for (const path of paths) {
    const match = /^(?<directory>.+)\/(?<prefix>\d{2})-[^/]+\.md$/u.exec(path);
    if (match?.groups === undefined) continue;
    const key = `${match.groups.directory}/${match.groups.prefix}`;
    const matchingPaths = prefixes.get(key) ?? [];
    matchingPaths.push(path);
    prefixes.set(key, matchingPaths);
  }
  return [...prefixes.entries()]
    .filter(([, matchingPaths]) => matchingPaths.length > 1)
    .map(([prefix, matchingPaths]) => `${prefix}: ${matchingPaths.sort().join(', ')}`)
    .sort();
}

/** Finds duplicate identifier definitions in one canonical Markdown owner table. */
export function duplicateTableSpecificationIdentifiers(
  content: string,
  prefix: 'CAP' | 'REQ',
): readonly string[] {
  const counts = new Map<string, number>();
  const expression = new RegExp(`^\\|\\s*(${prefix}-\\d{3})\\s*\\|`, 'gmu');
  for (const match of content.matchAll(expression)) {
    const identifier = match[1];
    if (identifier === undefined) continue;
    counts.set(identifier, (counts.get(identifier) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([identifier, count]) => `${identifier} (${count})`)
    .sort();
}

export function strictContractDeclaresVersion(
  artifact: (typeof CanonicalPersistedArtifactVersions)[number],
  source: string,
): boolean {
  const declaration = `export const ${artifact.schemaName} =`;
  const start = source.indexOf(declaration);
  if (start < 0) return false;
  const end = source.indexOf('\nexport const ', start + declaration.length);
  const schemaSource = source.slice(start, end < 0 ? undefined : end);
  return schemaSource.includes(`schemaVersion: z.literal(${artifact.version}),`);
}
