#!/usr/bin/env bash
# ============================================================
# aidemo 一键部署/更新脚本（阿里云 ECS + Docker）
# 用法：
#   1. 首次：cp deploy/.env.production.example deploy/.env.production 并填写
#   2. 设置公网访问地址：
#        export VITE_API_BASE=http://<ECS公网IP>   # 或 https://aidemo.xxx.com
#   3. bash deploy/deploy.sh                       # 首次部署 / 代码更新后构建
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

if ! grep -qE '^MONGODB_DB_NAME=[A-Za-z0-9_-]+_prod$' "$ENV_FILE"; then
  echo "✗ 生产必须显式设置 MONGODB_DB_NAME，且数据库名以 _prod 结尾"
  echo "  推荐: MONGODB_DB_NAME=aidemo_prod"
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

# 7. 等待完整入口健康：不仅检查容器，还验证 nginx -> api 真实反代。
echo "==== 等待完整服务健康检查 ===="
READY=false
for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:4000/health >/dev/null \
    && curl -fsS http://127.0.0.1/healthz >/dev/null \
    && curl -fsS http://127.0.0.1/api/auth/bootstrap >/dev/null; then
    READY=true
    break
  fi
  sleep 2
done

if [ "$READY" != "true" ]; then
  echo "✗ 部署后健康检查失败"
  $COMPOSE ps
  $COMPOSE logs --tail=100 api web
  exit 1
fi

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
