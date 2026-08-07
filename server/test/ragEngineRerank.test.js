// 验证 ragEngine 的 scope 精确度重排序逻辑。
// 不依赖外部服务，仅对 rerankByScopePrecision 做纯函数单测。
import test from 'node:test';
import assert from 'node:assert/strict';
import { rerankByScopePrecision } from '../src/services/ragEngine.js';

function makeSource ({ title, score, scopes, sourceType = 'manual' }) {
    return { title, score, scopes, sourceType };
}

const USER_SCOPES = ['architecture', 'standards', 'ai-native', 'frontend', 'frontend-observability', 'engineering-governance', 'performance'];

test('命中精确领域 scope 的 chunk 得分被 boost，排名上升', () => {
    const sources = [
        makeSource({ title: 'Copilot BFF 路由源码', score: 0.86, scopes: ['architecture'], sourceType: 'project-file' }),
        makeSource({ title: '前端可观测性与高可用架构', score: 0.82, scopes: ['frontend-observability', 'architecture', 'frontend'], sourceType: 'template' })
    ];

    const result = rerankByScopePrecision(sources, USER_SCOPES);

    assert.equal(result[0].title, '前端可观测性与高可用架构');
    assert.ok(result[0].score > result[1].score, '领域文档重排后得分必须高于 Copilot 源码');
    assert.ok(result[0].rerankReason.includes('scope precision boost'));
    assert.ok(result[0].rerankReason.includes('frontend-observability'));
});

test('未命中精确 scope 的 project-file 被 penalty，排名下降', () => {
    const sources = [
        makeSource({ title: 'Copilot 工作台前端源码', score: 0.90, scopes: ['frontend', 'architecture'], sourceType: 'project-file' }),
        makeSource({ title: '需求到交付 Agent 产品设计指南', score: 0.85, scopes: ['standards'], sourceType: 'template' })
    ];

    const result = rerankByScopePrecision(sources, USER_SCOPES);

    assert.equal(result[0].title, '需求到交付 Agent 产品设计指南');
    assert.ok(result[1].rerankReason.includes('project-file penalty'));
});

test('无精确 scope 时，宽泛 scope 来源不惩罚非 project-file 类型', () => {
    const sources = [
        makeSource({ title: '需求到交付 Agent 产品设计指南', score: 0.80, scopes: ['standards'], sourceType: 'template' }),
        makeSource({ title: '应用群工程与交付治理案例', score: 0.75, scopes: ['engineering-governance'], sourceType: 'template' })
    ];

    const result = rerankByScopePrecision(sources, USER_SCOPES);

    assert.equal(result[0].title, '应用群工程与交付治理案例');
    assert.equal(result[1].title, '需求到交付 Agent 产品设计指南');
    assert.ok(!result[1].rerankReason.includes('penalty'));
});

test('空数组安全返回', () => {
    const result = rerankByScopePrecision([], USER_SCOPES);
    assert.deepEqual(result, []);
});

test('命中多个精确 scope 不重复乘 factor（只判定是否命中）', () => {
    const sources = [
        makeSource({ title: 'A', score: 0.80, scopes: ['frontend-observability', 'performance'], sourceType: 'template' }),
        makeSource({ title: 'B', score: 0.85, scopes: ['frontend'], sourceType: 'project-file' })
    ];

    const result = rerankByScopePrecision(sources, USER_SCOPES);

    assert.equal(result[0].title, 'A');
    assert.ok(result[0].score > result[1].score);
    assert.equal(result[0].score, Number((0.80 * 1.25).toFixed(4)));
});
