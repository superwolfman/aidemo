#!/usr/bin/env bash
# ============================================================
# aidemo 一键部署/更新脚本（阿里云 ECS + Docker）
# 用法：
#   1. 首次：cp deploy/.env.production.example deploy/.env.production 并填写
#   2. 在 Cloudflare 将 app.agentdelivery.com 的 A 记录设为已代理（橙色云）。
#   3. 生产模板默认使用：
#        VITE_API_BASE=https://app.agentdelivery.com
#        PUBLIC_HOST=app.agentdelivery.com
#        EDGE_PROXY_MODE=cloudflare
#        ORIGIN_PUBLIC_IP=<ECS 公网 IP>
#   4. bash deploy/deploy.sh                       # 首次部署 / 代码更新后构建
#      bash deploy/deploy.sh --update              # 先拉新代码再构建
#      bash deploy/deploy.sh --clean               # 强制无缓存重建（首次或换 registry 时用）
# ============================================================
set -euo pipefail

# 定位项目根（deploy/ 的上一级）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

ENV_FILE="deploy/.env.production"
COMPOSE="docker compose -f deploy/docker-compose.prod.yml"

read_env_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1 | tr -d '\r'
}

echo "==== aidemo 部署脚本 ===="
echo "项目根: $PROJECT_ROOT"

# 1. 校验 .env.production
if [ ! -f "$ENV_FILE" ]; then
  echo "✗ 未找到 $ENV_FILE"
  echo "  请先执行: cp deploy/.env.production.example $ENV_FILE"
  echo "  然后填写 JWT_SECRET / MONGODB_ATLAS_URI / DASHSCOPE_API_KEY / CLIENT_ORIGIN 等"
  exit 1
fi

# 2. 校验自有域名与 Cloudflare 代理（前端 API 地址在 build 时注入）
if [ -z "${VITE_API_BASE:-}" ]; then
  VITE_API_BASE="$(read_env_value CLIENT_ORIGIN)"
fi
if [[ "$VITE_API_BASE" != https://* ]]; then
  echo "✗ 生产 VITE_API_BASE 必须使用 https://"
  exit 1
fi
PUBLIC_HOST="${PUBLIC_HOST:-$(read_env_value PUBLIC_HOST)}"
PUBLIC_HOST="${PUBLIC_HOST:-${VITE_API_BASE#https://}}"
PUBLIC_HOST="${PUBLIC_HOST%%/*}"
ORIGIN_PUBLIC_IP="${ORIGIN_PUBLIC_IP:-$(read_env_value ORIGIN_PUBLIC_IP)}"
EDGE_PROXY_MODE="${EDGE_PROXY_MODE:-$(read_env_value EDGE_PROXY_MODE)}"
export VITE_API_BASE
export PUBLIC_HOST
export ORIGIN_PUBLIC_IP
export EDGE_PROXY_MODE
echo "✓ VITE_API_BASE=$VITE_API_BASE"
echo "✓ PUBLIC_HOST=$PUBLIC_HOST"
echo "✓ EDGE_PROXY_MODE=$EDGE_PROXY_MODE"

node scripts/production-domain.mjs

# 3. 安全检查：JWT_SECRET 不得用 demo 默认值
if grep -qE "^JWT_SECRET=(replace-with-32-bytes-random|local-demo-secret)" "$ENV_FILE"; then
  echo "✗ JWT_SECRET 仍是占位符/默认值，生产不可用"
  echo "  生成强随机: openssl rand -hex 32，填入 $ENV_FILE 的 JWT_SECRET"
  exit 1
fi

if ! grep -qE '^MONGODB_DB_NAME=[A-Za-z0-9_-]+_prod$' "$ENV_FILE"; then
  echo "✗ 生产必须显式设置 MONGODB_DB_NAME，且数据库名以 _prod 结尾"
  echo "  推荐: MONGODB_DB_NAME=aidemo_prod"
  exit 1
fi

if ! grep -qE '^MONGODB_EXPECTED_USERNAME=[A-Za-z0-9_-]+_prod_app$' "$ENV_FILE"; then
  echo "✗ 生产必须使用独立 Atlas 应用用户，且 MONGODB_EXPECTED_USERNAME 以 _prod_app 结尾"
  exit 1
fi

if ! grep -q '^SESSION_COOKIE_SECURE=true$' "$ENV_FILE"; then
  echo "✗ 生产必须设置 SESSION_COOKIE_SECURE=true"
  exit 1
fi

if ! grep -q '^SESSION_COOKIE_NAME=__Host-aidemo_session$' "$ENV_FILE"; then
  echo "✗ 生产必须设置 SESSION_COOKIE_NAME=__Host-aidemo_session"
  exit 1
fi

if ! grep -q "^CLIENT_ORIGIN=$VITE_API_BASE$" "$ENV_FILE"; then
  echo "✗ CLIENT_ORIGIN 必须与 VITE_API_BASE 完全一致: $VITE_API_BASE"
  exit 1
fi

if ! grep -q "^PUBLIC_HOST=$PUBLIC_HOST$" "$ENV_FILE"; then
  echo "✗ .env.production 中 PUBLIC_HOST 必须与部署域名完全一致: $PUBLIC_HOST"
  exit 1
fi

if ! grep -q '^EDGE_PROXY_MODE=cloudflare$' "$ENV_FILE"; then
  echo "✗ 生产必须设置 EDGE_PROXY_MODE=cloudflare"
  exit 1
fi

# 4. 处理参数
CLEAN_BUILD=""
if [ "${1:-}" = "--update" ]; then
  echo "==== 拉取最新代码 ===="
  git pull --ff-only
elif [ "${1:-}" = "--clean" ]; then
  CLEAN_BUILD="--no-cache"
  echo "==== 强制无缓存重建 ===="
fi

# 5. 构建镜像
# 默认使用 Docker 层缓存：package.json 未变时 npm ci 不会重跑，可大幅加速部署。
# VITE_API_BASE 作为 build arg 会自动使下游 client build 层失效，无需 --no-cache。
# 只有依赖/registry 出问题或想彻底重建时，才用 bash deploy/deploy.sh --clean
echo "==== 构建镜像 ===="
$COMPOSE build $CLEAN_BUILD

# 6. 启动服务
echo "==== 启动服务 ===="
$COMPOSE up -d

# 7. 等待完整入口健康：API、TLS 前端、TLS API 以及 HTTP 301。
echo "==== 等待完整服务健康检查 ===="
READY=false
for attempt in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:4000/health >/dev/null \
    && curl -fsS --resolve "$PUBLIC_HOST:443:127.0.0.1" "https://$PUBLIC_HOST/healthz" >/dev/null \
    && curl -fsS --resolve "$PUBLIC_HOST:443:127.0.0.1" "https://$PUBLIC_HOST/api/auth/bootstrap" >/dev/null \
    && [ "$(curl -sS -o /dev/null -w '%{http_code}' --resolve "$PUBLIC_HOST:80:127.0.0.1" "http://$PUBLIC_HOST/")" = "301" ]; then
    READY=true
    break
  fi
  sleep 3
done

if [ "$READY" != "true" ]; then
  echo "✗ 部署后健康检查失败"
  $COMPOSE ps
  $COMPOSE logs --tail=150 api web edge
  exit 1
fi

$COMPOSE ps

# 8. 公网入口必须经过 Cloudflare；即使 Access 返回登录跳转，也应携带 cf-ray。
if ! curl -fsSI --max-time 15 "https://$PUBLIC_HOST/" | grep -qi '^cf-ray:'; then
  echo "✗ 公网响应未经过 Cloudflare（缺少 cf-ray）"
  echo "  请确认 DNS 记录为 Proxied（橙色云），SSL/TLS 模式为 Full (strict)"
  exit 1
fi
echo "✓ Cloudflare 公网入口验证通过"

# 9. 自检
echo ""
echo "==== 部署完成 ===="
echo "前端: $VITE_API_BASE"
echo "API 健康: curl http://127.0.0.1:4000/health   (本机)"
echo "HTTPS 验证: curl $VITE_API_BASE/healthz        (应返回 ok)"
echo "重定向验证: curl -I http://$PUBLIC_HOST         (应返回 301)"
echo "DNS 验证: dig +short $PUBLIC_HOST                 (应只返回 Cloudflare IP)"
echo "查看日志: $COMPOSE logs -f"
echo "停止: $COMPOSE down"
