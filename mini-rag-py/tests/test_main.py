"""只使用依赖注入 Stub 的 API 契约测试，不访问真实 LLM。"""

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.llm_client import LLMTimeoutError
from app.main import app, get_answer_provider

STORE_AUTH = {"Authorization": "Bearer demo-store-token"}
BRAND_AUTH = {"Authorization": "Bearer demo-brand-token"}


class StubProvider:
    def __init__(self) -> None:
        self.calls = 0
        self.error: Exception | None = None

    def readiness(self) -> tuple[bool, str]:
        return True, "stub-ready"

    def generate_answer(
        self, question: str, hits: list[dict[str, Any]]
    ) -> tuple[str, str]:
        self.calls += 1
        if self.error:
            raise self.error
        return f"{question}：根据门店 SOP，应在30天内办理 [1]。", "stub-model"


@pytest.fixture()
def provider() -> StubProvider:
    stub = StubProvider()
    app.dependency_overrides[get_answer_provider] = lambda: stub
    yield stub
    app.dependency_overrides.clear()


@pytest.fixture()
def client(provider: StubProvider) -> TestClient:
    del provider
    return TestClient(app)


def test_healthz_and_readyz(client: TestClient) -> None:
    health = client.get("/healthz")
    ready = client.get("/readyz")

    assert health.status_code == 200
    assert health.json()["status"] == "ok"
    assert ready.status_code == 200
    assert ready.json()["status"] == "ready"
    assert ready.json()["checks"]["llm_provider"] == "stub-ready"


def test_normal_hit_returns_citation_and_request_id(
    client: TestClient, provider: StubProvider
) -> None:
    response = client.post(
        "/query",
        headers={**STORE_AUTH, "X-Request-ID": "interview_req_001"},
        json={"question": "门店退换货政策是什么"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["knowledge_gap"] is False
    assert body["request_id"] == "interview_req_001"
    assert response.headers["X-Request-ID"] == "interview_req_001"
    assert body["citations"][0]["chunk_id"] == "store-sop-return"
    assert body["citations"][0]["score"] > 0
    assert "[1]" in body["answer"]
    assert body["model"] == "stub-model"
    assert provider.calls == 1


def test_knowledge_gap_has_null_answer_and_does_not_call_llm(
    client: TestClient, provider: StubProvider
) -> None:
    response = client.post(
        "/query",
        headers=STORE_AUTH,
        json={"question": "薛定谔方程的边界条件怎么求解"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "knowledge_gap"
    assert body["knowledge_gap"] is True
    assert body["answer"] is None
    assert body["citations"] == []
    assert body["model"] is None
    assert body["request_id"].startswith("req_")
    assert provider.calls == 0


def test_cross_tenant_document_is_invisible_before_scoring(
    client: TestClient, provider: StubProvider
) -> None:
    response = client.post(
        "/query",
        headers=BRAND_AUTH,
        json={"question": "门店退换货政策是什么"},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "knowledge_gap"
    assert response.json()["citations"] == []
    assert provider.calls == 0


def test_client_cannot_declare_tenant_in_body(client: TestClient) -> None:
    response = client.post(
        "/query",
        headers=BRAND_AUTH,
        json={"question": "门店退换货政策是什么", "tenant_id": "store-ops"},
    )

    assert response.status_code == 422
    assert response.json()["error"] == {
        "code": "invalid_request",
        "message": "请求参数校验失败",
        "retryable": False,
        "fallback_allowed": False,
    }


def test_workspace_selection_requires_membership(client: TestClient) -> None:
    response = client.post(
        "/query",
        headers={**BRAND_AUTH, "X-Tenant-ID": "store-ops"},
        json={"question": "门店退换货政策是什么"},
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "tenant_access_denied"
    assert response.json()["error"]["retryable"] is False


def test_multi_tenant_member_can_select_workspace(client: TestClient) -> None:
    response = client.post(
        "/query",
        headers={
            "Authorization": "Bearer demo-multi-token",
            "X-Tenant-ID": "brand-knowledge",
        },
        json={"question": "皮革制品怎么保养"},
    )

    assert response.status_code == 200
    assert response.json()["citations"][0]["chunk_id"] == "brand-care-leather"


def test_authentication_is_required(client: TestClient) -> None:
    response = client.post("/query", json={"question": "退换货政策"})

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "authentication_required"
    assert response.headers["WWW-Authenticate"] == "Bearer"


def test_llm_timeout_has_stable_retry_contract(
    client: TestClient, provider: StubProvider
) -> None:
    provider.error = LLMTimeoutError("LLM upstream timeout after 30s")

    response = client.post(
        "/query",
        headers=STORE_AUTH,
        json={"question": "门店退换货政策是什么"},
    )

    assert response.status_code == 504
    assert response.json()["error"] == {
        "code": "llm_timeout",
        "message": "LLM upstream timeout after 30s",
        "retryable": True,
        "fallback_allowed": True,
    }
    assert response.json()["request_id"].startswith("req_")


def test_request_validation_uses_structured_error(client: TestClient) -> None:
    response = client.post(
        "/query",
        headers=STORE_AUTH,
        json={"question": "退货", "top_k": 99},
    )

    assert response.status_code == 422
    assert response.json()["status"] == "error"
    assert response.json()["error"]["code"] == "invalid_request"
    assert response.json()["error"]["retryable"] is False
