import { createStore } from '../store/index.js';
import { retrieveKnowledge } from '../services/ragEngine.js';

function frame(payload) {
  const body = JSON.stringify(payload);
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
}

function ok(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function fail(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function parseFrames(buffer) {
  const messages = [];
  let rest = buffer;

  while (rest.includes('\r\n\r\n')) {
    const separatorIndex = rest.indexOf('\r\n\r\n');
    const header = rest.slice(0, separatorIndex);
    const tail = rest.slice(separatorIndex + 4);
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) break;
    const length = Number(match[1]);
    const byteLength = Buffer.byteLength(tail, 'utf8');
    if (byteLength < length) break;
    const body = tail.slice(0, length);
    messages.push(JSON.parse(body));
    rest = tail.slice(length);
  }

  if (!messages.length && rest.trim().startsWith('{')) {
    const lines = rest.split('\n');
    for (const line of lines) {
      if (line.trim()) messages.push(JSON.parse(line));
    }
    rest = '';
  }

  return { messages, rest };
}

function text(content) {
  return [{ type: 'text', text: content }];
}

async function inspectProjectStructure() {
  return {
    apps: ['client: React/Vite workbench', 'server: Node.js BFF + Agent Runtime'],
    packages: ['skill-runtime', 'tool-registry', 'rag-engine', 'mcp-server-poc'],
    boundaries: [
      'client only renders workflow state and sends user intent',
      'server owns auth, skill constraints, tool execution, RAG retrieval and approval records',
      'MCP server exposes architecture resources/tools/prompts to external AI hosts'
    ]
  };
}

async function handleToolCall(store, name, args = {}) {
  if (name === 'search_architecture_docs') {
    const scopes = Array.isArray(args.scopes) && args.scopes.length ? args.scopes : ['architecture', 'standards'];
    const result = await retrieveKnowledge({ store, query: args.query || '', scopes, limit: args.limit || 5 });
    return {
      content: text(JSON.stringify({ rag: result.status, sources: result.sources }, null, 2))
    };
  }

  if (name === 'inspect_project_structure') {
    return {
      content: text(JSON.stringify(await inspectProjectStructure(), null, 2))
    };
  }

  if (name === 'generate_project_rule') {
    const rule = {
      name: args.name || 'architecture-copilot-rule',
      scope: args.scope || 'frontend-ai-application',
      guardrails: [
        'All skills must declare inputSchema, outputSchema, allowedTools and knowledgeScopes.',
        'High-risk tools require human approval before execution.',
        'RAG answers must expose citation sources.',
        'Trace must persist tool input, output, duration, token usage and approval status.'
      ]
    };
    return { content: text(JSON.stringify(rule, null, 2)) };
  }

  return fail(null, -32601, `Unknown tool: ${name}`);
}

async function handleResourceRead(store, uri) {
  if (uri === 'architecture://documents') {
    const docs = await store.listDocuments();
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(docs.filter((doc) => (doc.tags || []).includes('copilot')).slice(0, 20), null, 2)
        }
      ]
    };
  }

  if (uri === 'project://rules') {
    return {
      contents: [
        {
          uri,
          mimeType: 'text/markdown',
          text: [
            '# AI Architecture Copilot Rules',
            '- TypeScript + Less for frontend.',
            '- Skill runtime controls tools and knowledge scopes.',
            '- SSE is the MVP generation stream; WS is reserved for collaboration.',
            '- Human-in-the-loop is mandatory for document/config/code-changing tools.'
          ].join('\n')
        }
      ]
    };
  }

  return fail(null, -32602, `Unknown resource: ${uri}`);
}

async function dispatch(store, message) {
  const { id, method, params = {} } = message;

  if (method === 'initialize') {
    return ok(id, {
      protocolVersion: '2024-11-05',
      serverInfo: { name: 'ai-architecture-copilot-mcp', version: '0.1.0' },
      capabilities: {
        resources: {},
        tools: {},
        prompts: {}
      }
    });
  }

  if (method === 'resources/list') {
    return ok(id, {
      resources: [
        { uri: 'architecture://documents', name: 'Architecture documents', mimeType: 'application/json' },
        { uri: 'project://rules', name: 'Project engineering rules', mimeType: 'text/markdown' }
      ]
    });
  }

  if (method === 'resources/read') {
    return ok(id, await handleResourceRead(store, params.uri));
  }

  if (method === 'tools/list') {
    return ok(id, {
      tools: [
        {
          name: 'search_architecture_docs',
          description: 'Search architecture knowledge with scope-aware RAG.',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string' },
              scopes: { type: 'array', items: { type: 'string' } },
              limit: { type: 'number' }
            },
            required: ['query']
          }
        },
        {
          name: 'inspect_project_structure',
          description: 'Inspect the MVP project structure and architecture boundaries.',
          inputSchema: { type: 'object', properties: {} }
        },
        {
          name: 'generate_project_rule',
          description: 'Generate a reusable architecture/project rule.',
          inputSchema: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              scope: { type: 'string' }
            }
          }
        }
      ]
    });
  }

  if (method === 'tools/call') {
    return ok(id, await handleToolCall(store, params.name, params.arguments));
  }

  if (method === 'prompts/list') {
    return ok(id, {
      prompts: [
        {
          name: 'architecture_review',
          description: 'Review an AI application architecture with RAG and tool constraints.'
        },
        {
          name: 'migration_plan',
          description: 'Create a migration plan from MVP runtime to production AI platform.'
        }
      ]
    });
  }

  if (method === 'prompts/get') {
    const prompt = params.name === 'migration_plan'
      ? '请生成从 AI Architecture Copilot MVP 到生产级 AI 应用平台的迁移计划，覆盖 LLM Provider、MCP、RAG、Trace、审批和部署。'
      : '请基于 Skill、Tool Calling、RAG、Human-in-the-loop 和 Agent Trace 评审该 AI 应用架构。';
    return ok(id, {
      description: params.name,
      messages: [{ role: 'user', content: { type: 'text', text: prompt } }]
    });
  }

  if (method === 'notifications/initialized') return null;
  return fail(id, -32601, `Method not found: ${method}`);
}

console.log = (...args) => console.error(...args);

const store = await createStore();
let buffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', async (chunk) => {
  buffer += chunk;
  const parsed = parseFrames(buffer);
  buffer = parsed.rest;

  for (const message of parsed.messages) {
    const response = await dispatch(store, message);
    if (response) process.stdout.write(frame(response));
  }
});

process.stdin.on('end', () => {
  process.exit(0);
});

process.stdin.resume();
