import express from 'express';
import { agentTools } from '../services/agentTools.js';
import { closeSse, initSse, sendEvent, sleep } from '../utils/sse.js';

function step(id, name, status = 'pending', result = null) {
  return { id, name, status, result };
}

const workflowTemplate = [
  step('plan', '理解目标并拆解任务'),
  step('retrieve', 'RAG 检索业务知识'),
  step('campaign', '生成活动方案'),
  step('materials', '生成投放素材'),
  step('attribution', '模拟归因分析'),
  step('coupon', '创建优惠券草稿'),
  step('push', '创建 Push 草稿'),
  step('approval', '等待人工确认')
];

async function runStep(res, task, store, stepId, runner) {
  const steps = task.steps.map((item) => (item.id === stepId ? { ...item, status: 'running' } : item));
  task = await store.updateTask(task._id, { steps, status: 'running' });
  sendEvent(res, 'task', task);
  await sleep(320);

  const result = await runner();
  const finished = task.steps.map((item) =>
    item.id === stepId ? { ...item, status: 'success', result } : item
  );
  task = await store.updateTask(task._id, { steps: finished, outputs: [...(task.outputs || []), result] });
  sendEvent(res, 'tool', { stepId, result });
  sendEvent(res, 'task', task);
  await sleep(240);
  return task;
}

export function agentRouter(store) {
  const router = express.Router();

  router.get('/tasks', async (req, res) => {
    res.json({ tasks: await store.listTasks() });
  });

  router.get('/tasks/:id', async (req, res) => {
    const task = await store.getTask(req.params.id);
    if (!task) return res.status(404).json({ message: 'task not found' });
    res.json({ task });
  });

  router.post('/run/stream', async (req, res) => {
    const { goal } = req.body || {};
    if (!goal) return res.status(400).json({ message: 'goal is required' });

    initSse(res);
    let task = await store.createTask({
      goal,
      ownerId: req.user._id,
      status: 'pending',
      approvalRequired: false,
      steps: workflowTemplate,
      outputs: []
    });
    sendEvent(res, 'task', task);

    task = await runStep(res, task, store, 'plan', async () => ({
      tool: 'agent.plan',
      summary: '已拆解为 RAG、生成、归因、优惠券、Push、人工确认 6 类动作',
      data: ['retrieve', 'campaign', 'materials', 'attribution', 'coupon', 'push', 'approval']
    }));
    task = await runStep(res, task, store, 'retrieve', () => agentTools.retrieveKnowledge(store, goal));
    task = await runStep(res, task, store, 'campaign', () => agentTools.generateCampaign(goal));
    task = await runStep(res, task, store, 'materials', () => agentTools.generateMaterials(goal));
    task = await runStep(res, task, store, 'attribution', () => agentTools.analyzeAttribution(goal));
    task = await runStep(res, task, store, 'coupon', () => agentTools.createCouponDraft(goal));
    task = await runStep(res, task, store, 'push', () => agentTools.createPushDraft(goal));

    const waitingSteps = task.steps.map((item) =>
      item.id === 'approval' ? { ...item, status: 'waiting', result: { summary: '高风险动作需要人工确认' } } : item
    );
    task = await store.updateTask(task._id, {
      status: 'waiting_approval',
      approvalRequired: true,
      steps: waitingSteps
    });
    sendEvent(res, 'approval_required', { taskId: task._id, message: '请在任务面板确认后执行广告、Push 和优惠券生效。' });
    sendEvent(res, 'task', task);
    closeSse(res);
  });

  router.post('/tasks/:id/approve/stream', async (req, res) => {
    let task = await store.getTask(req.params.id);
    if (!task) return res.status(404).json({ message: 'task not found' });

    initSse(res);
    const steps = task.steps.map((item) => (item.id === 'approval' ? { ...item, status: 'running' } : item));
    task = await store.updateTask(task._id, { status: 'running', steps });
    sendEvent(res, 'task', task);
    await sleep(400);

    const result = await agentTools.launchAfterApproval();
    const finished = task.steps.map((item) =>
      item.id === 'approval' ? { ...item, status: 'success', result } : item
    );
    task = await store.updateTask(task._id, {
      status: 'success',
      approvalRequired: false,
      steps: finished,
      outputs: [...(task.outputs || []), result]
    });
    sendEvent(res, 'tool', { stepId: 'approval', result });
    sendEvent(res, 'task', task);
    closeSse(res);
  });

  router.post('/tasks/:id/rollback', async (req, res) => {
    const task = await store.getTask(req.params.id);
    if (!task) return res.status(404).json({ message: 'task not found' });

    const rolledBack = await store.updateTask(task._id, {
      status: 'rolled_back',
      approvalRequired: false,
      rollback: {
        by: req.user._id,
        at: new Date().toISOString(),
        summary: '已撤回草稿态优惠券、Push 和投放配置'
      }
    });
    res.json({ task: rolledBack });
  });

  return router;
}
