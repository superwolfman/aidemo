from pydantic import BaseModel, Field


class QueryRequest(BaseModel):
    """RAG 查询请求。

    - tenant_id 用于演示"租户过滤发生在检索之前，而不是召回后再隐藏"。
    - top_k 有界，防止一次请求拖垮上下文。
    """

    question: str = Field(min_length=1, max_length=2000)
    top_k: int = Field(default=5, ge=1, le=20)
    tenant_id: str | None = Field(default=None, max_length=120)


class SourceHit(BaseModel):
    """单条检索证据。"""

    id: str
    excerpt: str
    score: float
    source: str
    tenant: str


class QueryResponse(BaseModel):
    """RAG 查询响应。

    - knowledge_gap=True 表示检索零命中，明确返回知识缺口，
      而不是把"没有证据"伪装成系统故障或让模型编造。
    - model 为实际使用的模型 ID（LLM 未被调用时为 None）。
    """

    answer: str
    sources: list[SourceHit]
    knowledge_gap: bool
    model: str | None = None
