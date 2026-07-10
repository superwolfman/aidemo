import express from 'express';
import { aiService } from '../services/aiService.js';
import { closeSse, initSse, sendEvent } from '../utils/sse.js';

export function architectRouter() {
  const router = express.Router();

  router.get('/capabilities', (req, res) => {
    res.json({
      capabilities: [
        {
          title: '微前端与模块化',
          description: 'Shell + 子应用，适配 qiankun / Module Federation / 多仓渐进接入',
          metrics: ['5 个遗留系统整合', '60+ 业务场景', '独立发布']
        },
        {
          title: 'Monorepo 工程治理',
          description: '统一构建、公共包、CI/CD、Docker/Nginx、CDN 与回滚',
          metrics: ['成本降低 91.7%', '构建提速 8 倍', '镜像 2.8GB -> 280MB']
        },
        {
          title: '可观测性与高可用',
          description: 'Logger SDK、Trace、Web Vitals、主备探测、关键 API 容灾',
          metrics: ['MTTR 分钟级', '12 次大版本 0 P0', '覆盖 95%+ 核心系统']
        },
        {
          title: '低代码与画布内核',
          description: 'Document Model、Plugin、Selection、History、Command、Worker 布局',
          metrics: ['1000+ 节点', '<50ms 响应', '4 条业务线复用']
        },
        {
          title: '全球化与跨端',
          description: 'i18n SDK、RTL、时区策略、H5/WebView/RN 协议复用',
          metrics: ['新市场周期缩短 70%', '6 种语言', '翻译覆盖率 95%+']
        },
        {
          title: 'AI 工程化',
          description: 'RAG、Agent、Tool Calling、AI Review、Mock/Test 生成、发布清单',
          metrics: ['效率体系化', '高风险人工确认', '全链路审计']
        }
      ]
    });
  });

  router.post('/plan/stream', async (req, res) => {
    initSse(res);
    sendEvent(res, 'meta', { type: 'architecture-copilot', title: '企业级 AI 平台架构方案' });
    await aiService.streamMarkdown(res, aiService.architecturePlan(req.body), sendEvent);
    closeSse(res);
  });

  return router;
}
