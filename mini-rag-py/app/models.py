from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class QueryRequest(BaseModel):
    """RAG 查询请求。

    tenant_id 刻意不在请求体中：租户必须由认证后的 principal 解析，
    客户端若提交未知字段会被拒绝，而不是被静默忽略。
    - top_k 有界，防止一次请求拖垮上下文。
    """

    model_config = ConfigDict(extra="forbid")

    question: str = Field(min_length=1, max_length=2000)
    top_k: int = Field(default=5, ge=1, le=20)


class Citation(BaseModel):
    """单条检索证据。"""

    chunk_id: str
    excerpt: str
    score: float
    source: str


class QueryResponse(BaseModel):
    """RAG 查询响应。

    - knowledge_gap=True 表示检索零命中，明确返回知识缺口，
      而不是把"没有证据"伪装成系统故障或让模型编造。
    - model 为实际使用的模型 ID（LLM 未被调用时为 None）。
    """

    status: Literal["ok", "knowledge_gap"]
    answer: str | None
    citations: list[Citation]
    knowledge_gap: bool
    request_id: str
    model: str | None = None


class ErrorDetail(BaseModel):
    code: str
    message: str
    retryable: bool
    fallback_allowed: bool


class ErrorResponse(BaseModel):
    status: Literal["error"] = "error"
    error: ErrorDetail
    request_id: str
