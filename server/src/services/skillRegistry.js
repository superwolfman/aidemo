export const agentCapabilities = [
  {
    id: 'product-delivery-agent',
    name: '产研测交付 Agent',
    description: '把自然语言需求转成 PRD、页面方案、接口契约、测试策略和发布清单。',
    intents: ['需求澄清', '页面方案', '接口协同', '研发任务拆解', '测试与发布'],
    tools: ['detectIntent', 'retrieveKnowledge', 'planDelivery', 'generateArtifacts', 'requestHumanReview']
  },
  {
    id: 'knowledge-assistant',
    name: '知识库问答 Agent',
    description: '围绕项目规范、AI Native 交互、RAG 与前端工程约束回答问题并给出引用。',
    intents: ['知识问答', '规范查询', '方案解释', '风险提示'],
    tools: ['detectIntent', 'retrieveKnowledge', 'answerWithCitations']
  },
  {
    id: 'delivery-review-agent',
    name: '交付评审 Agent',
    description: '审查产物完整度、接口合理性、测试缺口、风险和人工确认项。',
    intents: ['方案评审', '测试缺口', '上线风险', '质量门禁'],
    tools: ['detectIntent', 'retrieveKnowledge', 'reviewArtifacts', 'requestHumanReview']
  }
];

export function getAgentCapability(intent) {
  return agentCapabilities.find((capability) => capability.id === intent?.id) || agentCapabilities[0];
}
