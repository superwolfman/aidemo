# mini-rag-py

最小 RAG 代理服务：FastAPI + Pydantic + OpenAI SDK。用于证明 aidemo（Node/TypeScript）中的核心设计可以迁移到 Python 生态。

## 三个核心设计（面试讲法）

1. **租户过滤发生在检索之前** —— 不允许先全量召回再由前端隐藏，与 aidemo 多租户边界一致。
2. **零命中显式返回 knowledge_gap** —— 不调用 LLM、不让模型编造；"没有证据"不是"系统故障"。
3. **LLM 错误分类** —— 超时 → 504（可 fallback）；鉴权/配置错误 → 500（禁止 fallback）；限流/连接/上游 5xx → 502（可重试）。

## 安装与运行

```bash
cd mini-rag-py
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

# 跑测试（不需要任何 API Key）
pytest tests -v

# 起服务（零命中查询同样不需要 Key）
uvicorn app.main:app --port 8100
```

## 配置 LLM（可选）

服务兼容任意 OpenAI 兼容端点，包括 DashScope compatible-mode：

```bash
export OPENAI_API_KEY=sk-xxxx
export OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
export RAG_LLM_MODEL=qwen-plus
export RAG_LLM_TIMEOUT_SECONDS=30
```

## 演示查询

```bash
# 正常命中（store-ops 租户的退货政策）
curl -s -X POST http://localhost:8100/query \
  -H 'Content-Type: application/json' \
  -d '{"question": "门店退换货政策是什么"}' | python3 -m json.tool

# 知识缺口（知识库没有的内容，不调用 LLM）
curl -s -X POST http://localhost:8100/query \
  -H 'Content-Type: application/json' \
  -d '{"question": "薛定谔方程怎么求解"}' | python3 -m json.tool

# 租户过滤（brand-knowledge 租户查不到 store-ops 的内容）
curl -s -X POST http://localhost:8100/query \
  -H 'Content-Type: application/json' \
  -d '{"question": "门店退换货政策是什么", "tenant_id": "brand-knowledge"}' | python3 -m json.tool
```

## 与 aidemo（Node 版）的对应关系

| 设计点 | aidemo (TypeScript) | mini-rag-py (Python) |
|---|---|---|
| 租户过滤在检索前 | Atlas 查询阶段 tenant/scope filter | `retriever.search()` 先 filter 再 score |
| 零命中语义 | knowledge gap 显式返回 | `knowledge_gap=True`，不调 LLM |
| 超时分类 | connect/TTFT/idle/total 分级 | OpenAI SDK timeout → 504 |
| 错误分类 fallback 边界 | 额度耗尽可切、鉴权失败不切 | timeout 可 fallback、auth 禁止 fallback |
| 请求校验 | Zod / 手写校验 | Pydantic `Field` 约束 → 422 |
