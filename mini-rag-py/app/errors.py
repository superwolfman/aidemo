"""服务边界使用的稳定错误类型与 JSON 契约。"""

from dataclasses import dataclass


@dataclass(slots=True)
class ServiceError(Exception):
    code: str
    message: str
    status_code: int
    retryable: bool = False
    fallback_allowed: bool = False

    def __str__(self) -> str:
        return self.message
