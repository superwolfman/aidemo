"""mini-rag-py 核心行为测试。

覆盖面试要讲的三个设计点：
1. 零命中 -> knowledge_gap=True 且不触发 LLM
2. 有证据 -> 正常返回带引用来源的回答
3. LLM 超时 -> 504（错误分类），鉴权/配置错误 -> 500
4. 租户过滤发生在检索之前
"""

from fastapi.testclient import TestClient

from app.main import app, llm
from app.llm_client import LLMConfigError, LLMTimeoutError

client = TestClient(app)


def test_health() -> None:
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_query_knowledge_gap_without_llm(monkeypatch) -> None:
    """零命中：显式 knowledge_gap，且绝不调用 LLM。"""

    def _fail_if_called(*args, **kwargs):
        raise AssertionError("knowledge gap path must not call the LLM")

    monkeypatch.setattr(llm, "generate_answer", _fail_if_called)

    resp = client.post("/query", json={"question": "薛定谔方程的边界条件怎么求解"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["knowledge_gap"] is True
    assert body["sources"] == []
    assert body["model"] is None


def test_query_with_hits_and_citation(monkeypatch) -> None:
    """有证据：LLM 被调用，返回来源与模型信息。"""

    def _fake_generate(question, hits):
        return f"根据门店 SOP，{hits[0]['source']} 规定退货需在30天内办理 [1]。", "stub-model"

    monkeypatch.setattr(llm, "generate_answer", _fake_generate)

    resp = client.post("/query", json={"question": "门店退换货政策是什么"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["knowledge_gap"] is False
    assert len(body["sources"]) >= 1
    assert body["sources"][0]["tenant"] == "store-ops"
    assert "[1]" in body["answer"]
    assert body["model"] == "stub-model"


def test_query_llm_timeout_returns_504(monkeypatch) -> None:
    """LLM 超时被分类为上游超时 -> HTTP 504。"""

    def _raise_timeout(question, hits):
        raise LLMTimeoutError("LLM upstream timeout after 30s")

    monkeypatch.setattr(llm, "generate_answer", _raise_timeout)

    resp = client.post("/query", json={"question": "门店退换货政策是什么"})
    assert resp.status_code == 504
    assert "timeout" in resp.json()["detail"].lower()


def test_query_llm_config_error_returns_500(monkeypatch) -> None:
    """鉴权/配置错误不 fallback、不重试，直接暴露为配置问题 -> HTTP 500。"""

    def _raise_config(question, hits):
        raise LLMConfigError("LLM authentication failed")

    monkeypatch.setattr(llm, "generate_answer", _raise_config)

    resp = client.post("/query", json={"question": "门店退换货政策是什么"})
    assert resp.status_code == 500


def test_tenant_filter_before_scoring() -> None:
    """租户过滤发生在检索阶段：brand-knowledge 租户查不到 store-ops 的退换货内容。"""
    resp = client.post(
        "/query",
        json={"question": "门店退换货政策是什么", "tenant_id": "brand-knowledge"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["knowledge_gap"] is True
    assert body["sources"] == []


def test_request_validation() -> None:
    """Pydantic 边界：空问题 / top_k 越界 -> 422。"""
    assert client.post("/query", json={"question": ""}).status_code == 422
    assert (
        client.post("/query", json={"question": "退货政策", "top_k": 99}).status_code == 422
    )
