import express from 'express';
import { aiService } from '../services/aiService.js';
import { closeSse, initSse, sendEvent } from '../utils/sse.js';

export function aiRouter() {
  const router = express.Router();

  router.post('/campaign/stream', async (req, res) => {
    initSse(res);
    sendEvent(res, 'meta', { type: 'campaign-plan', title: '活动方案生成' });
    await aiService.streamMarkdown(res, aiService.campaignPlan(req.body), sendEvent);
    closeSse(res);
  });

  router.post('/materials/stream', async (req, res) => {
    initSse(res);
    sendEvent(res, 'meta', { type: 'materials', title: '投放素材生成' });
    await aiService.streamMarkdown(res, aiService.materials(req.body), sendEvent);
    closeSse(res);
  });

  router.post('/attribution/stream', async (req, res) => {
    initSse(res);
    sendEvent(res, 'meta', { type: 'attribution', title: '数据归因分析' });
    await aiService.streamMarkdown(res, aiService.attribution(req.body), sendEvent);
    closeSse(res);
  });

  return router;
}
