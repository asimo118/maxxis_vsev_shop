# maxxis_vsev_shop
常試著重新規劃與設計 Maxxis VSEV 輪胎網頁購買體驗

## MAXXIS VSEV — 車主限定活動平台

BMW iX2 / X2 車主專屬 VICTRA SPORT EV+ 輪胎方案的完整網站：消費者前台、營運後台、模組化單體 API。
UI 以已核可的亮色版設計稿（`maxxis-vsev-product-page-light.html`）為基礎移植成 React 元件。

```
apps/storefront   消費者前台 SPA（React 18 + Vite）        :5173 → /api/v1/*
apps/admin        營運後台 SPA（獨立 bundle、獨立登入）      :5174 → /api/v1/admin/*
apps/api          模組化單體 API（Express + SQLite）         :4000
packages/shared   zod schema、列舉、錯誤碼、金額、訂單狀態機、CTA gate、API client、seed 資料
packages/ui       亮色 design tokens（tokens.css）、胎紋分隔線、共用元件
```

資料庫是單一 SQLite 檔案（`better-sqlite3`），**不需要 PostgreSQL 或 Redis**。

**車型資料、安裝店家清單、購物車／結帳**都已預留外部連接器，可改由外部 API 提供；未設定時由本系統管理。
規格與設定見 [docs/connectors.md](docs/connectors.md)。

## 功能一覽

**前台**（`apps/storefront`）

| 頁面 | 內容 |
|---|---|
| `/` 活動首頁 | 價格、倒數、選車型＋選店＋確認期限才能購買（CTA gate）；規格與 FAQ 精簡版 |
| `/spec` 產品規格 | 完整規格表、EV 特點、方案內容（內容由後台「產品規格」編輯） |
| `/shops` 安裝據點 | 搜尋、地區篩選、只看營業中、營業日與時間、導航；「選這家訂購」帶回首頁並自動選好 |
| `/faq` 常見問題 | 關鍵字搜尋、客服資訊（內容由後台編輯） |
| `/orders`、`/orders/:id` 我的訂單 | 進度、物流單號、預約／改期／取消預約、出貨前換店、安裝前改車型車牌、取消或申請取消、完整紀錄 |

**後台**（`apps/admin`）

| 頁面 | 內容 |
|---|---|
| 訂單管理 | 依狀態分頁與數量、「取消申請」待辦、搜尋、店家篩選、分頁；訂單詳情只顯示當下可做的下一步（出貨＋物流單號、到店、完工、取消、退款），處理取消申請（同意＝退款／不同意＋回覆），代客修改，內部備註（客戶看不到） |
| 產品規格 | 產品名稱、尺寸、方案內含、規格表、EV 特點、常見問題；可新增、排序、刪除，儲存即更新前台 |
| 店家管理 | 新增／編輯（營業日、時間、電話、上架），新增時可直接加入活動；勾選活動據點 |
| 車型資料 | 新增／改名／上下架車型（不刪除，訂單會引用），顯示車主登記數；勾選活動適用車型，前台車型選單立即更新。外部系統同步模式下為唯讀 |

**訂單可修改範圍**由 `packages/shared/src/order-rules.ts` 統一定義，前台、後台與 API 共用同一份規則：
出貨前可換安裝店家；完成安裝前可改車型與車牌；未付款可直接取消；已付款可申請取消，由後台退款或回覆不同意。



```bash
pnpm install
cp .env.example .env          # 至少改兩組 JWT secret
pnpm db:seed                  # 建立 apps/api/data/vsev.db（自動 migrate）+ 第一檔活動、19 家店、通知範本、管理員
pnpm dev                      # api :4000、前台 :5173、後台 :5174（admin@vsev.local / ChangeMe!2026）
```

不想留資料時可改 `DATA_DRIVER=memory`（重啟即清空）。

想試外部連接器：`pnpm mock:external` 啟動模擬外部系統（:4100），設定見 [docs/connectors.md](docs/connectors.md#本機試跑)。

## 資料庫

| 項目 | 說明 |
|---|---|
| 檔案 | `SQLITE_PATH`（預設 `./data/vsev.db`，相對於 `apps/api`）。WAL 模式，會同時出現 `-wal`、`-shm` 檔 |
| Schema | `apps/api/src/platform/sqlite.migrations.ts`，版本記在 `PRAGMA user_version`；API 啟動時自動 migrate，遇到比程式新的 schema 會拒絕啟動 |
| 型別保護 | STRICT tables：金額／點數只能是整數；狀態欄位有 CHECK 對應 `@vsev/shared` 列舉；點數帳本 `UNIQUE (reason, ref_id)` 防重複發點 |
| 排程 | 沒設 Redis 時，安裝期限提醒（14/3/1 天）、點數發放等工作存在同一個 SQLite 的 `jobs` 表，**重啟、重新部署都不會遺失**；中斷中的工作會在下次啟動重跑 |
| 備份 | `pnpm db:backup [目的檔]`：SQLite 線上備份，API 運行中也安全。**不要直接 cp 運作中的 .db 檔** |
| 限制 | 一個資料庫檔只能有**一個** API 程序寫入；不能水平擴充成多台 |

指令：`pnpm db:migrate`、`pnpm db:seed`（可重複執行）、`pnpm db:backup`。

## 部署

**Docker / Portainer（建議）**：GitHub Actions 測試通過後把 image 推到 GHCR，Portainer 透過 webhook 自動更新。
完整步驟見 [docs/deploy-portainer.md](docs/deploy-portainer.md)；環境變數範本為 `stack.env.example`。

```
Dockerfile              api 與 web（nginx）兩個 image
docker-compose.yml      Portainer stack：web、api、每日備份
.github/workflows/      CI/CD：測試 → 建 image → 整套 stack smoke test → 推 GHCR → 觸發 Portainer
scripts/smoke-test.sh   對執行中的網站做端到端檢查（CI 與手動皆可用）
```

### 不用 Docker（單台主機）

前後台是靜態檔，API 是一個 Node 程序加一個資料庫檔，一台 VM（1–2 vCPU / 2GB）即可。

```bash
# 主機：Ubuntu + Node 22 + pnpm + pm2
git clone … && cd maxxis-vsev          # 或解壓縮 zip
cp .env.example .env                   # NODE_ENV、SQLITE_PATH=/var/lib/vsev/vsev.db（持久磁碟）、secrets…
pnpm install --frozen-lockfile
pnpm build                             # api → apps/api/dist/*.mjs；前後台 → apps/*/dist
pnpm db:seed
pm2 start "pnpm start" --name vsev-api && pm2 save && pm2 startup
```

反向代理（Caddy 會自動申請 HTTPS）：

```
shop.example.com {
  handle /api/* { reverse_proxy localhost:4000 }
  handle { root * /srv/maxxis-vsev/apps/storefront/dist; try_files {path} /index.html; file_server }
}
admin.example.com {
  handle /api/* { reverse_proxy localhost:4000 }
  handle { root * /srv/maxxis-vsev/apps/admin/dist; try_files {path} /index.html; file_server }
}
```

每日備份（crontab）：`0 3 * * * cd /srv/maxxis-vsev && pnpm db:backup /var/backups/vsev/vsev-$(date +\%F).db`，並把備份同步到異地（例如 S3／GCS）。

**PaaS 注意**：SQLite 需要持久磁碟。Fly.io（volume）、Railway（volume）、Render（persistent disk，付費方案）可以；
檔案系統會被清空的環境（Heroku、Render 免費方案、Vercel / Cloudflare 的 serverless）不能放 API。

## API 模組

| 模組 | 職責 | 主要端點 |
|---|---|---|
| auth | 會員／管理員登入，兩組 JWT audience，RBAC（operator / manager / finance） | `/auth/*`、`/admin/auth/*` |
| catalog | 活動頁內容、價格、期限；活動頁快取 `campaign:{slug}`，事件驅動失效 | `/campaigns/:slug`、`/admin/campaigns` |
| vehicle | 車型資格、會員車輛 | `/vehicle-models`、`/me/vehicles` |
| shop-network | 店家、營業時間、活動據點指派、覆蓋缺口 | `/coverage-requests`、`/admin/shops` |
| order | 唯一的訂單狀態寫入者 `OrderService.transition()`（CAS + 稽核同一 transaction）；付款與 webhook（冪等）；客戶修改、取消申請、後台代改、內部備註、物流資訊 | `/orders`、`/me/orders/:id`、`/admin/orders/summary` |
| fulfillment | 出貨、到店、預約（營業時間＋期限檢查）、完工、每日逾期掃描 | `/orders/:id/booking`、`/admin/orders/:id/ship…` |
| loyalty | 點數帳本（整數、(reason, refId) 唯一）、推薦碼（僅後端驗證） | `/me/points`、`/admin/points/adjust` |
| notification | 範本、去重發送紀錄、安裝期限提醒（安裝或取消時撤銷） | `/admin/notifications/*` |
| maintenance | 保固啟用後的里程與保養 | `/me/mileage` |
| reporting | 匿名漏斗 beacon、儀表板、車主列表（唯一的跨表唯讀例外） | `/track`、`/admin/dashboard` |
| connectors | 外部連接器：車型與店家同步、購物車轉交與 webhook、狀態（`apps/api/src/connectors/`） | `/checkout-config`、`/connectors/commerce/webhook`、`/admin/connectors` |

每個模組的 repository 都有兩個實作：`*.repository.sqlite.ts`（正式）與 `*.repository.memory.ts`（測試／展示），
介面相同。只有 `*.repository.sqlite.ts` 可以碰資料庫（lint 與架構測試都會擋）。

訂單狀態：`created → paid → shipped → arrived_at_shop → booked → installed → warranty_active`，
另有 `cancelled / refunded / expired`。`installed` 會自動接續 `warranty_active`（購物者 → 車主），
並觸發點數、推薦獎勵、保固通知與里程追蹤。

## 驗證

```bash
pnpm typecheck && pnpm test && pnpm lint && pnpm build
```

每次 push 與 PR 都會在 GitHub Actions 自動跑上述檢查，再建 Docker image、啟動整套 stack 做 smoke test。

API 測試（66 項）每一個情境都分別在 **memory 與 SQLite 兩種 driver** 上執行，確保行為一致：
完整旅程、推薦碼、token audience 隔離、他人訂單隱藏、webhook 冪等、預約規則、逾期與提醒撤銷、RBAC、
後台搜尋／分頁／彙總／退款／覆蓋缺口／活動與店家更新。另有 SQLite 專屬測試：重啟後資料與待發提醒仍在並準時觸發、
中斷工作重跑、線上備份、migration 版本、資料庫層的整數／列舉／帳本唯一性約束，以及模組邊界的架構測試。
連接器測試以真的 HTTP 打模擬外部系統：同步與上游變更、停用消失項目、HTTP 500／格式錯誤／逾時／空清單／重複 id 時保留舊資料、
權杖錯誤、後台唯讀、外部結帳轉交（SKU、價格、回傳網址）、webhook 簽章／冪等／externalRef 比對、外部斷線時訂單不受影響。

## 上線前必須處理

- **金流**：二選一。(a) 接外部購物車（`COMMERCE_CONNECTOR=http`，付款在外部完成），或 (b) 用內建流程並實作 `PaymentGateway`（綠界、藍新、TapPay…）。
  內建流程目前是自動核准的 mock，`NODE_ENV=production` 且未啟用外部購物車時會拒絕啟動。
- **外部連接器**：介面與模擬系統已完成；接上真實系統時，若對方格式不同，改寫 `apps/api/src/connectors/` 的 adapter 即可。
- **通知僅 console 轉接器**：LINE / Email 需實作 `NotificationChannel`。
- **示意資料**：價格、評價、評分沿用設計稿；店家電話為空。請在後台或 seed 中替換。
- **備份與異地保存**：SQLite 是單一檔案，備份排程與異地複製是上線必要條件（亦可評估 Litestream 持續複寫）。
- **副作用為「提交後發佈事件」**：不是與訂單同一個 transaction；以持久化佇列重試 + 冪等鍵（帳本 unique、通知 dedupeKey、jobId）保證最終一致。
- 活動內容（價格、期限、頁面文案）目前透過 `PUT /api/v1/admin/campaigns/:id` 修改，後台表單編輯器為後續項目。
