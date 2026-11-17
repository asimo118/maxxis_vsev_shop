# 部署：GitHub → GitHub Actions → GHCR → Portainer

```
git push / 合併 PR 到 main
   │
   ▼  GitHub Actions（.github/workflows/ci-cd.yml）
   ├─ 型別檢查、lint、測試、建置
   ├─ 建 api / web 兩個 Docker image，用 docker-compose.yml 起整個 stack，跑 scripts/smoke-test.sh
   ├─ 全部通過才推 image 到 GHCR：ghcr.io/asimo118/maxxis_vsev_shop/{api,web}:latest 與 :sha-<commit>
   └─ 呼叫 Portainer webhook → 等網站回報新版本號（/api/v1/health）
   ▼
Portainer：拉新 image、重新部署 stack（資料在 volume，不受影響）
```

**為什麼不讓 Portainer 直接從原始碼 build？** Portainer 的 Git stack 重新部署時，若 image 已存在，常常不會重 build，
「Re-pull image」對本地 build 的 image 也無效。改由 CI 建好 image、Portainer 只負責拉取，更新才可靠；伺服器也不必有建置工具，
且每個版本都有 `sha-…` tag 可回滾。

## 一次性設定

### 1. 第一次產生 image

把 PR 合併到 `main`。Actions 跑完後，GitHub → 你的帳號 → **Packages** 會出現 `maxxis_vsev_shop/api` 與 `maxxis_vsev_shop/web`。
（repo 是 private，package 預設也是 private。）

image 同時提供 `linux/amd64` 與 `linux/arm64`（Apple Silicon、Raspberry Pi、ARM NAS／雲端主機皆可），Docker 會自動挑對的版本。
CI 會先在模擬的 ARM 環境把整套 stack 跑過 smoke test 才發佈。只需要單一架構時，可在 repo → Settings → Secrets and variables →
Actions → **Variables** 設 `IMAGE_PLATFORMS`（例如 `linux/amd64`）縮短建置時間。

### 2. 讓 Portainer 能讀 repo 和 image

在 GitHub 建一個 token（Settings → Developer settings → Personal access tokens）：

- **Fine-grained token**：Repository access 選 `maxxis_vsev_shop`，權限 **Contents: Read-only**（Portainer 讀 compose 檔用）。
- **Classic token**，scope 只勾 **`read:packages`**（Portainer 拉 GHCR image 用；fine-grained token 目前不支援 GHCR）。

Portainer → **Registries** → Add registry → **Custom registry**：
URL `ghcr.io`、啟用 Authentication、Username = 你的 GitHub 帳號、Password = classic token。

### 3. 建立 stack

Portainer → **Stacks** → Add stack：

| 欄位 | 值 |
|---|---|
| Name | `maxxis-vsev`（volume 會叫 `maxxis-vsev_vsev-data`） |
| Build method | **Repository** |
| Repository URL | `https://github.com/asimo118/maxxis_vsev_shop` |
| Repository reference | `refs/heads/main` |
| Compose path | `docker-compose.yml` |
| Authentication | 開啟；Username = GitHub 帳號、Personal Access Token = fine-grained token |
| **GitOps updates** | 開啟 → Mechanism **Webhook**；開啟 **Re-pull image** 與 **Force redeployment** |
| Environment variables | 用 **Load variables from .env file** 載入 `stack.env.example`，填入真實值 |

複製畫面上的 **webhook URL**，按 **Deploy the stack**。

缺必要變數（JWT secrets、管理員密碼）時 Portainer 會直接報錯、不會啟動半套設定的服務；
沒有設定金流方式（外部購物車或 `ALLOW_MOCK_PAYMENTS=true`）時 API 會拒絕啟動並在 log 說明原因。

### 4. 把 Portainer 接回 GitHub Actions

repo → Settings → Secrets and variables → Actions：

| 類型 | 名稱 | 值 |
|---|---|---|
| Secret | `PORTAINER_WEBHOOK_URL` | 上一步複製的 webhook URL |
| Variable（選填） | `PUBLIC_STOREFRONT_URL` | 對外網址，如 `https://shop.example.com`；設定後 CI 會等到網站回報新版本才算部署成功 |

之後每次合併到 `main`：測試全過 → 推 image → Portainer 自動更新。測試失敗就不會部署。

### 5. 確認

- 前台：`http://<主機>:8080`
- 後台：`http://<主機>:8081`，以 `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` 登入
- 版本：`http://<主機>:8080/api/v1/health` → `{"ok":true,"version":"<commit>"}`
- 從任何電腦都可以跑完整檢查：
  `STOREFRONT=https://shop.example.com ADMIN=http://<主機>:8081 ADMIN_PASSWORD=… scripts/smoke-test.sh`

## 架構

| 服務 | 內容 | 對外 |
|---|---|---|
| `web` | nginx：前台 SPA（:80）、後台 SPA（:8081），兩者都把 `/api` 轉給 API | `STOREFRONT_PORT`、`ADMIN_PORT` |
| `api` | Node API，SQLite 檔在 volume `/data/vsev.db` | 不對外 |
| `backup` | 每天把資料庫線上備份到 `/data/backups`，保留 `BACKUP_KEEP_DAYS` 天 | 不對外 |

安全隔離：**後台 API 只走後台埠**（前台埠的 `/api/v1/admin` 一律 404），**前台 API 只走前台埠**。
所以只要在防火牆或反向代理把後台埠限制成公司 IP / VPN，後台就不會暴露在網路上。

## HTTPS 與網域

在 stack 前面放既有的反向代理（Nginx Proxy Manager、Traefik、Caddy、Cloudflare Tunnel…）：

- `shop.example.com` → `<主機>:8080`
- 後台建議不對外；要對外就加 IP 白名單或額外驗證，指到 `<主機>:8081`
- 前面多一層代理時，把 `TRUST_PROXY` 設為 `2`（登入限流才會用到真正的使用者 IP）
- 啟用外部購物車時，`COMMERCE_RETURN_URL` 要用對外網址

## 維運

**更新**：合併到 `main` 即可。手動：Portainer → stack → **Pull and redeploy**。

**回滾**：stack 的環境變數 `IMAGE_TAG` 改成舊版本（GitHub Packages 頁面可看到 `sha-…` tag）→ Update the stack。
改回 `latest` 即恢復自動更新。資料庫 schema 只會往前升級；回到比資料庫舊的版本時，API 會拒絕啟動（保護資料），此時需搭配還原備份。

**備份放到主機外**（建議每天排程）：

```bash
docker run --rm -v maxxis-vsev_vsev-data:/data -v /srv/vsev-backups:/out alpine \
  sh -c 'cp /data/backups/*.db /out/'
# 再把 /srv/vsev-backups 同步到 NAS / S3 / Google Drive
```

**還原**：

```bash
docker stop maxxis-vsev-api-1 maxxis-vsev-backup-1
docker run --rm -v maxxis-vsev_vsev-data:/data alpine sh -c \
  'cp /data/backups/vsev-20261117T030000Z.db /data/vsev.db && rm -f /data/vsev.db-wal /data/vsev.db-shm && chown 1000:1000 /data/vsev.db'
docker start maxxis-vsev-api-1 maxxis-vsev-backup-1
```

**注意事項**

- `api` 只能跑一個 replica（SQLite 一個檔案只能有一個寫入程序）；不要在 Portainer 調整 scale。
- 管理員密碼以 `SEED_ADMIN_PASSWORD` 為準：`SEED_ON_BOOT=true` 時每次啟動都會套用。要換密碼就改環境變數再 redeploy。
- `ALLOW_MOCK_PAYMENTS=true` 只能用在測試站：所有付款自動成功、不會真的收錢。API 啟動時會在 log 警告。
- Log：Portainer → Containers → `maxxis-vsev-api-1` → Logs（JSON 格式，每個檔 10MB、保留 5 個）。

## 本機用 Docker 測試

```bash
cp stack.env.example stack.env   # 填入 secrets（stack.env 不會進 git）
docker compose --env-file stack.env -f docker-compose.yml -f docker-compose.build.yml up -d --build
ADMIN_PASSWORD=<SEED_ADMIN_PASSWORD> COMPOSE="docker compose --env-file stack.env -f docker-compose.yml" scripts/smoke-test.sh
```
