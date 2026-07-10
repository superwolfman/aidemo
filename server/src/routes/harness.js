import express from 'express';
import { aiService } from '../services/aiService.js';
import { closeSse, initSse, sendEvent } from '../utils/sse.js';

export function harnessRouter() {
  const router = express.Router();

  router.get('/playbook', (req, res) => {
    res.json({
      modules: [
        {
          name: 'RAG 质量评估',
          owner: '前端架构 + BFF',
          checks: ['召回来源可解释', '上下文长度可控', '低相关结果降权', '引用文档可追踪']
        },
        {
          name: 'Agent 状态机',
          owner: '前端工作流',
          checks: ['任务步骤可视化', '高风险动作人工确认', '失败可重试', '草稿动作可回滚']
        },
        {
          name: 'AI Coding Harness',
          owner: '研发效能',
          checks: ['单测模板生成', '接口 Mock 生成', 'PR 检查清单', '灰度发布清单']
        }
      ]
    });
  });

  router.post('/plan/stream', async (req, res) => {
    initSse(res);
    sendEvent(res, 'meta', { type: 'ai-harness', title: 'AI 研发提效方案' });
    await aiService.streamMarkdown(res, aiService.harnessPlan(req.body), sendEvent);
    closeSse(res);
  });

  return router;
}
