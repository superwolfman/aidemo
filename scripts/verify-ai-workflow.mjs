import { spawnSync } from 'node:child_process';

const checks = [
  ['Client lint', 'npm', ['run', 'lint', '--workspace', 'client']],
  ['Client typecheck', 'npm', ['run', 'typecheck', '--workspace', 'client']],
  ['Client build', 'npm', ['run', 'build', '--workspace', 'client']],
  ['Server route syntax', 'node', ['--check', 'server/src/routes/copilot.js']],
  ['LLM provider syntax', 'node', ['--check', 'server/src/services/llmProvider.js']],
  ['RAG engine syntax', 'node', ['--check', 'server/src/services/ragEngine.js']]
];

for (const [name, command, args] of checks) {
  console.log(`\n[verify] ${name}`);
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false });
  if (result.status !== 0) {
    console.error(`\n[verify] failed: ${name}`);
    process.exit(result.status || 1);
  }
}

console.log('\n[verify] AI workflow demo checks passed.');
