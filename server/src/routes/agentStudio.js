import { canAccessAnyUserRecord } from '../security/tenantContext.js';   // 顶部 import
import crypto from 'node:crypto';
import express from 'express';
import { applyTransition, auditLog, buildRunControlPatch, createReplayRunDraft, createStateTransition, now, step, tokenCount, transitionRunPatch } from '../services/agentRuntimeService.js';
import { applyArtifactReview, attachArtifactWorkflow, normalizeSourceRef, exportArtifact } from '../services/artifactService.js';
import { buildEvalCases, persistEvalResult, scoreRunQuality } from '../services/evalService.js';
import { generateLlmAnswer, getProviderStatus, streamLlmAnswer } from '../services/llmProvider.js';
import { getRagStatus, retrieveKnowledge } from '../services/ragEngine.js';
import { agentCapabilities, getAgentCapability } from '../services/skillRegistry.js';
import { buildDeliveryArtifacts, buildFallbackAnswer } from '../services/toolExecutor.js';
import { closeSse, initSse, sendEvent, sleep } from '../utils/sse.js';

function upsertTraceStage (trace = [], stageId, patch = {}) {
    let updated = false;
    const nextTrace = trace.map((item) => {
        if (item.id !== stageId) return item;
        updated = true;
        return {
            ...item,
            ...patch,
            updatedAt: now()
        };
    });
    if (!updated) {
        nextTrace.push(step(stageId, patch.name || stageId, patch.status || 'success', patch));
    }
    return nextTrace;
}

function inferIntent (input) {
    const text = String(input || '');
    const signals = [];
    if (/客服|知识库|问答|FAQ|答案|引用/.test(text)) {
        signals.push('knowledge', 'qa', 'citation');
        return {
            id: 'knowledge-assistant',
            label: '知识库问答与运营纠错',
            goal: '从知识库中检索可信上下文，输出带引用答案、缺口和人工纠错建议。',
            scopes: ['architecture', 'standards', 'ai-native', 'im'],
            riskLevel: 'medium',
            confidence: 0.86,
            signals
        };
    }
    if (/测试|质量|发布|上线|验收|回归|门禁/.test(text)) {
        signals.push('quality', 'release', 'review');
        return {
            id: 'delivery-review-agent',
            label: '交付质量评审',
            goal: '评估方案完整度、测试缺口、上线风险和人工确认项。',
            scopes: ['standards', 'architecture', 'sdk'],
            riskLevel: 'high',
            confidence: 0.88,
            signals
        };
    }
    if (/接口|页面|PRD|原型|任务|流程|产品|工作流|需求/.test(text)) {
        signals.push('product', 'workflow', 'prd', 'api');
        return {
            id: 'product-delivery-agent',
            label: 'AI 产品交付工作流',
            goal: '把需求转成 PRD、页面结构、API Contract、研发任务和测试策略。',
            scopes: ['architecture', 'standards', 'ai-native', 'frontend'],
            riskLevel: 'high',
            confidence: 0.92,
            signals
        };
    }
    return {
        id: 'product-delivery-agent',
        label: '通用产研测交付',
        goal: '先澄清需求，再生成可评审交付物和下一步动作。',
        scopes: ['architecture', 'standards', 'ai-native'],
        riskLevel: 'medium',
        confidence: 0.62,
        signals: ['general']
    };
}

function selectCapability (intent) {
    return getAgentCapability(intent);
}

function buildAgentPlan (intent) {
    return [
        {
            id: 'validate-request',
            name: '校验用户请求',
            owner: 'Runtime',
            status: 'success',
            guardrail: '检查输入是否可执行、是否需要人工澄清',
            tool: 'validateInput'
        },
        {
            id: 'select-skill',
            name: '选择 Skill',
            owner: 'Skill Runtime',
            status: 'success',
            guardrail: '根据意图映射 allowedTools 与 knowledgeScopes',
            tool: 'selectSkill'
        },
        {
            id: 'retrieve-context',
            name: '检索上下文',
            owner: 'RAG Engine',
            status: 'pending',
            guardrail: `限定 scopes: ${intent.scopes.join(', ')}`,
            tool: 'retrieveKnowledge'
        },
        {
            id: 'run-tools',
            name: '执行工具',
            owner: 'Tool Runtime',
            status: 'pending',
            guardrail: '只允许当前 Skill 声明的工具执行',
            tool: 'planDelivery'
        },
        {
            id: 'stream-result',
            name: 'LLM 生成',
            owner: 'LLM Provider',
            status: 'pending',
            guardrail: 'Provider fallback 必须显式展示',
            tool: 'llmAnswer'
        },
        {
            id: 'human-review',
            name: '人工审批',
            owner: 'Reviewer',
            status: intent.riskLevel === 'high' ? 'waiting' : 'pending',
            guardrail: '高风险动作必须暂停等待确认',
            tool: 'requestHumanReview'
        }
    ];
}

function updatePlan (plan, id, status, patch = {}) {
    return plan.map((item) => item.id === id ? { ...item, status, ...patch } : item);
}

function normalizeSession (session) {
    if (!session) return session;
    return {
        ...session,
        messages: Array.isArray(session.messages) ? session.messages.filter((item) => item?.content) : []
    };
}

function normalizeRun (run) {
    // if (!run) return run;
    // return {
    //     ...run,
    //     quality: scoreRunQuality(run)
    // };
    if (!run) return run;
    return {
        ...run,
        quality: run.quality || null   // ← 评分已在创建/更新时持久化，不再实时计算
    };
}

export function agentStudioRouter (store) {
    const router = express.Router();

    router.get('/blueprint', async (req, res) => {
        let ragStatus;
        try {
            const vs = await store.checkVectorSearch();
            if (vs.ok) {
                ragStatus = getRagStatus({ storeKind: store.kind, mode: 'live', vectorSearchReady: true });
            } else {
                ragStatus = getRagStatus({ storeKind: store.kind, mode: 'fallback', vectorSearchReady: false, error: vs.error });
            }
        } catch (e) {
            ragStatus = getRagStatus({ storeKind: store.kind, error: e.message });
        }

        // 如果缓存未命中，同步刷新一次（仅首次）
        if (!store.getCachedRagStatus || !store.getCachedRagStatus().vectorSearchReady) {
            await store.refreshRagStatusCache().catch(() => { });
        }

        res.json({
            capabilities: agentCapabilities,
            architecture: {
                frontend: ['Agent Runtime Console', 'Run Queue', 'Intent Inspector', 'Plan Board', 'State Machine', 'Tool Calls', 'Audit Timeline'],
                bff: ['Auth', 'Session', 'Agent Run State', 'RAG Retrieval', 'Tool Runtime', 'LLM Provider Adapter', 'Human Review', 'Audit Log'],
                states: ['idle', 'intent_detected', 'skill_selected', 'retrieving', 'tool_running', 'streaming', 'review_required', 'paused', 'resumed', 'rolled_back', 'confirmed', 'failed', 'cancelled'],
                data: ['agent_sessions', 'agent_runs', 'agent_reviews', 'agent_audit_logs']
            },
            controls: {
                supportedActions: ['pause', 'resume', 'rollback', 'confirm', 'revise', 'reject'],
                policy: '高风险工具和外部写入动作必须 human-in-the-loop；运行控制动作写入 audit log。'
            },
            runtime: {
                llm: getProviderStatus(),
                rag: ragStatus
            }
        });
    });

    router.get('/sessions', async (req, res) => {
        // 列表接口不返回 messages（可能非常大），详情接口再返回
        const sessions = await store.listRecords('agent_sessions', 50, { messages: 0 }, req.auth);
        res.json({ sessions: sessions.map(normalizeSession) });
    });

    router.get('/runs', async (req, res) => {
        // 列表接口不返回超大嵌套字段，详情接口再返回
        const runs = await store.listRecords('agent_runs', 50, {
            trace: 0, artifacts: 0, logs: 0, stateTransitions: 0,
            reviewHistory: 0, controlHistory: 0, evalResult: 0
        }, req.auth);
        res.json({ runs: runs.map(normalizeRun) });
    });

    router.get('/eval-cases', async (req, res) => {
        const runs = (await store.listRecords('agent_runs', 100, {
            _id: 1, evalCaseId: 1, quality: 1
        }, req.auth)).map((run) => ({
            _id: run._id,
            evalCaseId: run.evalCaseId,
            quality: run.quality || null   // 评分已在写入时持久化
        }));

        // O(N) Map 索引
        const runByEvalCase = new Map();
        for (const run of runs) {
            if (run.evalCaseId && !runByEvalCase.has(run.evalCaseId)) {
                runByEvalCase.set(run.evalCaseId, run);
            }
        }

        const evalResults = await store.listRecords('agent_eval_results', 100, null, req.auth);
        const historyByCase = new Map();
        for (const result of evalResults) {
            const list = historyByCase.get(result.evalCaseId) || [];
            list.push(result);
            historyByCase.set(result.evalCaseId, list);
        }

        res.json({
            cases: buildEvalCases().map((item) => {
                const run = runByEvalCase.get(item.id);
                return {
                    ...item,
                    status: 'ready',
                    lastRunId: run?._id,
                    lastResult: run?.quality,
                    evalHistory: (historyByCase.get(item.id) || []).slice(0, 5)
                };
            })
        });
    });

    router.post('/sessions', async (req, res) => {
        const session = await store.createRecord('agent_sessions', {
        title: req.body.title || '新的 Agent 会话',
        createdBy: req.user._id,
        tenantId: req.auth.tenantId,
        activeAgentId: req.body.agentId || 'product-delivery-agent',
            messages: []
        });
        res.json({ session: normalizeSession(session) });
    });

    router.get('/runs/:id', async (req, res) => {
        const run = await store.getRecord('agent_runs', req.params.id, req.auth);
        if (!run) {
            // 统一用 404，不暴露“存在但无权访问”
            res.status(404).json({ message: 'Agent run not found' });
            return;
        }

        // 若 store 层已按 tenantUserFilter 过滤，理论上无需再校验；
        // 但为了兼容未来可能的 getRecord 调用点，保留显式兜底校验。
        if (run.tenantId !== req.auth.tenantId) {
            res.status(404).json({ message: 'Agent run not found' });
            return;
        }
        if (run.createdBy !== req.auth.actorId && !canAccessAnyUserRecord(req.auth)) {
            res.status(404).json({ message: 'Agent run not found' });
            return;
        }

        res.json({ run: normalizeRun(run) });
    });

    router.post('/runs/:id/review', async (req, res) => {
        try {
            const run = await store.getRecord('agent_runs', req.params.id, req.auth);
            if (!run) {
                res.status(404).json({ message: 'Agent run not found' });
                return;
            }

            // 人工审批只能在 AI 输出完成并进入 review_required 后执行
            if (run.status !== 'review_required') {
                res.status(409).json({
                    message: `当前运行状态为 ${run.status}，不可执行人工审批，请先等待运行进入 review_required 状态`,
                    code: 'INVALID_RUN_STATUS_FOR_REVIEW',
                    currentStatus: run.status
                });
                return;
            }

            const action = req.body.action || 'confirm';
            const nextStatusMap = {
                confirm: 'confirmed',
                reject: 'rejected',
                revise: 'revision_requested'
            };
            const nextStatus = nextStatusMap[action] || 'confirmed';
            const review = await store.createRecord('agent_reviews', {
                runId: run._id,
                action,
                note: req.body.note || '',
                reviewerId: req.user._id,
                previousStatus: run.status,
                nextStatus
            });
            const log = auditLog('review', `审批动作：${action}`, {
                action,
                reviewerId: req.user._id,
                note: req.body.note || ''
            });
            const nextArtifacts = action === 'confirm'
                ? (run.artifacts || []).map((artifact) => ({
                    ...artifact,
                    status: artifact.status === 'confirmed' ? artifact.status : 'reviewed',
                    reviewStatus: artifact.reviewStatus === 'confirmed' ? artifact.reviewStatus : 'reviewed'
                }))
                : run.artifacts || [];
            const nextTrace = upsertTraceStage(run.trace || [], 'review', {
                name: '人工审批决策',
                status: action === 'reject' ? 'failed' : action === 'revise' ? 'waiting' : 'success',
                output: {
                    action,
                    note: req.body.note || '',
                    policy: action === 'confirm' ? '审批通过，允许进入下一阶段' : '审批未通过，需要修订或终止'
                }
            });
            const transitionPatch = transitionRunPatch(run, nextStatus, {
                label: `人工审批：${action}`,
                actorId: req.user._id,
                reason: req.body.note || ''
            });
            const quality = scoreRunQuality({
                ...run,
                artifacts: nextArtifacts,
                trace: nextTrace,
                provider: run.provider || {},
                intent: run.intent || {},
                prompt: run.prompt || ''
            });
            const nextRun = await store.updateRecord('agent_runs', run._id, {
                ...transitionPatch,
                artifacts: nextArtifacts,
                trace: nextTrace,
                reviewHistory: [review, ...(run.reviewHistory || [])],
                logs: [...(run.logs || []), log],
                quality,
                updatedAt: now()
            });
            res.json({ review, run: nextRun });
        } catch (error) {
            console.error('Review endpoint error:', error);
            res.status(error.statusCode || 500).json({ message: error.message || 'Internal server error' });
        }
    });

    router.patch('/runs/:id/artifacts/:artifactId', async (req, res) => {
        const run = await store.getRecord('agent_runs', req.params.id);
        if (!run) {
            res.status(404).json({ message: 'Agent run not found' });
            return;
        }
        const artifacts = (run.artifacts || []).map((artifact) => {
            if (artifact.id !== req.params.artifactId) return artifact;
            const version = Number(artifact.version || 1) + 1;
            const nextContent = req.body.content ?? artifact.content;
            const nextStatus = req.body.status || artifact.status || 'draft';
            return {
                ...artifact,
                content: nextContent,
                status: nextStatus,
                reviewStatus: req.body.reviewStatus || artifact.reviewStatus || 'pending',
                updatedAt: now(),
                updatedBy: req.user._id,
                version,
                versions: [
                    {
                        version,
                        status: nextStatus,
                        content: nextContent,
                        createdAt: now(),
                        operatorId: req.user._id
                    },
                    ...(artifact.versions || [])
                ].slice(0, 12)
            };
        });
        const updatedArtifact = artifacts.find((artifact) => artifact.id === req.params.artifactId);
        if (!updatedArtifact) {
            res.status(404).json({ message: 'Artifact not found' });
            return;
        }
        const log = auditLog('artifact', `Artifact 更新：${updatedArtifact.title}`, {
            artifactId: updatedArtifact.id,
            version: updatedArtifact.version,
            traceStepId: updatedArtifact.traceStepId,
            sourceIds: updatedArtifact.sourceIds || []
        });
        const nextRun = await store.updateRecord('agent_runs', run._id, {
            artifacts,
            logs: [...(run.logs || []), log],
            quality: scoreRunQuality({ ...run, artifacts })
        });
        res.json({ artifact: updatedArtifact, run: nextRun });
    });

    router.post('/runs/:id/artifacts/:artifactId/confirm', async (req, res) => {
        const run = await store.getRecord('agent_runs', req.params.id);
        if (!run) {
            res.status(404).json({ message: 'Agent run not found' });
            return;
        }
        const artifacts = (run.artifacts || []).map((artifact) => {
            if (artifact.id !== req.params.artifactId) return artifact;
            return applyArtifactReview(artifact, {
                // action: 'confirm',
                action: req.body.action === 'review' ? 'review' : 'confirm',
                note: req.body.note || '',
                operatorId: req.user._id
            });
        });
        const updatedArtifact = artifacts.find((artifact) => artifact.id === req.params.artifactId);
        if (!updatedArtifact) {
            res.status(404).json({ message: 'Artifact not found' });
            return;
        }
        const log = auditLog('artifact', `Artifact 确认：${updatedArtifact.title}`, { artifactId: updatedArtifact.id });
        const nextTrace = upsertTraceStage(run.trace || [], updatedArtifact.traceStepId || 'tool', {
            status: 'success',
            output: {
                ...(run.trace || []).find((item) => item.id === (updatedArtifact.traceStepId || 'tool'))?.output,
                confirmedArtifactId: updatedArtifact.id,
                confirmedArtifactTitle: updatedArtifact.title
            }
        });
        const nextRun = await store.updateRecord('agent_runs', run._id, {
            artifacts,
            trace: nextTrace,
            logs: [...(run.logs || []), log],
            quality: scoreRunQuality({ ...run, artifacts, trace: nextTrace })
        });
        res.json({ artifact: updatedArtifact, run: nextRun });
    });

    // router.get('/runs/:id/artifacts/:artifactId/export', async (req, res) => {
    //     const run = await store.getRecord('agent_runs', req.params.id);
    //     const artifact = run?.artifacts?.find((item) => item.id === req.params.artifactId);
    //     if (!artifact) {
    //         res.status(404).json({ message: 'Artifact not found' });
    //         return;
    //     }
    //     const format = req.query.format === 'json' ? 'json' : 'markdown';
    //     const content = typeof artifact.content === 'string' ? artifact.content : JSON.stringify(artifact.content, null, 2);
    //     const exportRecord = {
    //         id: `export-${crypto.randomUUID()}`,
    //         format,
    //         filename: `${artifact.type}-${artifact.id}.${format === 'json' ? 'json' : 'md'}`,
    //         exportedAt: now(),
    //         exportedBy: req.user._id
    //     };
    //     const artifacts = (run.artifacts || []).map((item) => (
    //         item.id === artifact.id
    //             ? { ...item, exports: [exportRecord, ...(item.exports || [])].slice(0, 20) }
    //             : item
    //     ));
    //     const log = auditLog('artifact', `Artifact 导出：${artifact.title}`, {
    //         artifactId: artifact.id,
    //         format,
    //         filename: exportRecord.filename
    //     });
    //     const nextRun = await store.updateRecord('agent_runs', run._id, {
    //         artifacts,
    //         logs: [...(run.logs || []), log]
    //     });
    //     res.json({
    //         filename: `${artifact.type}-${artifact.id}.${format === 'json' ? 'json' : 'md'}`,
    //         format,
    //         run: nextRun,
    //         content: format === 'json'
    //             ? JSON.stringify(artifact, null, 2)
    //             : `# ${artifact.title}\n\n> version: ${artifact.version || 1} / status: ${artifact.status || 'draft'}\n\n${content}`
    //     });
    // });

    router.get('/runs/:id/artifacts/:artifactId/export', async (req, res) => {
        try {
            const result = await exportArtifact(store, req.params.id, req.params.artifactId, {
                format: req.query.format,
                actorId: req.user?._id
            });
            res.json(result);
        } catch (err) {
            res.status(err.statusCode || 500).json({ message: err.message });
        }
    });

    router.post('/runs/:id/control', async (req, res) => {
        const run = await store.getRecord('agent_runs', req.params.id);
        if (!run) {
            res.status(404).json({ message: 'Agent run not found' });
            return;
        }
        const action = req.body.action || 'pause';
        let controlPatch;
        try {
            controlPatch = buildRunControlPatch(run, { action, actorId: req.user._id, reason: req.body.reason || '' });
        } catch (error) {
            res.status(error.statusCode || 500).json({ message: error.message });
            return;
        }
        const { artifacts: rollbackArtifacts, log, status } = controlPatch;
        let transitioned;
        try {
            transitioned = await applyTransition(store, run, status, {
                label: `运行控制：${action}`,
                actorId: req.user._id,
                reason: req.body.reason || ''
            });
        } catch (error) {
            res.status(error.statusCode || 500).json({ message: error.message });
            return;
        }
        const nextTrace = upsertTraceStage(run.trace || [], 'control', {
            name: '运行治理控制',
            status: action === 'rollback' ? 'warning' : 'success',
            input: { action, reason: req.body.reason || '' },
            output: { nextStatus: status, affectedArtifacts: rollbackArtifacts.length }
        });
        const quality = scoreRunQuality({ ...transitioned, artifacts: rollbackArtifacts, trace: nextTrace });
        const nextRun = await store.updateRecord('agent_runs', run._id, {
            artifacts: rollbackArtifacts,
            trace: nextTrace,
            quality,
            logs: [...(run.logs || []), log],
            controlState: {
                action,
                status,
                reason: req.body.reason || '',
                updatedAt: now(),
                operatorId: req.user._id,
                previousStatus: run.status
            },
            controlHistory: [
                { id: `control-${crypto.randomUUID()}`, action, status, reason: req.body.reason || '', operatorId: req.user._id, createdAt: now() },
                ...(run.controlHistory || [])
            ]
        });
        res.json({ run: nextRun, log });
    });

    router.post('/runs/:id/replay', async (req, res) => {
        const run = await store.getRecord('agent_runs', req.params.id);
        if (!run) {
            res.status(404).json({ message: 'Agent run not found' });
            return;
        }
        const replayRun = await store.createRecord('agent_runs', createReplayRunDraft(run, {
            actorId: req.user._id,
            reason: req.body.reason || 'AgentOps failure replay'
        }));
        const log = auditLog('replay', `创建失败回放 Run：${replayRun.runId}`, {
            sourceRunId: run._id,
            replayRunId: replayRun._id,
            operatorId: req.user._id,
            reason: req.body.reason || ''
        });
        await store.updateRecord('agent_runs', run._id, {
            logs: [...(run.logs || []), log],
            replayHistory: [
                {
                    id: `replay-${crypto.randomUUID()}`,
                    replayRunId: replayRun._id,
                    reason: req.body.reason || '',
                    operatorId: req.user._id,
                    createdAt: now()
                },
                ...(run.replayHistory || [])
            ]
        });
        res.json({ run: replayRun, sourceRunId: run._id, log });
    });

    router.post('/eval-cases/:id/score', async (req, res) => {
        const runs = await store.listRecords('agent_runs', 100);
        const run = runs.find((item) => item.evalCaseId === req.params.id || item._id === req.body.runId);
        if (!run) {
            res.status(404).json({ message: 'No run found for eval case' });
            return;
        }
        // ← 关键：取该 case 的 expected 维度，传入评分
        // const evalCase = buildEvalCases().find((c) => c.id === req.params.id);
        // const quality = scoreRunQuality(run, { expected: evalCase?.expected });
        const evalCase = buildEvalCases().find((c) => c.id === run.evalCaseId);
        const quality = scoreRunQuality(run, { expected: evalCase?.expected });
        const evalResult = await persistEvalResult(store, { ...run, quality });
        const nextRun = await store.updateRecord('agent_runs', run._id, {
            quality,
            evalResult,
            logs: [...(run.logs || []), auditLog('eval', `Eval 质量评分：${quality.score}%`, { evalCaseId: req.params.id, quality })]
        });
        res.json({ run: nextRun, evalResult });
    });

    router.post('/sessions/:id/runs/stream', async (req, res) => {
        initSse(res);
        try {
            const session = await store.getRecord('agent_sessions', req.params.id, req.auth);
            if (!session) {
                sendEvent(res, 'error', { message: 'Session not found' });
                closeSse(res);
                return;
            }

            const prompt = String(req.body.message || '').trim();
            const commandOptions = req.body.commandOptions && typeof req.body.commandOptions === 'object' ? req.body.commandOptions : {};
            const modelConfig = req.body.model && typeof req.body.model === 'object' ? req.body.model : {};
            const provider = getProviderStatus(modelConfig);
            let intent = inferIntent(prompt);
            if (Array.isArray(commandOptions.scopes) && commandOptions.scopes.length) {
                intent = { ...intent, scopes: commandOptions.scopes };
            }
            const requestedCapability = agentCapabilities.find((capability) => (
                capability.id === commandOptions.agentId || capability.id === commandOptions.skillId
            ));
            const selectedSkill = requestedCapability || selectCapability(intent);
            if (requestedCapability && requestedCapability.id !== intent.id) {
                intent = {
                    ...intent,
                    id: requestedCapability.id,
                    label: requestedCapability.name,
                    goal: requestedCapability.description,
                    signals: [...(intent.signals || []), 'command_center_selected']
                };
            }
            let plan = buildAgentPlan(intent);
            const runId = `run-${crypto.randomUUID()}`;
            const logs = [
                auditLog('info', 'Agent Run 已创建', { runId, promptPreview: prompt.slice(0, 80) })
            ];
            const trace = [];
            let runRecord = await store.createRecord('agent_runs', {
                runId,
                sessionId: session._id,
                status: 'created',
                prompt,
                intent,
                selectedSkill,
                plan,
                sources: [],
                artifacts: [],
                trace,
                logs,
                answer: '',
                provider,
                quality: null,
                evalCaseId: req.body.evalCaseId,
                commandOptions,
                createdBy: req.user._id,
                tenantId: req.auth.tenantId,
                status: 'created',
                stateTransitions: [
                    createStateTransition({
                        from: 'none',
                        to: 'created',
                        label: '创建 Agent Run',
                        actorId: req.user._id,
                        meta: { sessionId: session._id }
                    })
                ],
                reviewHistory: [],
                controlHistory: []
            });
            const persistRun = async (patch = {}) => {
                runRecord = await store.updateRecord('agent_runs', runRecord._id, {
                    intent,
                    selectedSkill,
                    plan,
                    trace,
                    logs,
                    ...patch
                });
                return runRecord;
            };
            const emitStatus = async (status, label, extra = {}) => {
                try {
                    runRecord = await applyTransition(store, runRecord, status, {
                        label,
                        actorId: req.user._id,
                        meta: extra
                    });
                } catch (error) {
                    logs.push(auditLog('error', error.message, { from: runRecord.status, to: status }));
                    throw error;
                }
                sendEvent(res, 'run_status', { runDbId: runRecord._id, runId, status, label, at: now(), intent, selectedSkill, plan, ...extra });
            };
            const emitStep = async (payload) => {
                trace.push(payload);
                await persistRun({ trace });
                sendEvent(res, 'trace', payload);
                await sleep(110);
            };

            await emitStatus('intent_detected', '识别自然语言意图', { runId, intent, selectedSkill, plan });
            await emitStep(step('intent', '意图理解', 'success', {
                input: { prompt },
                output: intent,
                tokenUsage: tokenCount(prompt)
            }));
            logs.push(auditLog('info', `意图识别完成：${intent.label}`, { intent }));
            await persistRun({ logs });

            plan = updatePlan(plan, 'select-skill', 'success', { output: { skillId: selectedSkill.id, tools: selectedSkill.tools } });
            await emitStatus('skill_selected', '选择 Agent Skill', { skillId: selectedSkill.id });
            await persistRun({ plan });
            sendEvent(res, 'plan', { plan, selectedSkill, intent });
            await emitStep(step('skill', 'Skill 自动选择', 'success', {
                input: { intent: intent.id },
                output: selectedSkill,
                tokenUsage: tokenCount(JSON.stringify(selectedSkill))
            }));
            logs.push(auditLog('info', `自动选择 Skill：${selectedSkill.name}`, { skillId: selectedSkill.id }));
            await persistRun({ logs });

            await emitStatus('retrieving', '检索知识库上下文', { scopes: intent.scopes });
            const retrievalStartedAt = Date.now();
            const rag = await retrieveKnowledge({
                store,
                context: req.auth,
                query: `${intent.goal}\n${prompt}`,
                scopes: intent.scopes,
                limit: 5
            });
            const sources = rag.sources || [];
            sendEvent(res, 'sources', { sources, filteredChunks: rag.filteredChunks || [], rag: rag.status, latencyMs: Date.now() - retrievalStartedAt, scopes: intent.scopes });
            plan = updatePlan(plan, 'retrieve-context', 'success', { output: { hits: sources.length, backend: rag.status?.retrievalBackend || rag.status?.backend } });
            await persistRun({ sources, filteredChunks: rag.filteredChunks || [], plan })
            sendEvent(res, 'plan', { plan, selectedSkill, intent });
            await emitStep(step('rag', 'RAG 上下文检索', 'success', {
                tool: 'retrieveKnowledge',
                input: { query: prompt, scopes: intent.scopes },
                output: sources.map((source) => ({ title: source.documentTitle, score: source.score, backend: source.retrievalBackend })),
                tokenUsage: tokenCount(JSON.stringify(sources))
            }));
            logs.push(auditLog('tool', `RAG 检索完成，命中 ${sources.length} 个 chunk`, {
                tool: 'retrieveKnowledge',
                hitCount: sources.length
            }));
            await persistRun({ logs, sources });

            await emitStatus('tool_running', '规划产研测交付路径');
            const artifacts = attachArtifactWorkflow(await buildDeliveryArtifacts({ intent, prompt, sources }), 'tool', sources, runRecord.evalCaseId);
            plan = updatePlan(plan, 'run-tools', 'success', { output: { artifacts: artifacts.map((artifact) => artifact.type) } });
            await persistRun({ artifacts, plan });
            sendEvent(res, 'plan', { plan, selectedSkill, intent });
            await emitStep(step('tool', '产研测计划生成', 'success', {
                tool: 'planDelivery',
                output: {
                    artifacts: artifacts.map((artifact) => ({ id: artifact.id, title: artifact.title, sourceIds: artifact.sourceIds })),
                    riskLevel: intent.riskLevel,
                    sourceRefs: sources.map(normalizeSourceRef)
                },
                tokenUsage: tokenCount(JSON.stringify(artifacts))
            }));
            sendEvent(res, 'artifacts', { artifacts });
            logs.push(auditLog('tool', `工具生成 ${artifacts.length} 个 Artifact`, {
                tool: 'planDelivery',
                artifacts: artifacts.map((artifact) => artifact.title)
            }));
            await persistRun({ logs, artifacts });

            await emitStatus('streaming', '调用 LLM Provider 生成');
            plan = updatePlan(plan, 'stream-result', 'running');
            await persistRun({ plan });
            sendEvent(res, 'plan', { plan, selectedSkill, intent });
            await emitStep(step('llm', 'LLM 生成', 'running', {
                input: { provider: provider.provider, model: provider.requestedModel || provider.model }
            }));

            const fallback = buildFallbackAnswer({ prompt, intent, sources, artifacts });
            let answer = fallback;
            let generatedProvider = provider;
            let mode = 'deterministic';
            try {
                const generated = await streamLlmAnswer({
                    // systemPrompt: '你是企业级 AI Agent 产品专家，输出要围绕产研测交付闭环、自然语言交互、RAG 引用、Artifact、Trace 和人工确认。',
                    systemPrompt: `你是企业级 AI Agent 产品专家。
                输出约束：
                1. 只能引用 sources 中实际存在的 chunk，禁止编造引用编号
                2. 引用必须用 [1], [2], [3] 这种格式，编号与 sources 顺序一致
                3. 引用标记必须内联在正文中：每当某句结论依据了某条 source，就在该句末尾紧跟对应 [n]，例如"涉及真实预算消耗的动作必须人工确认 [3]。"；不要只在文末罗列引用
                4. 每个 [n] 必须指向真正支持该句的那条 source；不同结论各自引用对应来源，禁止把多条结论都堆在同一个编号上（citation stacking）
                5. 属于通用最佳实践、你自己的建议、非 sources 原文支持的句子，一律不带引用标记
                6. 如果 sources 没有覆盖某个问题，明确说"未在知识库中找到相关资料"，且该句不得带引用标记
                7. 不要编造"工具结果"或"参考来源"等模糊引用
                8. 文末可附"引用来源"列表，但只包含正文中实际引用过的 sources 文档标题
                `,
                    prompt,
                    sources,
                    toolResults: { intent, artifacts: artifacts.map((artifact) => ({ type: artifact.type, title: artifact.title })) },
                    modelConfig,
                    onDelta: (text) => sendEvent(res, 'delta', { text })
                });
                generatedProvider = generated.provider;
                if (generated.text?.trim()) {
                    answer = generated.text;
                    mode = 'streaming';
                    logs.push(auditLog('llm', 'LLM 流式生成成功', { provider: generated.provider }));
                } else {
                    // 部分模型（如 qwen-flash-2025-07-28）在流式模式下可能返回空，静默降级到同步调用
                    logs.push(auditLog('llm', '流式返回为空，降级到同步生成', { provider: generated.provider }));
                    const completed = await generateLlmAnswer({
                        systemPrompt: '你是企业级 AI Agent 产品专家。引用 sources 时必须在正文相关句末内联 [n] 标记（编号与 sources 顺序一致），禁止编造引用编号；未覆盖的问题明确说"未在知识库中找到相关资料"。',
                        prompt,
                        sources,
                        toolResults: { intent, artifacts },
                        modelConfig,
                        fallback
                    });
                    generatedProvider = completed.provider;
                    answer = completed.text;
                    mode = 'sync';
                }
                await emitStep(step('llm', 'LLM 生成', 'success', {
                    output: { provider: generatedProvider.provider, model: generatedProvider.model, mode, requestedModel: generatedProvider.requestedModel },
                    tokenUsage: tokenCount(answer)
                }));
                plan = updatePlan(plan, 'stream-result', 'success', { output: { provider: generatedProvider.provider, model: generatedProvider.model } });
                await persistRun({ answer, plan, logs, provider: generatedProvider });
            } catch (error) {
                await emitStep(step('llm', 'LLM 生成', 'failed', { error: error.message }));
                answer = `${fallback}\n\n### Provider fallback\n真实模型调用失败，已降级到 deterministic Agent Runtime。错误：${error.message}`;
                plan = updatePlan(plan, 'stream-result', 'failed', { error: error.message });
                logs.push(auditLog('error', 'LLM Provider 调用失败，已降级 fallback', { error: error.message }));
                await persistRun({ answer, plan, logs, provider });
            }
            sendEvent(res, 'plan', { plan, selectedSkill, intent });

            if (!streamed) {
                for (let index = 0; index < answer.length; index += 20) {
                    sendEvent(res, 'delta', { text: answer.slice(index, index + 20) });
                    await sleep(14);
                }
            }

            await emitStatus('review_required', '等待人工确认');
            plan = updatePlan(plan, 'human-review', 'waiting', { output: { humanRequired: intent.riskLevel === 'high' } });
            await persistRun({ answer, plan })
            sendEvent(res, 'plan', { plan, selectedSkill, intent });
            await emitStep(step('review', '人工确认节点', 'waiting', {
                humanRequired: intent.riskLevel === 'high',
                output: { policy: '高风险交付物需确认后进入执行' }
            }));
            logs.push(auditLog('review', '进入人工确认节点', { humanRequired: intent.riskLevel === 'high' }));
            await persistRun({ logs });

            const quality = scoreRunQuality({ sources, artifacts, trace, provider, intent });
            const evalResult = await persistEvalResult(store, {
                ...runRecord,
                sources,
                artifacts,
                trace,
                provider,
                intent,
                quality,
                evalCaseId: req.body.evalCaseId
            });
            const run = await persistRun({
                prompt,
                intent,
                selectedSkill,
                plan,
                sources,
                filteredChunks: rag.filteredChunks || [],
                artifacts,
                trace,
                logs,
                answer,
                provider,
                quality,
                evalResult,
                evalCaseId: req.body.evalCaseId,
                commandOptions,
                createdBy: req.user._id
            });
            const userMessage = { id: `user-${Date.now()}`, role: 'user', content: prompt, createdAt: now() };
            const assistantMessage = { id: `assistant-${Date.now()}`, role: 'assistant', content: answer, runId: run._id, sources, trace, createdAt: now() };
            const messages = [...(session.messages || []), userMessage, assistantMessage];
            await store.updateRecord('agent_sessions', session._id, {
                messages,
                activeAgentId: intent.id,
                title: session.title === '新的 Agent 会话' ? prompt.slice(0, 24) || session.title : session.title
            });

            sendEvent(res, 'review', { runId: run._id, required: intent.riskLevel === 'high', status: 'pending' });
            sendEvent(res, 'run_status', {
                runDbId: run._id,
                runId,
                status: 'completed',
                label: 'Agent 运行完成，等待交付确认',
                at: now(),
                intent,
                selectedSkill,
                plan
            });
            sendEvent(res, 'final', { run, message: assistantMessage });
            closeSse(res);
        } catch (error) {
            // 补上 SSE 路由顶层异常边界（P0-C）
            sendEvent(res, 'error', { message: error.message || 'Internal error' });
            closeSse(res);
        }
    })
    return router;
}

