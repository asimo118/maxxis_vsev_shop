/**
 * One error-code table shared by storefront, admin and API.
 * A code shown on a customer's screen can be grepped straight into the backend logs.
 */
export const ERROR_CODES = {
  VALIDATION_FAILED: "E1000",
  UNAUTHENTICATED: "E1001",
  FORBIDDEN: "E1003",
  NOT_FOUND: "E1004",
  CONFLICT: "E1009",
  CAMPAIGN_NOT_LIVE: "E2001",
  ORDER_DEADLINE_PASSED: "E2002",
  VEHICLE_NOT_ELIGIBLE: "E2003",
  SHOP_NOT_AVAILABLE: "E2004",
  DEADLINE_NOT_ACKNOWLEDGED: "E2005",
  INVALID_TRANSITION: "E2006",
  REFERRAL_INVALID: "E2007",
  BOOKING_SLOT_INVALID: "E2008",
  PAYMENT_FAILED: "E2009",
  INSTALL_DEADLINE_PASSED: "E2010",
  INSUFFICIENT_POINTS: "E2011",
  MANAGED_EXTERNALLY: "E2012",
  ORDER_LOCKED: "E2013",
  INTERNAL: "E5000",
  CONNECTOR_UNAVAILABLE: "E5001"
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** Customer-facing messages (Traditional Chinese). */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  E1000: "輸入資料有誤，請檢查後再試一次。",
  E1001: "請先登入。",
  E1003: "你沒有權限執行這個動作。",
  E1004: "找不到指定的資料。",
  E1009: "資料已存在或狀態衝突，請重新整理後再試。",
  E2001: "這檔活動目前未開放訂購。",
  E2002: "已超過活動訂購截止時間。",
  E2003: "你選擇的車型不在本活動資格內。",
  E2004: "你選擇的安裝店家不在本活動配合名單內。",
  E2005: "請先確認安裝期限（需於期限前完成安裝）。",
  E2006: "訂單目前的狀態無法執行這個動作。",
  E2007: "推薦碼無效，或不能使用自己的推薦碼。",
  E2008: "預約時段無效，請選擇安裝期限內的營業時段。",
  E2009: "付款未完成，請重新嘗試。",
  E2010: "已超過安裝期限。",
  E2011: "點數餘額不足。",
  E2012: "這項資料由外部系統管理，請到來源系統修改。",
  E2013: "目前的訂單狀態無法進行這項修改。",
  E5000: "系統發生錯誤，請稍後再試。",
  E5001: "外部系統暫時無法連線，請稍後再試。"
};

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    requestId?: string;
    details?: unknown;
  };
}
