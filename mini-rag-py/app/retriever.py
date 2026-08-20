"""内存检索器：写死的演示文档 + 字符级 bigram 词袋余弦。

刻意不做 BM25 / 向量库 / rerank —— 这个项目的目标是证明
"检索前租户过滤 + 零命中显式返回" 这两个核心设计可以迁移到 Python，
而不是复刻一个完整检索引擎。
"""

import math
import re
from collections import Counter
from typing import Any

# 演示文档：奢侈品门店运营场景（与 KERING 业务语境对齐）。
# 每条带 tenant、source（来源+版本），对应"证据可追溯"的讲法。
DEFAULT_DOCS: list[dict[str, Any]] = [
    {
        "id": "store-sop-return",
        "tenant": "store-ops",
        "source": "门店运营SOP v3.2 (2026-03)",
        "text": (
            "门店退换货政策：自购买之日起30天内，凭有效小票且商品未使用、"
            "吊牌完整可办理退换。定制类商品、内衣及香水除外。"
            "退款将在7个工作日内原路退回。"
        ),
    },
    {
        "id": "store-sop-vip",
        "tenant": "store-ops",
        "source": "门店运营SOP v3.2 (2026-03)",
        "text": (
            "VIP 客户接待流程：进店问候后10分钟内提供饮品；"
            "试衣间一次最多携带6件商品；离店时由接待顾问送至门口，"
            "并将客户偏好记录至 CRM。"
        ),
    },
    {
        "id": "store-sop-closing",
        "tenant": "store-ops",
        "source": "门店运营SOP v3.2 (2026-03)",
        "text": (
            "闭店检查清单：核对当日营业款并双人签字确认；"
            "检查橱窗灯光与防盗门；贵重商品归入保险柜并登记交接记录。"
        ),
    },
    {
        "id": "brand-care-leather",
        "tenant": "brand-knowledge",
        "source": "产品护理手册 2026版",
        "text": (
            "皮革制品护理：避免长时间日晒与潮湿环境；"
            "清洁时使用干燥软布轻拭，禁止使用酒精或溶剂；"
            "长期存放时使用原装防尘袋并填充软纸保持形状。"
        ),
    },
    {
        "id": "brand-care-jewelry",
        "tenant": "brand-knowledge",
        "source": "产品护理手册 2026版",
        "text": (
            "珠宝佩戴与保养：避免接触香水、化妆品与泳池氯水；"
            "每半年到店进行免费专业清洗与镶嵌检查；"
            "单独存放在软布袋中避免刮花。"
        ),
    },
    {
        "id": "campaign-spring-2026",
        "tenant": "marketing",
        "source": "2026春季活动执行手册",
        "text": (
            "春季活动执行要求：门店需在活动开始前2周完成橱窗更换；"
            "活动礼品按日盘点并在闭店后登记损耗；"
            "活动结束后3天内提交复盘报告至区域经理。"
        ),
    },
]


def _tokenize(text: str) -> list[str]:
    """英文按词、中文按字符 bigram 的轻量分词。"""
    tokens: list[str] = [m.group(0).lower() for m in re.finditer(r"[A-Za-z0-9]+", text)]
    for run in re.findall(r"[\u4e00-\u9fff]+", text):
        if len(run) == 1:
            tokens.append(run)
        else:
            tokens.extend(run[i : i + 2] for i in range(len(run) - 1))
    return tokens


def _vectorize(text: str) -> dict[str, int]:
    return dict(Counter(_tokenize(text)))


def _cosine(a: dict[str, int], b: dict[str, int]) -> float:
    common = set(a) & set(b)
    if not common:
        return 0.0
    dot = sum(a[t] * b[t] for t in common)
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (na * nb)


class InMemoryRetriever:
    def __init__(self, docs: list[dict[str, Any]]):
        self._docs = docs
        self._vectors = {doc["id"]: _vectorize(doc["text"]) for doc in docs}

    def search(
        self,
        query: str,
        tenant_id: str | None = None,
        top_k: int = 5,
    ) -> list[dict[str, Any]]:
        """检索入口。

        关键设计：租户过滤发生在打分之前（先 filter 再 score），
        不允许先全量召回再由前端隐藏 —— 与 aidemo 的多租户边界一致。
        """
        query_vec = _vectorize(query)
        if not query_vec:
            return []

        candidates = [doc for doc in self._docs if tenant_id is None or doc["tenant"] == tenant_id]

        scored: list[tuple[float, dict[str, Any]]] = []
        for doc in candidates:
            score = _cosine(query_vec, self._vectors[doc["id"]])
            if score > 0.0:
                scored.append((score, doc))

        scored.sort(key=lambda pair: pair[0], reverse=True)
        return [
            {
                "id": doc["id"],
                "excerpt": doc["text"],
                "score": round(score, 4),
                "source": doc["source"],
                "tenant": doc["tenant"],
            }
            for score, doc in scored[:top_k]
        ]
