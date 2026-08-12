# aidemo 阿里云生产部署方案

> 适用：单台阿里云 ECS，Docker 全栈部署，手机/电脑外网访问
> 数据库/LLM 走云（MongoDB Atlas + DashScope），服务器运行 Express + 内部 Nginx + Caddy TLS 边缘
> 基线 commit：`33561bb`

---

## 0. 部署架构

```
                        手机 / 电脑（公网）
                              │
                   https://app.agentdelivery.asia
                  ┌───────────▼───────────┐
                  │   阿里云 ECS（轻量/ECS）│
                  │   ┌─────────────────┐ │
                  │   │ Caddy TLS edge  │ │  ← 80/443，自动证书、301、HSTS
                  │   └──────┬──────┬───┘ │
                  │     ┌────▼───┐  │     │
                  │     │ Nginx  │  │     │  ← 仅 Docker 内部静态站点
                  │     └────────┘  │     │
                  │            ┌────▼────┐│
                  │            │ Express │ │  ← 4000 仅本机，不对外
                  │            │ (api)   │ │
                  │            └────┬────┘ │
                  └─────────────────┼─────┘
                                    │
              ┌─────────────────────┼──────────────────────┐
              ▼                     ▼                      ▼
      MongoDB Atlas          DashScope LLM           DashScope Embedding
      (业务数据+向量)         (qwen-flash)            (text-embedding-v3)
      已在云上，免运维         国内阿里云，速度快        同 provider
```

**为什么这样部署**：aidemo 后端用 SSE 长连接（一次 Run 几十秒），**不能用 serverless/函数计算**（会 30~60s 超时掐断流）。ECS 是常驻进程，最稳。数据库/向量库用 Atlas 云、LLM 用 DashScope 云，服务器不跑 mongo/模型，部署很轻。

---

## 1. 阿里云服务器开通

### 1.1 选型建议

| 套餐 | 规格 | 适用 | 月费 |
|---|---|---|---|
| 轻量 2核2G3M | 2C2G 3M带宽 60GB | Demo/面试展示（2~3 并发） | ~24 元 |
| 轻量 2核4G4M | 2C4G 4M带宽 80GB | 小团队/稳定访问 | ~50 元 |
| ECS 计算型 c6 | 2C4G 按量 | 临时活动/可释放 | 按小时 |

**推荐**：轻量应用服务器 2核2G3M 起步，够跑 Express + Nginx + 少量并发。带宽 3M 对 SSE 流式偏紧，介意可升 4M+。

### 1.2 开通步骤

1. 登录 [阿里云控制台](https://ecs.console.aliyun.com) → 轻量应用服务器 / 云服务器 ECS
2. 创建实例：
   - 地域：选离你近的（华东1 杭州 / 华北2 北京 / 华南1 深圳）
   - 镜像：**Ubuntu 22.04 LTS**（本文基于此）
   - 计费：包年包月（更便宜）或按量
   - 存储：60GB SSD 足够
3. 网络：分配公网 IP（必须，否则外网访问不了）
4. 安全组 / 防火墙：放行端口
   - **80/443 TCP**：允许公网访问，供 Caddy 完成 HTTPS 和跳转
   - **443 UDP**：可选 HTTP/3
   - **22**：只允许运维者固定 IP
5. 设置登录密码 / 密钥对，记录公网 IP

### 1.3 域名和备案说明

- 对外只使用 `https://app.agentdelivery.asia`，不使用 IP 或 IP 编码域名。
- `https://agentdelivery.asia` 自动 301 跳转到应用域名。
- `app` 表示用户可访问的正式产品；`prd` / `prod` 是内部环境术语，不出现在公开 URL。
- 如果以后需要非生产环境，使用 `staging.agentdelivery.asia` 并限制访问来源。
- 当前 ECS 在中国香港，不要求中国内地 ICP 备案；迁移至内地前必须先备案。

---

## 2. 服务器初始化

SSH 登录后执行（Ubuntu 22.04）：

```bash
# 1. 系统更新
sudo apt update && sudo apt upgrade -y

# 2. 装 Docker + Compose（官方脚本，阿里云镜像加速）
curl -fsSL https://get.docker.com | sudo sh
# 配阿里云镜像加速（国内拉镜像快）
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json <<'EOF'
{
  "registry-mirrors": ["https://registry.cn-hangzhou.aliyuncs.com"]
}
EOF
sudo systemctl restart docker
sudo systemctl enable docker

# 3. 装 git
sudo apt install -y git

# 4. 把当前用户加入 docker 组（免 sudo）
sudo usermod -aG docker $USER
newgrp docker

# 验证
docker --version && docker compose version
```

---

## 3. 代码部署

```bash
# 1. 克隆项目
cd /opt
sudo git clone <你的仓库地址> aidemo   # 私有库需配 deploy key 或 token
cd aidemo

# 2. 配置生产环境变量
cp deploy/.env.production.example deploy/.env.production
nano deploy/.env.production   # 填写下面"必填项"
```

### 3.1 `.env.production` 必填项（缺一不可）

| 变量 | 值 | 说明 |
|---|---|---|
| `JWT_SECRET` | `openssl rand -hex 32` 生成 | 强随机，不可用默认 |
| `PUBLIC_HOST` | `app.agentdelivery.asia` | 自有公网域名，不含协议 |
| `ORIGIN_PUBLIC_IP` | `8.217.153.138` | 部署时验证 DNS 指向正确 ECS |
| `CLIENT_ORIGIN` | `https://app.agentdelivery.asia` | 与访问地址同源，CORS |
| `CLIENT_ORIGINS` | `https://app.agentdelivery.asia` | 同上 |
| `MONGODB_ATLAS_URI` | Atlas 控制台复制 | 业务数据+向量 |
| `MONGODB_DB_NAME` | `aidemo_prod` | 生产独立数据库，必须以 `_prod` 结尾 |
| `MONGODB_EXPECTED_USERNAME` | `aidemo_prod_app` | 与连接串用户名一致，必须为生产独立用户 |
| `DASHSCOPE_API_KEY` | DashScope 控制台 | LLM + Embedding |

其余 `RAG_*` / `LLM_MODEL` 等保持模板默认即可。

### 运行时模型设置

`LLM_PROVIDER`、`LLM_MODEL` 和可选的 `LLM_FALLBACK_MODELS` 只用于首次初始化。服务启动后，平台管理员可在 **AgentOps 控制台 → 模型设置** 中测试、发布或回滚模型路由，配置写入 `runtime_settings` 并即时生效，无需重启。每次发布会在 `runtime_setting_versions` 生成不可变审计版本。

模型 API Key 始终由 ECS 环境变量或密钥管理服务提供，模型设置 API 和浏览器不会返回或保存密钥。备用链只对服务端确认的额度耗尽错误生效；鉴权失败、内容安全拒绝和普通服务异常不会触发自动切换。

首次从历史共享库升级时，先预览并迁移数据，再启动新版本：

```bash
docker compose -f deploy/docker-compose.prod.yml run --rm api \
  node server/scripts/migrate-database-environment.mjs --source growth_ai_assistant

docker compose -f deploy/docker-compose.prod.yml run --rm api \
  node server/scripts/migrate-database-environment.mjs --source growth_ai_assistant --apply
```

### 3.2 创建开发/生产独立 Atlas 应用用户

应用运行时禁止使用 `atlasAdmin`。安装并登录 Atlas CLI 后执行：

```bash
export ATLAS_PROJECT_ID=<Atlas Project ID>
bash scripts/provision-atlas-environment-users.sh
```

脚本创建 `aidemo_dev_app`（仅 `readWrite@aidemo_dev`）和
`aidemo_prod_app`（仅 `readWrite@aidemo_prod`）。密码只写入被 Git 忽略且权限为
`0600` 的 `deploy/.atlas-users.env`。将账号分别写入本地和线上密钥配置后删除该文件。

### 3.3 阿里云 DNS 与 HTTPS

1. 在阿里云云解析添加 `A` 记录：主机记录 `app`，记录值 `8.217.153.138`。
2. 安全组开放 TCP 80/443；Caddy 自动申请并续期公开可信证书。
3. 生产登录使用应用内受限 Demo 账号，不开放管理员账号。

### 3.4 MongoDB Atlas：加 IP 白名单

Atlas 控制台 → Network Access → Add IP Address → 填 ECS 公网 IP（或临时 `0.0.0.0/0`，不安全但能跑通）。

### 3.5 启动

```bash
# 设置前端 API 地址（与 CLIENT_ORIGIN 同源）
export VITE_API_BASE=https://app.agentdelivery.asia
export PUBLIC_HOST=app.agentdelivery.asia
export ORIGIN_PUBLIC_IP=<ECS 公网 IP>

# 一键部署
bash deploy/deploy.sh
```

脚本会：校验域名和安全配置 → 构建镜像 → 启动 API/Web/Caddy → 自动申请证书 → 验证 HTTPS、API 和 HTTP 301。

---

## 4. 验证

```bash
# 本机：后端健康
curl http://127.0.0.1:4000/health
# 预期: {"ok":true,"store":"mongo"}

# HTTPS 健康
curl https://app.agentdelivery.asia/healthz
# 预期: ok

# 外网：手机/电脑浏览器访问
https://app.agentdelivery.asia
# 应见 aidemo 工作台首页；登录后能跑通"需求→RAG→Artifact→LLM 流式"
```

若 SSE 不流式（卡住不出字）：检查 nginx `proxy_buffering off` 是否生效（`deploy/nginx.conf` 已配）。

---

## 5. 自有域名 + HTTPS

Caddy 根据 `PUBLIC_HOST` 自动申请和续期公开可信证书。HTTP 固定返回 301，
HTTPS 响应包含一年期 HSTS，API 与前端保持同源并支持 SSE。

---

## 6. 日常运维

```bash
cd /opt/aidemo

# 更新代码后重新部署
bash deploy/deploy.sh --update

# 看实时日志（含 SSE 流）
docker compose -f deploy/docker-compose.prod.yml logs -f

# 只看后端
docker compose -f deploy/docker-compose.prod.yml logs -f api

# 重启
docker compose -f deploy/docker-compose.prod.yml restart

# 停止
docker compose -f deploy/docker-compose.prod.yml down

# 查看容器状态
docker compose -f deploy/docker-compose.prod.yml ps
```

### 6.1 换 IP/域名后

前端镜像 build 时注入了 `VITE_API_BASE`，换 IP/域名需重新构建：

```bash
export VITE_API_BASE=https://<新域名>
export PUBLIC_HOST=<新域名>
docker compose -f deploy/docker-compose.prod.yml build web
docker compose -f deploy/docker-compose.prod.yml up -d
```

---

## 7. 成本与免费期

| 项 | 费用 |
|---|---|
| 阿里云轻量 2C2G3M | ~24 元/月（新用户首单常有优惠 ~9.9 元/月） |
| MongoDB Atlas 免费 tier | 0（512MB，够 demo） |
| DashScope LLM | 按量，qwen-flash 极便宜（几元/百万 token） |
| `agentdelivery.asia` 域名 | 以注册商实时价格为准 |
| 备案 | 0 |

**最低落地成本**：ECS 成本 + `agentdelivery.asia` 年费。

---

## 8. 安全检查清单

- [x] `JWT_SECRET` 已用强随机替换（非 `local-demo-secret`）
- [x] `ALLOW_FILE_STORE_FALLBACK=false`
- [x] 安全组只开 80/443/22，22 限定来源 IP
- [x] HTTP 301 到 HTTPS，启用 HSTS 和 Secure Cookie
- [x] 开发/生产 Atlas 应用用户分离且只拥有各自数据库 `readWrite`
- [x] 权限拒绝写入 `security.authorization.denied` 审计事件
- [x] Atlas Network Access 已加 ECS IP（非 0.0.0.0/0）
- [x] `.env.production` 不入 git（`.gitignore` 已排除 `.env`）
- [x] DashScope Key 未泄露到日志/截图
- [ ] **已知**：多租户写路径越权、状态机非原子（见 `aidemo_final_solution_33561bb.md` P0 清单），上线前应先补

> ⚠️ 安全提醒：aidemo 当前为**工程原型**，多租户写路径越权、状态机并发覆盖等 P0 问题尚未修复（详见《aidemo 产品化最终方案》）。本部署方案能让你**外网访问演示**，但**不建议放真实多租户数据**。面试/演示场景单人单租户可用。

---

## 附录：产物清单

```
deploy/
├── Dockerfile.server          # 后端 Express 镜像
├── Dockerfile.web             # 前端 Vite build + nginx 镜像
├── nginx.conf                 # 反代 + SSE 透传配置
├── docker-compose.prod.yml    # 编排 api + web
├── .env.production.example    # 环境变量模板
├── deploy.sh                  # 一键部署/更新脚本
└── README.md                  # 本文档
```
