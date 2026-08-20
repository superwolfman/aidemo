from fastapi import FastAPI, HTTPException

from .llm_client import LLMClient, LLMConfigError, LLMTimeoutError, LLMUpstreamError
from .models import QueryRequest, QueryResponse, SourceHit
from .retriever import DEFAULT_DOCS, InMemoryRetriever

retriever = InMemoryRetriever(DEFAULT_DOCS)
llm = LLMClient()

app = FastAPI(
    title="mini-rag-py",
    version="0.1.0",
    description="最小 RAG 代理服务：检索前租户过滤 + 零命中显式知识缺口 + LLM 错误分类。",
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "mini-rag-py"}


@app.post("/query", response_model=QueryResponse)
def query(req: QueryRequest) -> QueryResponse:
    # 1. 检索（租户过滤在检索阶段完成，不在召回后隐藏）
    hits = retriever.search(req.question, tenant_id=req.tenant_id, top_k=req.top_k)

    # 2. 零命中 -> 显式知识缺口，不调用 LLM、不让模型编造
    if not hits:
        return QueryResponse(
            answer=(
                "当前知识库中没有找到与该问题相关的已审核证据，"
                "属于知识缺口而非系统故障。建议补充对应知识或扩大检索范围。"
            ),
            sources=[],
            knowledge_gap=True,
            model=None,
        )

    # 3. 有证据 -> 调用 LLM 生成，携带引用约束
    try:
        answer, model = llm.generate_answer(req.question, hits)
    except LLMTimeoutError as exc:
        raise HTTPException(status_code=504, detail=str(exc)) from exc
    except LLMConfigError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except LLMUpstreamError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return QueryResponse(
        answer=answer,
        sources=[SourceHit(**hit) for hit in hits],
        knowledge_gap=False,
        model=model,
    )
