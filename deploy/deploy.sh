#!/usr/bin/env bash
# ============================================================
# aidemo 一键部署/更新脚本（阿里云 ECS + Docker）
# 用法：
#   1. 首次：cp deploy/.env.production.example deploy/.env.production 并填写
#   2. 设置公网访问地址：
#        export VITE_API_BASE=http://<ECS公网IP>   # 或 https://aidemo.xxx.com
#   3. bash deploy/deploy.sh                       # 首次部署
#      bash deploy/deploy.sh --update              # 拉新代码后更新
# ============================================================
set -euo pipefail

# 定位项目根（deploy/ 的上一级）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

ENV_FILE="deploy/.env.production"
COMPOSE="docker compose -f deploy/docker-compose.prod.yml"

echo "==== aidemo 部署脚本 ===="
echo "项目根: $PROJECT_ROOT"

# 1. 校验 .env.production
if [ ! -f "$ENV_FILE" ]; then
  echo "✗ 未找到 $ENV_FILE"
  echo "  请先执行: cp deploy/.env.production.example $ENV_FILE"
  echo "  然后填写 JWT_SECRET / MONGODB_ATLAS_URI / DASHSCOPE_API_KEY / CLIENT_ORIGIN 等"
  exit 1
fi

# 2. 校验 VITE_API_BASE（前端 API 地址，build 时注入）
if [ -z "${VITE_API_BASE:-}" ]; then
  read -rp "请输入前端访问地址 VITE_API_BASE（如 http://47.116.x.x 或 https://aidemo.xxx.com）: " VITE_API_BASE
fi
export VITE_API_BASE
echo "✓ VITE_API_BASE=$VITE_API_BASE"

# 3. 安全检查：JWT_SECRET 不得用 demo 默认值
if grep -qE "^JWT_SECRET=(replace-with-32-bytes-random|local-demo-secret)" "$ENV_FILE"; then
  echo "✗ JWT_SECRET 仍是占位符/默认值，生产不可用"
  echo "  生成强随机: openssl rand -hex 32，填入 $ENV_FILE 的 JWT_SECRET"
  exit 1
fi

# 4. 更新分支（--update 时拉最新代码）
if [ "${1:-}" = "--update" ]; then
  echo "==== 拉取最新代码 ===="
  git pull --ff-only
fi

# 5. 构建镜像
# 加 --no-cache 防止 Docker 复用旧层：VITE_API_BASE 变化必须重新执行 client build
echo "==== 构建镜像 ===="
$COMPOSE build --no-cache

# 6. 启动服务
echo "==== 启动服务 ===="
$COMPOSE up -d

# 7. 等待健康检查
echo "==== 等待 api 健康检查 ===="
sleep 6
$COMPOSE ps

# 8. 自检
PUBLIC_IP="${VITE_API_BASE#http://}"
PUBLIC_IP="${PUBLIC_IP#https://}"
echo ""
echo "==== 部署完成 ===="
echo "前端: $VITE_API_BASE"
echo "API 健康: curl http://127.0.0.1:4000/health   (本机)"
echo "外网验证: curl $VITE_API_BASE/healthz          (应返回 ok)"
echo "查看日志: $COMPOSE logs -f"
echo "停止: $COMPOSE down"
