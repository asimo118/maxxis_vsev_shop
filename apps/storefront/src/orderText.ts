import type { OrderDto } from "@vsev/shared";
import { fmtDateTime } from "./format";

/** One line telling the customer what happens next (order list + order page). */
export function nextStepText(o: OrderDto): string {
  if (o.cancelRequest) return "已申請取消，客服處理中";
  switch (o.status) {
    case "created":
      return "尚未付款";
    case "paid":
      return "已付款，正在安排出貨到安裝店家";
    case "shipped":
      return o.shipment?.trackingNumber ? `配送中・${o.shipment.carrier ?? ""} ${o.shipment.trackingNumber}`.trim() : "輪胎配送中";
    case "arrived_at_shop":
      return "輪胎已到店，請預約安裝時段";
    case "booked":
      return o.booking ? `已預約 ${fmtDateTime(o.booking.slotAt)}` : "已預約安裝";
    case "installed":
    case "warranty_active":
      return "安裝完成，保固已啟用";
    case "cancelled":
      return "訂單已取消";
    case "refunded":
      return "已退款";
    case "expired":
      return "已超過安裝期限";
  }
}
