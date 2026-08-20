"""可注入的回答 Provider，以及 OpenAI SDK 的稳定错误分类。"""

import os
from typing import Any, Protocol

from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AuthenticationError,
    OpenAI,
    RateLimitError,
)

from .errors import ServiceError


class AnswerProvider(Protocol):
    def generate_answer(self, question: str, hits: list[dict[str, Any]]) -> tuple[str, str]: ...

    def readiness(self) -> tuple[bool, str]: ...


class LLMTimeoutError(ServiceError):
    def __init__(self, message: str):
        super().__init__("llm_timeout", message, 504, retryable=True, fallback_allowed=True)


class LLMConfigurationError(ServiceError):
    def __init__(self, message: str):
        super().__init__("llm_not_configured", message, 503)


class LLMAuthenticationError(ServiceError):
    def __init__(self, message: str):
        super().__init__("llm_authentication_failed", message, 502)


class LLMRateLimitError(ServiceError):
    def __init__(self, message: str):
        super().__init__("llm_rate_limited", message, 429, retryable=True, fallback_allowed=True)


class LLMUpstreamError(ServiceError):
    def __init__(self, message: str):
        super().__init__("llm_upstream_unavailable", message, 502, retryable=True, fallback_allowed=True)


class LLMContentSafetyError(ServiceError):
    def __init__(self, message: str):
        super().__init__("llm_content_safety_rejected", message, 422)


class LLMRequestRejectedError(ServiceError):
    def __init__(self, message: str):
        super().__init__("llm_request_rejected", message, 502)


SYSTEM_PROMPT = (
    "你是一个企业知识库问答助手。只能依据提供的证据片段回答问题。"
    "引用证据时使用 [1]、[2] 这样的序号标注。"
    "如果证据不足以回答问题，直接说明信息不足，不要编造。"
)


class OpenAIAnswerProvider:
    """生产路径：懒初始化 OpenAI 客户端，零命中时完全不触发 SDK。"""

    def __init__(self) -> None:
        self._client: OpenAI | None = None
        self._model = os.getenv("RAG_LLM_MODEL", "gpt-4o-mini")
        self._timeout = float(os.getenv("RAG_LLM_TIMEOUT_SECONDS", "30"))

    def readiness(self) -> tuple[bool, str]:
        if not os.getenv("OPENAI_API_KEY"):
            return False, "OPENAI_API_KEY is not configured"
        return True, "ready"

    def _ensure_client(self) -> OpenAI:
        if self._client is None:
            api_key = os.getenv("OPENAI_API_KEY")
            if not api_key:
                raise LLMConfigurationError("服务端未配置 OPENAI_API_KEY")
            self._client = OpenAI(
                api_key=api_key,
                base_url=os.getenv("OPENAI_BASE_URL") or None,
            )
        return self._client

    def generate_answer(self, question: str, hits: list[dict[str, Any]]) -> tuple[str, str]:
        client = self._ensure_client()
        evidence = "\n\n".join(
            f"[{index}] {hit['excerpt']}" for index, hit in enumerate(hits, start=1)
        )

        try:
            response = client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": f"证据：\n{evidence}\n\n问题：{question}"},
                ],
                timeout=self._timeout,
            )
        except APITimeoutError as exc:
            raise LLMTimeoutError(
                f"LLM upstream timeout after {self._timeout}s (model={self._model})"
            ) from exc
        except AuthenticationError as exc:
            raise LLMAuthenticationError(
                f"LLM authentication failed (model={self._model})"
            ) from exc
        except RateLimitError as exc:
            raise LLMRateLimitError(f"LLM rate limited (model={self._model})") from exc
        except APIConnectionError as exc:
            raise LLMUpstreamError(f"LLM connection failed (model={self._model})") from exc
        except APIStatusError as exc:
            if _is_content_safety_rejection(exc):
                raise LLMContentSafetyError("LLM request rejected by content safety policy") from exc
            if exc.status_code and exc.status_code >= 500:
                raise LLMUpstreamError(
                    f"LLM upstream {exc.status_code} (model={self._model})"
                ) from exc
            raise LLMRequestRejectedError(
                f"LLM rejected request with status {exc.status_code} (model={self._model})"
            ) from exc

        text = (response.choices[0].message.content or "").strip()
        if not text:
            raise LLMUpstreamError(f"LLM returned an empty response (model={self._model})")
        return text, self._model


class StubAnswerProvider:
    """仅用于本地面试演示；输出确定、无需网络或 API Key。"""

    def readiness(self) -> tuple[bool, str]:
        return True, "ready"

    def generate_answer(self, question: str, hits: list[dict[str, Any]]) -> tuple[str, str]:
        del question
        return f"根据已审核证据：{hits[0]['excerpt']} [1]", "local-stub"


def _is_content_safety_rejection(exc: APIStatusError) -> bool:
    body = str(getattr(exc, "body", "")).lower()
    return any(marker in body for marker in ("content_filter", "content safety", "safety policy"))


def build_answer_provider() -> AnswerProvider:
    if os.getenv("RAG_LLM_MODE", "openai").lower() == "stub":
        return StubAnswerProvider()
    return OpenAIAnswerProvider()
