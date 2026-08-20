# mini-rag-py

一个刻意保持小而完整的 FastAPI RAG 服务，用于演示生产级信任边界，而不是堆叠框架：

- Bearer token 解析 principal，租户来自认证身份且经过 membership 校验；
- tenant filter 在召回和打分之前执行；
- 零命中返回 `knowledge_gap`、`answer: null`，并且不调用 LLM；
- `request_id`、稳定错误码、`retryable` 和 `fallback_allowed`；
- `/healthz` 存活检查与 `/readyz` 依赖就绪检查；
- Provider 依赖注入，自动化测试不访问真实模型。

完整面试话术和逐步命令见 [INTERVIEW_DEMO.md](INTERVIEW_DEMO.md)。

## 安装与测试

```bash
cd mini-rag-py
uv sync --extra dev
uv run --extra dev pytest tests -q
```

也可以使用 Python 3.10+ 的 venv：

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
pytest tests -q
```

## 无外部依赖的面试演示

```bash
RAG_LLM_MODE=stub uv run uvicorn app.main:app --port 8100
```

另开终端：

```bash
curl -s http://localhost:8100/healthz | python3 -m json.tool
curl -s http://localhost:8100/readyz | python3 -m json.tool

curl -s -X POST http://localhost:8100/query \
  -H 'Authorization: Bearer demo-store-token' \
  -H 'Content-Type: application/json' \
  -d '{"question":"门店退换货政策是什么？"}' | python3 -m json.tool
```

或者安装完成后直接运行：

```bash
bash demo.sh
```

## 使用 OpenAI 兼容端点

不设置 `RAG_LLM_MODE=stub` 时默认使用 OpenAI Provider：

```bash
export OPENAI_API_KEY=sk-xxxx
export OPENAI_BASE_URL=https://example.com/v1  # 官方端点可省略
export RAG_LLM_MODEL=gpt-4o-mini
export RAG_LLM_TIMEOUT_SECONDS=30
uv run uvicorn app.main:app --port 8100
```

演示 token 仅用于说明认证后的 principal 如何约束租户。生产环境必须替换为 JWT/Session 校验与真实 IAM 或数据库 membership 查询。
