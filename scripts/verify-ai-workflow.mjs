import { spawnSync } from 'node:child_process';

const checks = [
  ['Client lint', 'npm', ['--prefix', 'client', 'run', 'lint']],
  ['Client typecheck', 'npm', ['--prefix', 'client', 'run', 'typecheck']],
  ['Client build', 'npm', ['--prefix', 'client', 'run', 'build']],
  ['Server route syntax', 'node', ['--check', 'server/src/routes/copilot.js']],
  ['Agent runtime route syntax', 'node', ['--check', 'server/src/routes/agentStudio.js']],
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
