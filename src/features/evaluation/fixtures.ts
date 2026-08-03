import { type EvaluationPack, EvaluationPackSchema } from './evaluation.schema.js';

export const starterFixturePack: EvaluationPack = EvaluationPackSchema.parse({
  schemaVersion: 1,
  packId: 'starter-static-pack',
  packVersion: '1.1.0',
  cases: [
    {
      schemaVersion: 1,
      caseId: 'ts-unsafe-query',
      variant: 'vulnerable',
      language: 'typescript',
      difficulty: 'easy',
      sources: [
        {
          path: 'src/query.ts',
          languageHint: 'typescript',
          content: String.raw`const sql = \`SELECT * FROM users WHERE id = '\${userId}'\`;`,
        },
      ],
      expectedFindings: [
        {
          path: 'src/query.ts',
          startLine: 1,
          endLine: 1,
          locationTolerance: 0,
        },
      ],
      adjudicationNotes: 'The query is built with an interpolated user-controlled value.',
    },
    {
      schemaVersion: 1,
      caseId: 'ts-parameterized-query',
      variant: 'fixed',
      language: 'typescript',
      difficulty: 'easy',
      sources: [
        {
          path: 'src/query.ts',
          languageHint: 'typescript',
          content: "const result = db.query('SELECT * FROM users WHERE id = ?', [userId]);",
        },
      ],
      expectedFindings: [],
      adjudicationNotes: 'The query uses a parameter binding rather than string construction.',
    },
    {
      schemaVersion: 1,
      caseId: 'ts-guarded-file-read',
      variant: 'benign',
      language: 'typescript',
      difficulty: 'medium',
      sources: [
        {
          path: 'src/files.ts',
          languageHint: 'typescript',
          content:
            "const allowed = new Set(['readme.md']);\nconst fileName = allowed.has(input) ? input : 'readme.md';\nreturn readFile(fileName);",
        },
      ],
      expectedFindings: [],
      adjudicationNotes: 'The helper uses an explicit allowlist before reading a file.',
    },
    {
      schemaVersion: 1,
      caseId: 'python-hard-coded-secret',
      variant: 'vulnerable',
      language: 'python',
      difficulty: 'easy',
      sources: [
        { path: 'app/settings.py', languageHint: 'python', content: 'API_KEY = "abcdefghijk"' },
      ],
      expectedFindings: [
        {
          path: 'app/settings.py',
          startLine: 1,
          endLine: 1,
          locationTolerance: 0,
        },
      ],
      adjudicationNotes: 'A reusable credential-like literal is embedded in source.',
    },
    {
      schemaVersion: 1,
      caseId: 'java-sensitive-log',
      variant: 'vulnerable',
      language: 'java',
      difficulty: 'medium',
      sources: [
        { path: 'src/App.java', languageHint: 'java', content: 'logger.info(customerEmail);' },
      ],
      expectedFindings: [
        {
          path: 'src/App.java',
          startLine: 1,
          endLine: 1,
          locationTolerance: 0,
        },
      ],
      adjudicationNotes: 'A customer identifier is passed to a logging sink.',
    },
    {
      schemaVersion: 1,
      caseId: 'go-untrusted-file-path',
      variant: 'vulnerable',
      language: 'go',
      difficulty: 'medium',
      sources: [
        { path: 'internal/read.go', languageHint: 'go', content: 'return readFile(req.path)' },
      ],
      expectedFindings: [
        {
          path: 'internal/read.go',
          startLine: 1,
          endLine: 1,
          locationTolerance: 0,
        },
      ],
      adjudicationNotes: 'Request-derived input reaches a filesystem read helper.',
    },
    {
      schemaVersion: 1,
      caseId: 'python-unsafe-deserialization',
      variant: 'vulnerable',
      language: 'python',
      difficulty: 'hard',
      sources: [
        {
          path: 'app/imports.py',
          languageHint: 'python',
          content: 'payload = pickle.loads(input)',
        },
      ],
      expectedFindings: [
        {
          path: 'app/imports.py',
          startLine: 1,
          endLine: 1,
          locationTolerance: 0,
        },
      ],
      adjudicationNotes: 'An unsafe object deserializer is used on input.',
    },
    {
      schemaVersion: 1,
      caseId: 'typescript-untrusted-outbound-url',
      variant: 'vulnerable',
      language: 'typescript',
      difficulty: 'hard',
      sources: [
        {
          path: 'src/proxy.ts',
          languageHint: 'typescript',
          content: 'await fetch(req.query.url);',
        },
      ],
      expectedFindings: [
        {
          path: 'src/proxy.ts',
          startLine: 1,
          endLine: 1,
          locationTolerance: 0,
        },
      ],
      adjudicationNotes: 'Request input reaches an outbound request API.',
    },
    {
      schemaVersion: 1,
      caseId: 'java-weak-crypto',
      variant: 'vulnerable',
      language: 'java',
      difficulty: 'easy',
      sources: [
        { path: 'src/Digest.java', languageHint: 'java', content: 'String algorithm = "md5";' },
      ],
      expectedFindings: [
        {
          path: 'src/Digest.java',
          startLine: 1,
          endLine: 1,
          locationTolerance: 0,
        },
      ],
      adjudicationNotes: 'A legacy digest primitive is explicitly selected.',
    },
    {
      schemaVersion: 1,
      caseId: 'ruby-verification-disabled',
      variant: 'vulnerable',
      language: 'ruby',
      difficulty: 'medium',
      sources: [{ path: 'app/token.rb', languageHint: 'ruby', content: 'verifyToken: false' }],
      expectedFindings: [
        {
          path: 'app/token.rb',
          startLine: 1,
          endLine: 1,
          locationTolerance: 0,
        },
      ],
      adjudicationNotes: 'A verification control is explicitly disabled.',
    },
    {
      schemaVersion: 1,
      caseId: 'php-input-object-lookup',
      variant: 'vulnerable',
      language: 'php',
      difficulty: 'hard',
      sources: [
        { path: 'src/user.php', languageHint: 'php', content: 'findById(req.params.userId)' },
      ],
      expectedFindings: [
        {
          path: 'src/user.php',
          startLine: 1,
          endLine: 1,
          locationTolerance: 0,
        },
      ],
      adjudicationNotes:
        'A request-derived identifier reaches an object lookup that requires ownership review.',
    },
    {
      schemaVersion: 1,
      caseId: 'shell-remote-install',
      variant: 'vulnerable',
      language: 'shell',
      difficulty: 'medium',
      sources: [
        {
          path: 'scripts/setup.sh',
          languageHint: 'shell',
          content: 'curl https://example.test/install | sh',
        },
      ],
      expectedFindings: [
        {
          path: 'scripts/setup.sh',
          startLine: 1,
          endLine: 1,
          locationTolerance: 0,
        },
      ],
      adjudicationNotes: 'A remotely fetched script is directly executed.',
    },
    {
      schemaVersion: 1,
      caseId: 'typescript-input-amount',
      variant: 'vulnerable',
      language: 'typescript',
      difficulty: 'hard',
      sources: [
        {
          path: 'src/checkout.ts',
          languageHint: 'typescript',
          content: 'amount = req.body.amount;',
        },
      ],
      expectedFindings: [
        {
          path: 'src/checkout.ts',
          startLine: 1,
          endLine: 1,
          locationTolerance: 0,
        },
      ],
      adjudicationNotes: 'An authoritative value appears to be derived directly from a request.',
    },
  ],
});
