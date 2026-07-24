import { config } from '../config.js';

const providerDefaults = {
    openai: {
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4.1-mini'
    },
    deepseek: {
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat'
    },
    dashscope: {
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: 'qwen-plus'
    },
    'openai-compatible': {
        baseUrl: '',
        model: ''
    }
};

const modelPresets = [
    { id: 'deepseek-chat', label: 'DeepSeek Chat', provider: 'deepseek', model: 'deepseek-chat', description: '通用对话、研发问答、RAG 总结' },
    { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner', provider: 'deepseek', model: 'deepseek-reasoner', description: '复杂推理、架构权衡、长链路分析' },
    { id: 'qwen-plus', label: 'Qwen Plus', provider: 'dashscope', model: 'qwen-plus', description: '中文业务分析、文档生成' },
    { id: 'qwen-turbo', label: 'Qwen Turbo', provider: 'dashscope', model: 'qwen-turbo', description: '低成本快速生成' },
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', provider: 'openai', model: 'gpt-4.1-mini', description: '代码、工具调用、结构化输出' },
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini', provider: 'openai', model: 'gpt-4o-mini', description: '轻量多场景模型' }
];

function normalizeBaseUrl (baseUrl) {
    return String(baseUrl || '').replace(/\/$/, '');
}

function providerKey (provider) {
    return config.llmApiKeys?.[provider] || '';
}

function resolveProvider (override = {}) {
    const provider = override.provider || config.llmProvider;
    const defaults = providerDefaults[provider] || providerDefaults['openai-compatible'];
    const baseUrl = normalizeBaseUrl(override.baseUrl || config.llmBaseUrl || defaults.baseUrl);
    const model = override.model || config.llmModel || defaults.model;
    const apiKey = providerKey(provider);
    const configured = provider !== 'mock' && Boolean(apiKey && baseUrl && model);

    return {
        provider,
        mode: configured ? 'live' : 'fallback',
        baseUrl: configured ? baseUrl.replace(/\/v1\/?$/, '/v1') : '',
        model: configured ? model : 'deterministic-local-runtime',
        requestedModel: model,
        configured,
        apiKey,
        protocol: configured ? 'openai-compatible-chat-completions' : 'local-deterministic',
        streaming: configured
    };
}

function buildMessages ({ systemPrompt, prompt, sources, toolResults }) {
    const safeSources = Array.isArray(sources) ? sources : [];
    const safeToolResults = toolResults && typeof toolResults === 'object' ? toolResults : {};

    const context = safeSources
        .map((source, index) => `[${index + 1}] ${source.documentTitle || source.title || 'unknown'}: ${source.content || ''}`)
        .join('\n');
    const toolText = JSON.stringify(safeToolResults, null, 2);

    return [
        {
            role: 'system',
            content: `${systemPrompt}
你必须基于引用资料、工具结果和用户输入回答。输出 Markdown，明确列出架构判断、风险、下一步和引用来源。若引用资料不足，需要明确说明缺口，不能编造来源。`
        },
        {
            role: 'user',
            content: `用户请求:
${prompt}

RAG 引用:
${context || '无'}

工具结果:
${toolText}`
        }
    ];
}

export function getProviderStatus (override = {}) {
    const resolved = resolveProvider(override);
    return {
        provider: resolved.provider,
        mode: resolved.mode,
        baseUrl: resolved.baseUrl,
        model: resolved.model,
        requestedModel: resolved.requestedModel,
        configured: resolved.configured,
        protocol: resolved.protocol,
        streaming: resolved.streaming
    };
}

export function getModelPresets () {
    return modelPresets.map((preset) => ({
        ...preset,
        configured: Boolean(providerKey(preset.provider)),
        active: preset.provider === config.llmProvider && preset.model === (config.llmModel || providerDefaults[preset.provider]?.model)
    }));
}

export async function generateLlmAnswer ({ systemPrompt, prompt, sources = [], toolResults = {}, fallback = '', modelConfig = {} }) {
    const resolved = resolveProvider(modelConfig);
    const status = getProviderStatus(modelConfig);
    if (!status.configured) {
        return {
            provider: status,
            text: fallback
        };
    }

    const response = await fetch(`${normalizeBaseUrl(status.baseUrl)}/chat/completions`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${resolved.apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: status.model,
            temperature: 0.2,
            messages: buildMessages({ systemPrompt, prompt, sources, toolResults })
        })
    });

    if (!response.ok) {
        const detail = await response.text();
        throw new Error(`LLM provider failed: ${response.status} ${detail.slice(0, 240)}`);
    }

    const payload = await response.json();
    const text = payload?.choices?.[0]?.message?.content;
    return {
        provider: status,
        text: typeof text === 'string' && text.trim() ? text : fallback
    };
}

export async function streamLlmAnswer ({ systemPrompt, prompt, sources = [], toolResults = {}, onDelta, modelConfig = {} }) {
    const resolved = resolveProvider(modelConfig);
    const status = getProviderStatus(modelConfig);
    if (!status.configured) {
        return {
            provider: status,
            streamed: false,
            text: ''
        };
    }

    const response = await fetch(`${normalizeBaseUrl(status.baseUrl)}/chat/completions`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${resolved.apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: status.model,
            temperature: 0.2,
            stream: true,
            messages: buildMessages({ systemPrompt, prompt, sources, toolResults })
        })
    });

    if (!response.ok || !response.body) {
        const detail = await response.text();
        throw new Error(`LLM provider stream failed: ${response.status} ${detail.slice(0, 240)}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';

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
                if (raw === '[DONE]') {
                    return { provider: status, streamed: true, text };
                }
                const payload = JSON.parse(raw);
                const delta = payload?.choices?.[0]?.delta?.content || '';
                if (delta) {
                    text += delta;
                    await onDelta?.(delta);
                }
            }
        }
    }

    return { provider: status, streamed: true, text };
}