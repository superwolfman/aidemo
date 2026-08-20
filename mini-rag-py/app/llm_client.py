"""LLM 客户端：OpenAI SDK + 错误分类。

错误分类原则（与 aidemo 的模型治理设计对齐）：
- 超时（APITimeoutError）        -> LLMTimeoutError  -> HTTP 504，可 fallback
- 鉴权失败（AuthenticationError）-> LLMConfigError   -> HTTP 500，禁止 fallback（配置问题切模型没意义）
- 限流 / 连接失败 / 上游 5xx     -> LLMUpstreamError -> HTTP 502，可按策略重试或 fallback

注意 openai SDK 中 APITimeoutError 是 APIConnectionError 的子类，
必须先判断超时，再兜底连接错误。
"""

import os
from typing import Any

from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AuthenticationError,
    OpenAI,
    RateLimitError,
)


class LLMTimeoutError(Exception):
    """上游模型超时 —— 对应 HTTP 504。"""


class LLMConfigError(Exception):
    """配置错误（缺 Key / 鉴权失败）—— 对应 HTTP 500，不允许 fallback。"""


class LLMUpstreamError(Exception):
    """上游暂时性错误（限流 / 连接 / 5xx）—— 对应 HTTP 502，可重试或 fallback。"""


SYSTEM_PROMPT = (
    "你是一个企业知识库问答助手。只能依据提供的证据片段回答问题。"
    "引用证据时使用 [1]、[2] 这样的序号标注。"
    "如果证据不足以回答问题，直接说明信息不足，不要编造。"
)


class LLMClient:
    def __init__(self) -> None:
        self._client: OpenAI | None = None
        self._model = os.getenv("RAG_LLM_MODEL", "gpt-4o-mini")
        self._timeout = float(os.getenv("RAG_LLM_TIMEOUT_SECONDS", "30"))

    def _ensure_client(self) -> OpenAI:
        """懒初始化：零命中路径完全不触发 LLM，也不要求配置 Key。"""
        if self._client is None:
            api_key = os.getenv("OPENAI_API_KEY")
            if not api_key:
                raise LLMConfigError(
                    "OPENAI_API_KEY 未配置：请设置后重试，或使用任意 OpenAI 兼容端点"
                    "（例如 DashScope compatible-mode）并通过 OPENAI_BASE_URL 指定。"
                )
            base_url = os.getenv("OPENAI_BASE_URL") or None
            self._client = OpenAI(api_key=api_key, base_url=base_url)
        return self._client

    def generate_answer(self, question: str, hits: list[dict[str, Any]]) -> tuple[str, str]:
        """基于检索证据生成回答，返回 (answer, model)。"""
        client = self._ensure_client()
        evidence = "\n\n".join(
            f"[{i}] {hit['excerpt']}" for i, hit in enumerate(hits, start=1)
        )
        user_content = f"证据：\n{evidence}\n\n问题：{question}"

        try:
            response = client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_content},
                ],
                timeout=self._timeout,
            )
        except APITimeoutError as exc:
            raise LLMTimeoutError(
                f"LLM upstream timeout after {self._timeout}s (model={self._model})"
            ) from exc
        except AuthenticationError as exc:
            raise LLMConfigError(f"LLM authentication failed (model={self._model})") from exc
        except RateLimitError as exc:
            raise LLMUpstreamError(f"LLM rate limited (model={self._model})") from exc
        except APIConnectionError as exc:
            raise LLMUpstreamError(f"LLM connection failed (model={self._model})") from exc
        except APIStatusError as exc:
            if exc.status_code and exc.status_code >= 500:
                raise LLMUpstreamError(
                    f"LLM upstream {exc.status_code} (model={self._model})"
                ) from exc
            raise LLMUpstreamError(
                f"LLM unexpected status {exc.status_code} (model={self._model})"
            ) from exc

        text = (response.choices[0].message.content or "").strip()
        if not text:
            return "（模型未返回内容，请检查上游配置）", self._model
        return text, self._model
