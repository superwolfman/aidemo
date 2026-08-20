#!/usr/bin/env bash
# mini-rag-py 面试演示脚本：一条命令重放完整链路
# 用法：cd mini-rag-py && bash demo.sh
set -euo pipefail

cd "$(dirname "$0")"

PORT=8100
BASE="http://localhost:${PORT}"

# 加载 LLM 配置（可选：没有 .env 时知识缺口/租户过滤仍可演示）
if [ -f .env ]; then
    set -a; source .env; set +a
fi

echo "=================================================="
echo " [0/7] 自动化测试（Stub Provider，不访问真实 LLM）"
echo "=================================================="
.venv/bin/python -m pytest tests -q

echo ""
echo "=================================================="
echo " 启动服务 :${PORT}"
echo "=================================================="
# 面试默认使用确定性 Stub；显式设置 RAG_LLM_MODE=openai 可切真实兼容端点。
export RAG_LLM_MODE="${RAG_LLM_MODE:-stub}"
PYTHONUNBUFFERED=1 .venv/bin/uvicorn app.main:app --port "${PORT}" > /tmp/minirag-demo.log 2>&1 &
SERVER_PID=$!
trap 'kill ${SERVER_PID} 2>/dev/null || true' EXIT

# 等待服务就绪（冷导入约 4~5 秒，最多等 20 秒）
READY=0
for i in $(seq 1 40); do
    if curl -s -o /dev/null "${BASE}/healthz" 2>/dev/null; then
        READY=1
        break
    fi
    sleep 0.5
done
if [ "${READY}" != "1" ]; then
    echo "服务启动失败，日志："
    cat /tmp/minirag-demo.log
    exit 1
fi
echo "服务就绪"

echo ""
echo "=================================================="
echo " [1/7] 存活与就绪检查"
echo "=================================================="
curl -s "${BASE}/healthz"; echo ""
curl -s "${BASE}/readyz"; echo ""

echo ""
echo "=================================================="
echo " [2/7] 正常命中：认证租户 + Stub Provider + citation"
echo "=================================================="
curl -s -X POST "${BASE}/query" \
    -H 'Authorization: Bearer demo-store-token' -H 'Content-Type: application/json' \
    -d '{"question": "门店退换货政策是什么？多久能退款？"}' \
    | .venv/bin/python -m json.tool

echo ""
echo "=================================================="
echo " [3/7] 知识缺口：answer=null，不调用 Provider"
echo "=================================================="
curl -s -X POST "${BASE}/query" \
    -H 'Authorization: Bearer demo-store-token' -H 'Content-Type: application/json' \
    -d '{"question": "薛定谔方程怎么求解"}' \
    | .venv/bin/python -m json.tool

echo ""
echo "=================================================="
echo " [4/7] 跨租户不可见：brand principal 查不到 store-ops"
echo "=================================================="
curl -s -X POST "${BASE}/query" \
    -H 'Authorization: Bearer demo-brand-token' -H 'Content-Type: application/json' \
    -d '{"question": "门店退换货政策是什么"}' \
    | .venv/bin/python -m json.tool

echo ""
echo "=================================================="
echo " [5/7] brand principal 正常命中（皮革护理）"
echo "=================================================="
curl -s -X POST "${BASE}/query" \
    -H 'Authorization: Bearer demo-brand-token' -H 'Content-Type: application/json' \
    -d '{"question": "皮革制品怎么保养"}' \
    | .venv/bin/python -m json.tool

echo ""
echo "=================================================="
echo " [6/7] 伪造 tenant_id：请求体额外字段 -> 422"
echo "=================================================="
curl -s -w "\nHTTP %{http_code}\n" -X POST "${BASE}/query" \
    -H 'Authorization: Bearer demo-brand-token' -H 'Content-Type: application/json' \
    -d '{"question": "退货", "tenant_id": "store-ops"}'

echo ""
echo "=================================================="
echo " [7/7] 非成员切租户：X-Tenant-ID -> 403"
echo "=================================================="
curl -s -w "\nHTTP %{http_code}\n" -X POST "${BASE}/query" \
    -H 'Authorization: Bearer demo-brand-token' -H 'X-Tenant-ID: store-ops' \
    -H 'Content-Type: application/json' -d '{"question": "退货"}'

echo ""
echo "=================================================="
echo " 演示完成，服务已停止"
echo "=================================================="
