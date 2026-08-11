# aidemo 阿里云生产部署方案

> 适用：单台阿里云 ECS，Docker 全栈部署，手机/电脑外网访问
> 数据库/LLM 走云（MongoDB Atlas + DashScope），服务器只跑 Express + Nginx
> 基线 commit：`33561bb`

---

## 0. 部署架构

```
                        手机 / 电脑（公网）
                              │
                     http://<ECS公网IP>  或  https://aidemo.xxx.com
                              │
                  ┌───────────▼───────────┐
                  │   阿里云 ECS（轻量/ECS）│
                  │   ┌─────────────────┐ │
                  │   │  nginx (web)    │ │  ← 80 端口，serve 前端静态 + /api 反代
                  │   │  /api/ ──────┐   │ │     (SSE buffering off)
                  │   └──────────────┼───┘ │
                  │            ┌─────▼───┐ │
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
   - **80**（HTTP，nginx 对外）
   - **443**（HTTPS，可选，配 SSL 后用）
   - **22**（SSH，建议限定来源 IP）
5. 设置登录密码 / 密钥对，记录公网 IP

### 1.3 用 IP 访问免备案说明

- **用公网 IP 直接访问**：**无需备案**，立即可用（如 `http://47.116.x.x`）
- **要用域名**（如 `aidemo.xxx.com`）：域名指向中国大陆 ECS 必须**ICP 备案**（阿里云备案，约 7~20 工作日）
- 想免备案又用域名：买**中国香港/海外**轻量服务器（贵些），或用 IP 访问

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
| `CLIENT_ORIGIN` | `http://<ECS公网IP>` | 与访问地址同源，CORS |
| `CLIENT_ORIGINS` | `http://<ECS公网IP>` | 同上 |
| `MONGODB_ATLAS_URI` | Atlas 控制台复制 | 业务数据+向量 |
| `MONGODB_DB_NAME` | `aidemo_prod` | 生产独立数据库，必须以 `_prod` 结尾 |
| `DASHSCOPE_API_KEY` | DashScope 控制台 | LLM + Embedding |

其余 `RAG_*` / `LLM_MODEL` 等保持模板默认即可。

首次从历史共享库升级时，先预览并迁移数据，再启动新版本：

```bash
docker compose -f deploy/docker-compose.prod.yml run --rm api \
  node server/scripts/migrate-database-environment.mjs --source growth_ai_assistant

docker compose -f deploy/docker-compose.prod.yml run --rm api \
  node server/scripts/migrate-database-environment.mjs --source growth_ai_assistant --apply
```

### 3.2 MongoDB Atlas：加 IP 白名单

Atlas 控制台 → Network Access → Add IP Address → 填 ECS 公网 IP（或临时 `0.0.0.0/0`，不安全但能跑通）。

### 3.3 启动

```bash
# 设置前端 API 地址（与 CLIENT_ORIGIN 同源）
export VITE_API_BASE=http://<ECS公网IP>

# 一键部署
bash deploy/deploy.sh
```

脚本会：构建后端镜像 → 构建前端镜像（注入 VITE_API_BASE）→ 启动 api + web 容器 → 自检。

---

## 4. 验证

```bash
# 本机：后端健康
curl http://127.0.0.1:4000/health
# 预期: {"ok":true,"store":"mongo"}

# 本机：nginx 健康
curl http://127.0.0.1/healthz
# 预期: ok

# 外网：手机/电脑浏览器访问
http://<ECS公网IP>
# 应见 aidemo 工作台首页；登录后能跑通"需求→RAG→Artifact→LLM 流式"
```

若 SSE 不流式（卡住不出字）：检查 nginx `proxy_buffering off` 是否生效（`deploy/nginx.conf` 已配）。

---

## 5. 域名 + HTTPS（可选，需备案）

备案通过后配 SSL，让 `https://aidemo.xxx.com` 可用：

```bash
# 1. 域名 DNS A 记录指向 ECS 公网 IP
# 2. 用 certbot 申请免费 Let's Encrypt 证书
sudo apt install -y certbot
sudo certbot certonly --standalone -d aidemo.xxx.com
# 3. 在 deploy/nginx.conf 改 listen 443 ssl + ssl_certificate 路径
#    并加 80 → 443 跳转
# 4. .env.production 的 CLIENT_ORIGIN / VITE_API_BASE 都改 https://aidemo.xxx.com
# 5. 重新 build + up
export VITE_API_BASE=https://aidemo.xxx.com
bash deploy/deploy.sh
```

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
export VITE_API_BASE=http://<新地址>
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
| 域名（可选） | ~30~50 元/年 |
| 备案 | 0 |

**最低落地成本**：~24 元/月（IP 访问免域名免备案），即可手机+电脑外网访问。

---

## 8. 安全检查清单

- [x] `JWT_SECRET` 已用强随机替换（非 `local-demo-secret`）
- [x] `ALLOW_FILE_STORE_FALLBACK=false`
- [x] 安全组只开 80/443/22，22 限定来源 IP
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
