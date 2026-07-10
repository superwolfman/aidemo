import { aiService } from './aiService.js';

export const agentTools = {
  async retrieveKnowledge(store, goal) {
    const chunks = await store.searchChunks(goal, 4);
    return {
      tool: 'rag.retrieve',
      summary: `召回 ${chunks.length} 条知识片段`,
      data: chunks.map((chunk) => ({
        documentTitle: chunk.documentTitle,
        score: chunk.score,
        preview: chunk.content.slice(0, 120)
      }))
    };
  },

  async generateCampaign(goal) {
    return {
      tool: 'campaign.generate',
      summary: '已生成活动策略草案',
      data: aiService.campaignPlan({ objective: goal })
    };
  },

  async generateMaterials(goal) {
    return {
      tool: 'materials.generate',
      summary: '已生成投放素材草案',
      data: aiService.materials({ product: goal })
    };
  },

  async analyzeAttribution(goal) {
    return {
      tool: 'attribution.analyze',
      summary: '已完成模拟归因分析',
      data: aiService.attribution({ campaign: goal })
    };
  },

  async createCouponDraft() {
    return {
      tool: 'coupon.createDraft',
      summary: '已创建优惠券草稿，等待人工确认',
      data: {
        couponName: '新客首单立减券',
        value: '满 99 减 20',
        validDays: 3,
        rollback: '删除券草稿或置为未生效'
      }
    };
  },

  async createPushDraft(goal) {
    return {
      tool: 'push.createDraft',
      summary: '已创建 Push 草稿，等待人工确认',
      data: {
        title: '限时福利已开启',
        body: `${goal}，现在进入会场领取专属权益。`,
        rollback: '撤回待发送 Push 任务'
      }
    };
  },

  async launchAfterApproval() {
    return {
      tool: 'ops.launch',
      summary: '已模拟执行广告投放、优惠券生效和 Push 发送',
      data: {
        adCampaignId: `AD-${Date.now()}`,
        pushBatchId: `PUSH-${Date.now()}`,
        couponStatus: 'active'
      }
    };
  }
};
