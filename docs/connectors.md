# 外部連接器（Connectors）整合指南

網站的三塊資料／流程可以改由外部系統提供，介面已預留好：

| 連接器 | 預設（不設定時） | 改用外部系統時 | 方式 |
|---|---|---|---|
| **車型資料** `vehicles` | 本系統資料庫（seed） | `VEHICLE_SOURCE=http` | **同步**：定時拉取整份清單，鏡像到本地 |
| **安裝店家清單** `shops` | 後台「店家」頁維護 | `SHOP_SOURCE=http` | **同步**：同上；後台店家頁轉為唯讀 |
| **購物車／結帳** `commerce` | 內建付款流程（PaymentGateway） | `COMMERCE_CONNECTOR=http` | **轉交**：本系統驗證訂單後，導向外部購物車；外部以 webhook 回報付款結果 |

不設定任何連接器時，行為與原本完全相同。

## 設計原則

- **主資料用「同步＋本地鏡像」，不即時查詢。** 活動頁、預約時段檢查（營業時間）、活動據點指派都讀本地資料，
  外部系統短暫斷線不影響前台；同步失敗時保留最後一次成功的資料，並在後台「外部連接」頁顯示原因。
- **整份清單、全有或全無。** 回應任何一筆不符合規格（缺欄位、型別錯、id 重複），整次同步作廢，不會只更新一半。
- **防誤刪。** 外部回傳空清單會被拒絕（遠比「我們不賣任何車型」更可能是上游錯誤）。上游消失的項目會被**停用**而非刪除，
  因為既有訂單與車主車輛仍參照它們。
- **訂單永遠在本系統成立。** 車型資格、店家是否屬於活動、安裝期限確認、推薦碼、價格都由本系統驗證後，才交給外部購物車；
  訂單狀態機、提醒、點數、保固流程照常運作。
- **所有外部回應都以 zod 驗證**（`packages/shared/src/connectors.ts`），外部的錯誤不會寫進資料庫。

## 環境變數

```bash
# 車型
VEHICLE_SOURCE=http
VEHICLE_SOURCE_URL=https://partner.example.com/api/vsev/vehicle-models
VEHICLE_SOURCE_TOKEN=…            # 選填：送出 Authorization: Bearer <token>

# 店家
SHOP_SOURCE=http
SHOP_SOURCE_URL=https://partner.example.com/api/vsev/shops
SHOP_SOURCE_TOKEN=…

CONNECTOR_SYNC_INTERVAL_MIN=30     # 同步間隔（另外：啟動時同步一次、後台可手動「立即同步」）
CONNECTOR_TIMEOUT_MS=8000

# 購物車／結帳
COMMERCE_CONNECTOR=http
COMMERCE_API_URL=https://partner.example.com/api/vsev     # 本系統會 POST {URL}/checkouts
COMMERCE_API_TOKEN=…
COMMERCE_WEBHOOK_SECRET=…          # 必填：外部系統簽 webhook 用的共用密鑰
COMMERCE_RETURN_URL=https://shop.example.com/orders/{orderId}?from=checkout
COMMERCE_SKU_MAP={"vs-ev-plus-bmw-ix2-2026q4":"VSEVP-2454020-SET4"}   # 活動 slug → 外部 SKU
```

## 1. 車型資料 — `GET {VEHICLE_SOURCE_URL}`

回傳陣列，或 `{ "items": [...] }`：

```json
{ "items": [
  { "id": "m-ix2-xdrive30", "label": "BMW iX2 xDrive30", "active": true },
  { "id": "m-x2-m35i",      "label": "BMW X2 M35i xDrive" }
] }
```

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | string，1–64 字 | 穩定 id。活動的「適用車型」以此對應，請勿變更 |
| `label` | string，1–120 字 | 前台顯示名稱 |
| `active` | boolean，選填（預設 true） | false = 前台不顯示、不可下單 |

## 2. 安裝店家 — `GET {SHOP_SOURCE_URL}`

```json
[
  { "id": "s-xiyun", "name": "西運輪胎", "region": "taichung", "city": "台中",
    "address": "台中市西屯區…", "phone": "04-2xxx-xxxx",
    "hours": { "open": "09:00", "close": "18:00", "days": [1,2,3,4,5,6] }, "active": true }
]
```

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | string，1–64 字 | 穩定 id；物流目的地與預約都以此對應 |
| `region` | `north` `hsinchu` `taichung` `changhua` `yunlin` `south` | 前台地區篩選 |
| `hours.open/close` | `"HH:MM"`（台北時間） | 預約時段必須落在營業時間內 |
| `hours.days` | 1–7 的陣列（1 = 週一） | 營業日 |
| `phone` | string 或 null | null 時前台不顯示電話按鈕 |
| `active` | boolean，選填 | false = 暫停接單 |

店家是否參加某檔活動，仍在本系統後台「活動」頁指派（這是行銷決策，不屬於店家主檔）。

## 3. 購物車／結帳

```
購物者 ──按「前往結帳」──▶ 本系統 POST /api/v1/orders/:id/checkout
                               │ ① 驗證訂單（活動仍開放、狀態為待付款）
                               │ ② POST {COMMERCE_API_URL}/checkouts ──▶ 外部系統
                               │ ③ ◀── { externalRef, checkoutUrl }
購物者 ◀── 導向 checkoutUrl ───┘
  │ 在外部購物車付款
外部系統 ── POST /api/v1/connectors/commerce/webhook（HMAC 簽章）──▶ 本系統：訂單 → 已付款
購物者 ◀── 外部導回 returnUrl（/orders/:id?from=checkout，頁面會自動等待付款確認）
```

### 3a. 建立結帳 — 本系統呼叫 `POST {COMMERCE_API_URL}/checkouts`

```json
{
  "orderId": "fa481385-…", "orderNumber": "VSEV-20261112-H8CV",
  "campaignSlug": "vs-ev-plus-bmw-ix2-2026q4", "sku": "VSEVP-2454020-SET4",
  "productName": "VICTRA SPORT EV+ 245/40R20", "quantity": 1,
  "unitPriceCents": 3280000, "currency": "TWD",
  "customer": { "id": "…", "name": "王大明", "email": "…", "phone": null },
  "vehicle": { "modelId": "m-ix2-xdrive30", "modelLabel": "BMW iX2 xDrive30", "plate": "ABC-1234" },
  "installShop": { "id": "s-xiyun", "name": "西運輪胎", "address": "…" },
  "installDeadline": "2026-12-31T15:59:59.000Z",
  "returnUrl": "https://shop.example.com/orders/fa481385-…?from=checkout"
}
```

金額一律為**整數，單位為「分」**（`3280000` = NT$32,800）；價格以本系統為準。

外部系統須回應（2xx）：

```json
{ "externalRef": "EXT-A05C6124", "checkoutUrl": "https://partner.example.com/cart/EXT-A05C6124" }
```

### 3b. 付款結果 — 外部系統呼叫 `POST https://<API 網域>/api/v1/connectors/commerce/webhook`

```json
{ "eventId": "evt_7f3a…", "type": "order.paid", "orderId": "fa481385-…", "externalRef": "EXT-A05C6124" }
```

- `type`：`order.paid`、`order.cancelled`、`order.refunded`
- **簽章（必填）**：header `x-vsev-signature` = 以 `COMMERCE_WEBHOOK_SECRET` 對**原始 request body** 計算的 HMAC-SHA256（hex）。
  ```js
  const sig = crypto.createHmac("sha256", SECRET).update(rawBody).digest("hex");
  ```
- **冪等**：同一個 `eventId` 重送只會套用一次；`externalRef` 必須與建立結帳時回傳的一致，否則回 404。
- 回應 `{ "applied": true|false, "status": "<訂單目前狀態>" }`。已不適用的事件（例如已安裝後才送來 cancelled）
  回 `applied:false`、HTTP 200，不會讓對方無限重試。
- 本系統會把付款紀錄記在訂單稽核軌跡（actor = `commerce`），之後的出貨、提醒、點數流程照常。

啟用外部購物車時，內建的 `POST /orders/:id/pay` 會停用（回 E2012）。

## 錯誤代碼

| 代碼 | HTTP | 情境 |
|---|---|---|
| E5001 | 502 | 外部系統無法連線、逾時、非 2xx、或回應不符規格（購物者只看到「外部系統暫時無法連線」，細節記在日誌與後台） |
| E2012 | 409 | 資料由外部系統管理（例如後台想新增店家，或外部購物車模式下呼叫內建付款） |

## 本機試跑

```bash
pnpm mock:external     # 模擬外部系統 :4100（車型、店家、購物車頁、會簽 webhook 回本系統）
```

`.env` 加上：

```bash
VEHICLE_SOURCE=http
VEHICLE_SOURCE_URL=http://localhost:4100/vehicle-models
SHOP_SOURCE=http
SHOP_SOURCE_URL=http://localhost:4100/shops
COMMERCE_CONNECTOR=http
COMMERCE_API_URL=http://localhost:4100
COMMERCE_WEBHOOK_SECRET=dev-commerce-webhook-secret
```

再 `pnpm dev`：前台下單後會跳到模擬購物車，按「模擬付款成功」即回到訂單頁並顯示已付款；後台「外部連接」頁可看到同步狀態。

## 接上真正的外部系統

- 對方的 API 若與上述格式不同，只需改寫 `apps/api/src/connectors/` 裡對應的 adapter（`feeds.http.ts`、`commerce.http.ts`），
  把對方格式轉成本系統的契約；模組（訂單、店家、車型）的程式不需更動。
- 對方若是推播（webhook）而非被拉取，可新增一個接收端點，收到後呼叫同一個 `syncFromFeed()`。
- 測試：`apps/api/test/connectors.test.ts` 以模擬外部系統涵蓋同步、上游變更、各種失敗、唯讀、結帳轉交、webhook 簽章與冪等。
