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

export function getProviderStatus() {
  const provider = config.llmProvider;
  const defaults = providerDefaults[provider] || providerDefaults['openai-compatible'];
  const baseUrl = config.llmBaseUrl || defaults.baseUrl;
  const model = config.llmModel || defaults.model;
  const configured = provider !== 'mock' && Boolean(config.llmApiKey && baseUrl && model);

  return {
    provider,
    mode: configured ? 'live' : 'fallback',
    baseUrl: configured ? baseUrl.replace(/\/v1\/?$/, '/v1') : '',
    model: configured ? model : 'deterministic-local-runtime',
    configured
  };
}

export async function generateLlmAnswer({ systemPrompt, prompt, sources, toolResults, fallback }) {
  const status = getProviderStatus();
  if (!status.configured) {
    return {
      provider: status,
      text: fallback
    };
  }

  const context = sources
    .map((source, index) => `[${index + 1}] ${source.documentTitle || source.title}: ${source.content}`)
    .join('\n');
  const toolText = JSON.stringify(toolResults, null, 2);

  const response = await fetch(`${status.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.llmApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: status.model,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: `${systemPrompt}\n你必须基于引用资料、工具结果和用户输入回答。输出 Markdown，明确列出架构判断、风险、下一步和引用来源。`
        },
        {
          role: 'user',
          content: `用户请求:\n${prompt}\n\nRAG 引用:\n${context || '无'}\n\n工具结果:\n${toolText}`
        }
      ]
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
