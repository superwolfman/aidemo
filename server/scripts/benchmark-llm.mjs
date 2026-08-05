import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(rootDir, '.env') });

const apiKey = process.env.DASHSCOPE_API_KEY;
const baseUrl = process.env.LLM_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const provider = process.env.LLM_PROVIDER || 'dashscope';

if (provider !== 'dashscope') {
    console.error(`当前 LLM_PROVIDER=${provider}，本脚本只用于测试 dashscope。`);
    process.exit(1);
}
if (!apiKey) {
    console.error('未找到 DASHSCOPE_API_KEY，请检查 .env。');
    process.exit(1);
}

const args = process.argv.slice(2);
const requestedModels = args
    .filter((arg) => arg.startsWith('--model='))
    .map((arg) => arg.replace('--model=', ''));

const models = requestedModels.length > 0
    ? requestedModels
    : ['qwen3.5-flash-2026-02-23', 'qwen-plus-2025-07-28', 'qwen3.7-plus'];

const prompt = `请用中文简要介绍你自己，包括模型版本、擅长场景，控制在 200 字以内。`;
const messages = [
    { role: 'system', content: '你是通义千问，一个有帮助的助手。' },
    { role: 'user', content: prompt }
];

function normalizeBaseUrl (url) {
    return String(url || '').replace(/\/$/, '');
}

function sleep (ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function benchmarkNonStream (model) {
    const url = `${normalizeBaseUrl(baseUrl)}/chat/completions`;
    const startedAt = Date.now();
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model,
            temperature: 0.2,
            messages
        })
    });
    const firstByteAt = Date.now();
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const payload = await res.json();
    const text = payload?.choices?.[0]?.message?.content || '';
    const finishedAt = Date.now();
    return {
        ttfbMs: firstByteAt - startedAt,
        totalMs: finishedAt - startedAt,
        chars: text.length,
        charsPerSecond: Math.round((text.length / Math.max(1, finishedAt - startedAt)) * 1000),
        textPreview: text.slice(0, 80).replace(/\s+/g, ' ')
    };
}

async function benchmarkStream (model) {
    const url = `${normalizeBaseUrl(baseUrl)}/chat/completions`;
    const startedAt = Date.now();
    let firstDeltaAt = null;
    let text = '';

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model,
            temperature: 0.2,
            stream: true,
            messages
        })
    });

    if (!res.ok || !res.body) {
        const detail = await res.text();
        throw new Error(`HTTP ${res.status}: ${detail.slice(0, 200)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() || '';

        for (const frame of frames) {
            const lines = frame.split('\n').map((line) => line.trim()).filter(Boolean);
            for (const line of lines) {
                if (!line.startsWith('data:')) continue;
                const raw = line.replace(/^data:\s*/, '');
                if (raw === '[DONE]') continue;
                const payload = JSON.parse(raw);
                const delta = payload?.choices?.[0]?.delta?.content || '';
                if (delta) {
                    if (firstDeltaAt === null) firstDeltaAt = Date.now();
                    text += delta;
                }
            }
        }
    }

    const finishedAt = Date.now();
    return {
        ttfbMs: (firstDeltaAt || finishedAt) - startedAt,
        totalMs: finishedAt - startedAt,
        chars: text.length,
        charsPerSecond: Math.round((text.length / Math.max(1, finishedAt - startedAt)) * 1000),
        textPreview: text.slice(0, 80).replace(/\s+/g, ' ')
    };
}

async function run () {
    console.log('================================================');
    console.log('DashScope LLM 速度对比单测');
    console.log(`基准 URL: ${baseUrl.replace(/\/\/([^:@]+):([^@]+)@/, '//***:***@')}`);
    console.log(`测试模型: ${models.join(', ')}`);
    console.log(`提示词: ${prompt}`);
    console.log('================================================\n');

    for (const model of models) {
        console.log(`\n[${model}] 非流式测试...`);
        try {
            const nonStream = await benchmarkNonStream(model);
            console.log(`  首字节(TTFB): ${nonStream.ttfbMs} ms`);
            console.log(`  总耗时:       ${nonStream.totalMs} ms`);
            console.log(`  生成字符:     ${nonStream.chars}`);
            console.log(`  平均吞吐:     ${nonStream.charsPerSecond} chars/s`);
            console.log(`  预览:         ${nonStream.textPreview}...`);
        } catch (error) {
            console.error(`  非流式失败: ${error.message}`);
        }

        await sleep(500);

        console.log(`\n[${model}] 流式测试...`);
        try {
            const stream = await benchmarkStream(model);
            console.log(`  首个 delta:   ${stream.ttfbMs} ms`);
            console.log(`  总耗时:       ${stream.totalMs} ms`);
            console.log(`  生成字符:     ${stream.chars}`);
            console.log(`  平均吞吐:     ${stream.charsPerSecond} chars/s`);
            console.log(`  预览:         ${stream.textPreview}...`);
        } catch (error) {
            console.error(`  流式失败: ${error.message}`);
        }

        await sleep(1000);
    }

    console.log('\n================================================');
    console.log('提示：');
    console.log('- 首个 delta 时间 > 10s 通常说明模型排队严重或免费额度受限。');
    console.log('- 通常 Flash < Plus < Max/3.7-plus，速度递减、质量递增；免费 tier 排队会进一步放大差距。');
    console.log('- 运行脚本时仍会消耗 DashScope token 额度，请留意余额。');
    console.log('================================================');
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
