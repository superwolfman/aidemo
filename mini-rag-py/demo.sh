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
echo " [0/6] 单元测试（7 个用例）"
echo "=================================================="
.venv/bin/python -m pytest tests -q 2>&1 | tail -2

echo ""
echo "=================================================="
echo " 启动服务 :${PORT}"
echo "=================================================="
PYTHONUNBUFFERED=1 .venv/bin/uvicorn app.main:app --port "${PORT}" > /tmp/minirag-demo.log 2>&1 &
SERVER_PID=$!
trap 'kill ${SERVER_PID} 2>/dev/null || true' EXIT

# 等待服务就绪（冷导入约 4~5 秒，最多等 20 秒）
READY=0
for i in $(seq 1 40); do
    if curl -s -o /dev/null "${BASE}/health" 2>/dev/null; then
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
echo " [1/6] 健康检查"
echo "=================================================="
curl -s "${BASE}/health"; echo ""

echo ""
echo "=================================================="
echo " [2/6] 正常命中：真实 LLM + 引用 [1]"
echo "=================================================="
curl -s -X POST "${BASE}/query" -H 'Content-Type: application/json' \
    -d '{"question": "门店退换货政策是什么？多久能退款？"}' \
    | .venv/bin/python -m json.tool

echo ""
echo "=================================================="
echo " [3/6] 知识缺口：零命中显式返回，不调用 LLM"
echo "=================================================="
curl -s -X POST "${BASE}/query" -H 'Content-Type: application/json' \
    -d '{"question": "薛定谔方程怎么求解"}' \
    | .venv/bin/python -m json.tool

echo ""
echo "=================================================="
echo " [4/6] 租户过滤：brand-knowledge 查不到 store-ops"
echo "=================================================="
curl -s -X POST "${BASE}/query" -H 'Content-Type: application/json' \
    -d '{"question": "门店退换货政策是什么", "tenant_id": "brand-knowledge"}' \
    | .venv/bin/python -m json.tool

echo ""
echo "=================================================="
echo " [5/6] brand 租户正常命中（皮革护理）"
echo "=================================================="
curl -s -X POST "${BASE}/query" -H 'Content-Type: application/json' \
    -d '{"question": "皮革制品怎么保养", "tenant_id": "brand-knowledge"}' \
    | .venv/bin/python -m json.tool

echo ""
echo "=================================================="
echo " [6/6] 请求校验：top_k 越界 -> Pydantic 422"
echo "=================================================="
curl -s -w "\nHTTP %{http_code}\n" -X POST "${BASE}/query" -H 'Content-Type: application/json' \
    -d '{"question": "退货", "top_k": 99}'

echo ""
echo "=================================================="
echo " 演示完成，服务已停止"
echo "=================================================="
