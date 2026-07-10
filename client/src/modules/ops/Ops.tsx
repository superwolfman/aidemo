import React from 'react';
import { Card, Header } from '../../components/ui';

export default function Ops() {
  return (
    <section>
      <Header title="统一部署、监控与故障定位" desc="PC/H5/企微静态资源打包、后端容器化、灰度开关、Trace、复盘与知识库沉淀。" />
      <div className="ops-grid">
        <Card title="微前端发布" text="基座与子应用拆分构建，支持按模块灰度、回滚和独立观测。" />
        <Card title="容器化" text="后端服务按 SpringBoot 微服务形态设计，本地用 Node BFF 模拟；生产可 Docker + K8s 部署。" />
        <Card title="静态资源" text="PC/H5/企微内嵌页统一构建，按终端拆分资源，CDN 长缓存，HTML 短缓存。" />
        <Card title="灰度发布" text="按员工、部门、终端、企微 agentId 控制灰度，异常可快速回滚。" />
        <Card title="监控定位" text="采集 release、traceId、employeeId、terminal、SSE 断流、RAG 引用和 Skill 执行日志。" />
        <Card title="事件通信" text="基座事件总线串联子应用，避免隐式 window 状态，通信协议可版本化治理。" />
      </div>
    </section>
  );
}
