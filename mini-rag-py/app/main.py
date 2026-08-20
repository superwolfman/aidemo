"""FastAPI 入口：认证租户边界、RAG 编排和稳定错误契约。"""

import logging
import re
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .auth import Principal, resolve_principal
from .errors import ServiceError
from .llm_client import AnswerProvider, LLMConfigurationError, build_answer_provider
from .models import Citation, ErrorDetail, ErrorResponse, QueryRequest, QueryResponse
from .retriever import DEFAULT_DOCS, InMemoryRetriever

logger = logging.getLogger(__name__)
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{8,80}$")

retriever = InMemoryRetriever(DEFAULT_DOCS)
answer_provider = build_answer_provider()


def get_retriever() -> InMemoryRetriever:
    return retriever


def get_answer_provider() -> AnswerProvider:
    return answer_provider


app = FastAPI(
    title="mini-rag-py",
    version="0.2.0",
    description="认证租户边界 + 检索前过滤 + Knowledge Gap + 可操作的 LLM 错误分类。",
)


def _request_id(request: Request) -> str:
    return getattr(request.state, "request_id", f"req_{uuid4().hex}")


def _error_response(request: Request, error: ServiceError) -> JSONResponse:
    payload = ErrorResponse(
        error=ErrorDetail(
            code=error.code,
            message=error.message,
            retryable=error.retryable,
            fallback_allowed=error.fallback_allowed,
        ),
        request_id=_request_id(request),
    )
    headers = {"X-Request-ID": payload.request_id}
    if error.status_code == 401:
        headers["WWW-Authenticate"] = "Bearer"
    return JSONResponse(
        status_code=error.status_code,
        content=payload.model_dump(),
        headers=headers,
    )


@app.middleware("http")
async def attach_request_id(request: Request, call_next):
    supplied = request.headers.get("X-Request-ID", "")
    request.state.request_id = (
        supplied if REQUEST_ID_PATTERN.fullmatch(supplied) else f"req_{uuid4().hex}"
    )
    response = await call_next(request)
    response.headers["X-Request-ID"] = request.state.request_id
    return response


@app.exception_handler(ServiceError)
async def handle_service_error(request: Request, exc: ServiceError) -> JSONResponse:
    return _error_response(request, exc)


@app.exception_handler(RequestValidationError)
async def handle_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    del exc
    return _error_response(
        request,
        ServiceError("invalid_request", "请求参数校验失败", 422),
    )


@app.exception_handler(HTTPException)
async def handle_http_error(request: Request, exc: HTTPException) -> JSONResponse:
    return _error_response(
        request,
        ServiceError("http_error", str(exc.detail), exc.status_code),
    )


@app.exception_handler(Exception)
async def handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("unexpected request failure request_id=%s", _request_id(request), exc_info=exc)
    return _error_response(
        request,
        ServiceError("internal_error", "服务内部错误", 500),
    )


@app.get("/healthz")
def healthz(request: Request) -> dict[str, str]:
    return {
        "status": "ok",
        "service": "mini-rag-py",
        "request_id": _request_id(request),
    }


@app.get("/readyz")
def readyz(
    request: Request,
    search: InMemoryRetriever = Depends(get_retriever),
    provider: AnswerProvider = Depends(get_answer_provider),
) -> dict[str, object]:
    search_ready, search_detail = search.readiness()
    llm_ready, llm_detail = provider.readiness()
    if not search_ready:
        raise ServiceError("retriever_not_ready", search_detail, 503, retryable=True)
    if not llm_ready:
        raise LLMConfigurationError(llm_detail)
    return {
        "status": "ready",
        "checks": {"retriever": search_detail, "llm_provider": llm_detail},
        "request_id": _request_id(request),
    }


@app.post("/query", response_model=QueryResponse)
def query(
    req: QueryRequest,
    request: Request,
    principal: Principal = Depends(resolve_principal),
    search: InMemoryRetriever = Depends(get_retriever),
    provider: AnswerProvider = Depends(get_answer_provider),
) -> QueryResponse:
    # tenant_id 只来自已认证 principal，且认证依赖已完成 membership 校验。
    hits = search.search(
        req.question,
        tenant_id=principal.active_tenant_id,
        top_k=req.top_k,
    )

    if not hits:
        return QueryResponse(
            status="knowledge_gap",
            answer=None,
            citations=[],
            knowledge_gap=True,
            request_id=_request_id(request),
            model=None,
        )

    answer, model = provider.generate_answer(req.question, hits)
    return QueryResponse(
        status="ok",
        answer=answer,
        citations=[
            Citation(
                chunk_id=hit["id"],
                excerpt=hit["excerpt"],
                score=hit["score"],
                source=hit["source"],
            )
            for hit in hits
        ],
        knowledge_gap=False,
        request_id=_request_id(request),
        model=model,
    )
