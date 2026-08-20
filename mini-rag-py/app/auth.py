"""演示认证依赖：由 Bearer token 解析 principal 和活动租户。

生产环境应把 ``DEMO_PRINCIPALS`` 替换为 JWT / Session 校验以及数据库或
IAM membership 查询。本模块保留完整的信任边界：请求体不能声明 tenant_id，
可选的 ``X-Tenant-ID`` 也必须属于当前 principal 的 memberships。
"""

from dataclasses import dataclass
from hmac import compare_digest

from fastapi import Header

from .errors import ServiceError


@dataclass(frozen=True, slots=True)
class Principal:
    subject: str
    active_tenant_id: str
    memberships: frozenset[str]


DEMO_PRINCIPALS: dict[str, Principal] = {
    "demo-store-token": Principal(
        subject="interviewer-store-user",
        active_tenant_id="store-ops",
        memberships=frozenset({"store-ops"}),
    ),
    "demo-brand-token": Principal(
        subject="interviewer-brand-user",
        active_tenant_id="brand-knowledge",
        memberships=frozenset({"brand-knowledge"}),
    ),
    "demo-multi-token": Principal(
        subject="interviewer-multi-user",
        active_tenant_id="store-ops",
        memberships=frozenset({"store-ops", "brand-knowledge"}),
    ),
}


def _lookup_demo_principal(token: str) -> Principal | None:
    # 固定时间比较避免直接用 == 形成明显的 token 比较时序差异。
    for expected, principal in DEMO_PRINCIPALS.items():
        if compare_digest(token, expected):
            return principal
    return None


def resolve_principal(
    authorization: str | None = Header(default=None, alias="Authorization"),
    selected_tenant: str | None = Header(default=None, alias="X-Tenant-ID"),
) -> Principal:
    if not authorization or not authorization.startswith("Bearer "):
        raise ServiceError(
            code="authentication_required",
            message="需要有效的 Bearer token",
            status_code=401,
        )

    token = authorization.removeprefix("Bearer ").strip()
    principal = _lookup_demo_principal(token)
    if principal is None:
        raise ServiceError(
            code="invalid_access_token",
            message="Bearer token 无效或已过期",
            status_code=401,
        )

    tenant_id = selected_tenant or principal.active_tenant_id
    if tenant_id not in principal.memberships:
        raise ServiceError(
            code="tenant_access_denied",
            message="当前身份不是所选租户的成员",
            status_code=403,
        )

    if tenant_id == principal.active_tenant_id:
        return principal
    return Principal(
        subject=principal.subject,
        active_tenant_id=tenant_id,
        memberships=principal.memberships,
    )
