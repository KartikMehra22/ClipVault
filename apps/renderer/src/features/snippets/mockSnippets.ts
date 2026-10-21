export interface DemonstrationSnippet {
  id: string;
  title: string;
  category: string;
  description: string;
  content: string;
  tags: string[];
}

export const DEMO_SNIPPETS: DemonstrationSnippet[] = [
  {
    id: 'snip-1',
    title: 'Git Commit Formatter',
    category: 'Development',
    description: 'Conventional commit message template for features and fixes.',
    content:
      'feat(desktop): isolate IPC security verification\n\n- Remove startup self-tests\n- Extract pure validation helper',
    tags: ['git', 'workflow', 'vcs'],
  },
  {
    id: 'snip-2',
    title: 'SQL Read-Only Transaction',
    category: 'Database',
    description: 'Safe read-only transaction block with snapshot isolation.',
    content:
      'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSELECT id, content, created_at FROM clips ORDER BY created_at DESC LIMIT 50;\nCOMMIT;',
    tags: ['sql', 'database', 'postgres'],
  },
  {
    id: 'snip-3',
    title: 'React Client Hook Guard',
    category: 'React',
    description: 'Defensive mounting guard for asynchronous browser effects.',
    content:
      'useEffect(() => {\n  let isMounted = true;\n  async function load() {\n    const data = await fetchData();\n    if (isMounted) setState(data);\n  }\n  load();\n  return () => { isMounted = false; };\n}, []);',
    tags: ['react', 'typescript', 'hook'],
  },
  {
    id: 'snip-4',
    title: 'JSON API Health Response',
    category: 'Backend',
    description: 'Standard RFC-compliant health check JSON payload.',
    content:
      '{\n  "status": "healthy",\n  "timestamp": "2026-10-21T05:30:00Z",\n  "services": {\n    "database": "connected",\n    "ipc": "ready"\n  }\n}',
    tags: ['json', 'api', 'monitoring'],
  },
];
