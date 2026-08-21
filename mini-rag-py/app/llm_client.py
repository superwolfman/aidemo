"""可注入的回答 Provider，以及 OpenAI SDK 的稳定错误分类。"""

import json
import os
import threading
import time
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.error import URLError
from urllib.request import Request, urlopen

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


@dataclass(frozen=True)
class RuntimeModelConfig:
    provider: str
    model: str
    version: int = 0
    source: str = "environment"


class RuntimeModelResolver:
    """从主应用读取当前模型路由；不可用时回退到 Python 环境配置。"""

    def __init__(self) -> None:
        self._url = os.getenv(
            "AIDEMO_RUNTIME_MODEL_URL",
            "http://127.0.0.1:4000/api/runtime/model-config",
        ).strip()
        self._cache_seconds = float(os.getenv("AIDEMO_RUNTIME_MODEL_CACHE_SECONDS", "5"))
        self._request_timeout = float(os.getenv("AIDEMO_RUNTIME_MODEL_TIMEOUT_SECONDS", "1.5"))
        self._cached: RuntimeModelConfig | None = None
        self._cached_at = 0.0
        self._lock = threading.Lock()

    def _environment_fallback(self) -> RuntimeModelConfig:
        base_url = os.getenv("OPENAI_BASE_URL", "").lower()
        default_provider = "dashscope" if "dashscope" in base_url else "openai"
        return RuntimeModelConfig(
            provider=os.getenv("RAG_LLM_PROVIDER", default_provider).strip().lower(),
            model=os.getenv("RAG_LLM_MODEL", "gpt-4o-mini").strip(),
        )

    def resolve(self) -> RuntimeModelConfig:
        now = time.monotonic()
        with self._lock:
            if self._cached and now - self._cached_at < self._cache_seconds:
                return self._cached

            resolved = self._environment_fallback()
            if self._url:
                try:
                    request = Request(self._url, headers={"Accept": "application/json"})
                    with urlopen(request, timeout=self._request_timeout) as response:
                        payload = json.loads(response.read().decode("utf-8"))
                    primary = payload.get("primary") or {}
                    provider = str(primary.get("provider") or "").strip().lower()
                    model = str(primary.get("model") or "").strip()
                    if not provider or not model:
                        raise ValueError("runtime model response has no primary provider/model")
                    resolved = RuntimeModelConfig(
                        provider=provider,
                        model=model,
                        version=int(payload.get("version") or 0),
                        source=str(payload.get("source") or "runtime_settings"),
                    )
                except (OSError, URLError, TimeoutError, ValueError, json.JSONDecodeError):
                    # 主应用未启动或暂时不可达时，mini-rag-py 仍可独立运行。
                    resolved = self._environment_fallback()

            self._cached = resolved
            self._cached_at = now
            return resolved


class OpenAIAnswerProvider:
    """生产路径：懒初始化 OpenAI 客户端，零命中时完全不触发 SDK。"""

    def __init__(self) -> None:
        self._client: OpenAI | None = None
        self._client_signature: tuple[str, str | None, str] | None = None
        self._resolver = RuntimeModelResolver()
        self._timeout = float(os.getenv("RAG_LLM_TIMEOUT_SECONDS", "30"))

    def readiness(self) -> tuple[bool, str]:
        model_config = self._resolver.resolve()
        if not self._api_key(model_config.provider):
            return False, f"{self._api_key_name(model_config.provider)} is not configured"
        return True, (
            f"ready ({model_config.provider}/{model_config.model}, "
            f"source={model_config.source}, version={model_config.version})"
        )

    @staticmethod
    def _api_key_name(provider: str) -> str:
        return {
            "dashscope": "DASHSCOPE_API_KEY or OPENAI_API_KEY",
            "deepseek": "DEEPSEEK_API_KEY or OPENAI_API_KEY",
        }.get(provider, "OPENAI_API_KEY")

    @staticmethod
    def _api_key(provider: str) -> str:
        if provider == "dashscope":
            return os.getenv("DASHSCOPE_API_KEY") or os.getenv("OPENAI_API_KEY", "")
        if provider == "deepseek":
            return os.getenv("DEEPSEEK_API_KEY") or os.getenv("OPENAI_API_KEY", "")
        return os.getenv("OPENAI_API_KEY", "")

    @staticmethod
    def _base_url(provider: str) -> str | None:
        legacy_url = os.getenv("OPENAI_BASE_URL", "").strip()
        if provider == "dashscope":
            return (
                os.getenv("DASHSCOPE_BASE_URL")
                or (legacy_url if "dashscope" in legacy_url.lower() else "")
                or "https://dashscope.aliyuncs.com/compatible-mode/v1"
            )
        if provider == "deepseek":
            return os.getenv("DEEPSEEK_BASE_URL") or "https://api.deepseek.com"
        if legacy_url and not any(name in legacy_url.lower() for name in ("dashscope", "deepseek")):
            return legacy_url
        return None

    def _ensure_client(self, model_config: RuntimeModelConfig) -> OpenAI:
        api_key = self._api_key(model_config.provider)
        if not api_key:
            raise LLMConfigurationError(
                f"服务端未配置 {self._api_key_name(model_config.provider)}"
            )
        base_url = self._base_url(model_config.provider)
        signature = (model_config.provider, base_url, api_key)
        if self._client is None or self._client_signature != signature:
            self._client = OpenAI(
                api_key=api_key,
                base_url=base_url,
            )
            self._client_signature = signature
        return self._client

    def generate_answer(self, question: str, hits: list[dict[str, Any]]) -> tuple[str, str]:
        model_config = self._resolver.resolve()
        client = self._ensure_client(model_config)
        model = model_config.model
        evidence = "\n\n".join(
            f"[{index}] {hit['excerpt']}" for index, hit in enumerate(hits, start=1)
        )

        try:
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": f"证据：\n{evidence}\n\n问题：{question}"},
                ],
                timeout=self._timeout,
            )
        except APITimeoutError as exc:
            raise LLMTimeoutError(
                f"LLM upstream timeout after {self._timeout}s (model={model})"
            ) from exc
        except AuthenticationError as exc:
            raise LLMAuthenticationError(
                f"LLM authentication failed (model={model})"
            ) from exc
        except RateLimitError as exc:
            raise LLMRateLimitError(f"LLM rate limited (model={model})") from exc
        except APIConnectionError as exc:
            raise LLMUpstreamError(f"LLM connection failed (model={model})") from exc
        except APIStatusError as exc:
            if _is_content_safety_rejection(exc):
                raise LLMContentSafetyError("LLM request rejected by content safety policy") from exc
            if exc.status_code and exc.status_code >= 500:
                raise LLMUpstreamError(
                    f"LLM upstream {exc.status_code} (model={model})"
                ) from exc
            raise LLMRequestRejectedError(
                f"LLM rejected request with status {exc.status_code} (model={model})"
            ) from exc

        text = (response.choices[0].message.content or "").strip()
        if not text:
            raise LLMUpstreamError(f"LLM returned an empty response (model={model})")
        return text, model


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
