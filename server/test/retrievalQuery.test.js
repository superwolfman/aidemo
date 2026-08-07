import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRetrievalQuery } from '../src/services/retrievalQuery.js';

test('显式 retrievalQuery 优先于包含交付模板词的 LLM message', () => {
    const requirement = '建设前端可观测性平台，实现 Source Map、Web Vitals 与 TraceId';
    const message = `${requirement}\nReact + TypeScript + Node BFF；输出 PRD、RAG 引用和任务拆解`;

    assert.equal(resolveRetrievalQuery({ retrievalQuery: requirement, message }), requirement);
});

test('旧客户端未传 retrievalQuery 时兼容使用 message', () => {
    assert.equal(resolveRetrievalQuery({ message: ' legacy prompt ' }), 'legacy prompt');
});
