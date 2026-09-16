import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentEvalBaselineDataset } from '../src/eval/agentEvalBaselineDataset.js';
import { evaluateAgentBaseline } from '../src/services/agentEvalBaselineService.js';

const currentDir = fileURLToPath(new URL('.', import.meta.url));
const defaultInput = resolve(currentDir, '../eval/fixtures/agent-eval-observations.v1.json');
const inputArg = process.argv.find((arg) => arg.startsWith('--input='));
const inputPath = inputArg ? resolve(process.cwd(), inputArg.slice('--input='.length)) : defaultInput;

const observations = JSON.parse(await readFile(inputPath, 'utf8'));
const baseline = evaluateAgentBaseline({
    cases: agentEvalBaselineDataset,
    observations,
    executionMode: inputArg ? 'observed-run-import' : 'contract-fixture'
});

console.log(JSON.stringify({
    ...baseline,
    input: inputPath,
    note: baseline.executionMode === 'contract-fixture'
        ? '这是可复现的合约基线样例，不代表线上 LLM 质量；使用 --input=<observations.json> 导入真实 Run 观测。'
        : '指标基于导入的 Run 观测计算，请结合 Dataset / Prompt / Skill 版本比较。'
}, null, 2));
