import type { Region } from "./enums";
import type { CampaignContent, ShopHours } from "./schemas";

/**
 * Seed data for the first campaign. Prices, ratings, review texts and phone numbers are PLACEHOLDERS
 * carried over from the design prototype — replace them in the admin console before going live.
 */

export const SEED_VEHICLE_MODELS = [
  { id: "m-ix2-edrive20", label: "BMW iX2 eDrive20" },
  { id: "m-ix2-xdrive30", label: "BMW iX2 xDrive30" },
  { id: "m-x2-sdrive20i", label: "BMW X2 sDrive20i" },
  { id: "m-x2-m35i", label: "BMW X2 M35i" }
] as const;

const weekdays = [1, 2, 3, 4, 5, 6];
const hours = (open: string, close: string): ShopHours => ({ open, close, days: weekdays });

export interface SeedShop {
  id: string;
  name: string;
  region: Region;
  city: string;
  address: string;
  phone: string | null;
  hours: ShopHours;
}

export const SEED_SHOPS: SeedShop[] = [
  { id: "s-tucheng", name: "佳成輪胎", region: "north", city: "新北", address: "新北市土城區清水路40號", phone: null, hours: hours("09:00", "18:00") },
  { id: "s-zhongli", name: "潞達車業", region: "north", city: "桃園", address: "桃園市中壢區中華路一段837號", phone: null, hours: hours("09:00", "18:30") },
  { id: "s-zhubei-honghai", name: "浤海輪業", region: "hsinchu", city: "新竹", address: "新竹縣竹北市光明十一路61號", phone: null, hours: hours("09:00", "18:00") },
  { id: "s-hsinchu-zhuyi", name: "竹宜輪胎", region: "hsinchu", city: "新竹", address: "新竹市東區經國路一段243-2號", phone: null, hours: hours("08:30", "18:00") },
  { id: "s-zhubei-yongjin", name: "勇進車業", region: "hsinchu", city: "新竹", address: "新竹縣竹北市縣政二路南段99號", phone: null, hours: hours("09:00", "18:00") },
  { id: "s-xiyun", name: "翔允汽車保修廠", region: "taichung", city: "台中", address: "臺中市西屯區河南路四段57號", phone: null, hours: hours("08:30", "17:30") },
  { id: "s-taiguang", name: "台光汽車輪胎", region: "taichung", city: "台中", address: "臺中市大甲區經國路671號", phone: null, hours: hours("08:30", "18:00") },
  { id: "s-songping", name: "松平輪胎", region: "taichung", city: "台中", address: "臺中市西屯區朝馬路495-1號", phone: null, hours: hours("09:00", "18:00") },
  { id: "s-guangming", name: "廣明輪胎", region: "taichung", city: "台中", address: "臺中市西屯區中科路810號", phone: null, hours: hours("08:30", "18:00") },
  { id: "s-jinshun", name: "金順輪胎行", region: "taichung", city: "台中", address: "臺中市南屯區永春東路888-8號", phone: null, hours: hours("09:00", "18:00") },
  { id: "s-mingpin", name: "名品輪胎", region: "changhua", city: "彰化", address: "彰化縣彰化市中山路一段429號", phone: null, hours: hours("08:30", "18:00") },
  { id: "s-jianqiang", name: "建強輪胎", region: "changhua", city: "彰化", address: "彰化縣員林市員東路二段340號", phone: null, hours: hours("08:30", "18:00") },
  { id: "s-shangxiang", name: "上翔輪胎", region: "changhua", city: "彰化", address: "彰化縣田中鎮員集路二段715號", phone: null, hours: hours("09:00", "17:30") },
  { id: "s-fengming", name: "豐銘壹輪胎", region: "yunlin", city: "雲林", address: "雲林縣虎尾鎮文科路1276號", phone: null, hours: hours("08:30", "18:00") },
  { id: "s-quanyi", name: "銓益輪胎", region: "yunlin", city: "雲林", address: "雲林縣斗六市明德北路一段88號", phone: null, hours: hours("08:30", "18:00") },
  { id: "s-shengxin", name: "勝新輪胎", region: "yunlin", city: "雲林", address: "雲林縣斗六市文化路600號", phone: null, hours: hours("09:00", "18:00") },
  { id: "s-zhihe", name: "志和輪胎行", region: "south", city: "台南", address: "臺南市佳里區佳北路478號", phone: null, hours: hours("08:30", "18:00") },
  { id: "s-yongtong", name: "永通汽車保養場", region: "south", city: "高雄", address: "高雄市鳳山區青年路二段473號", phone: null, hours: hours("08:30", "17:30") },
  { id: "s-weili", name: "威力輪胎行", region: "south", city: "高雄", address: "高雄市三民區鼎力路273號", phone: null, hours: hours("09:00", "18:00") }
];

export const SEED_CAMPAIGN_CONTENT: CampaignContent = {
  eyebrow: "BMW iX2 / X2 Owners Only",
  steps: [
    { title: "選店並下單", body: "選擇一家安裝店，線上完成付款。" },
    { title: "輪胎直送店家", body: "3–5 個工作天內出貨，直接送達你選的安裝店。" },
    { title: "到貨通知＋預約", body: "輪胎到店後以 LINE 通知，一鍵預約安裝時段。" },
    { title: "安裝＋四輪定位", body: "到店安裝，完工即啟用保固與里程追蹤。" }
  ],
  directShipNote: "輪胎不會寄到你家——全程直送安裝店，你只需要人到、車到。",
  specs: [
    { label: "規格尺寸", value: "245/40 R20" },
    { label: "載重指數 / 速度等級", value: "99 (775kg) / W (270km/h)" },
    { label: "結構補強", value: "XL 加強型胎體" },
    { label: "歐盟標籤", value: "滾動阻力 A・濕地抓地 A・噪音 68dB" },
    { label: "產地", value: "台灣製造" },
    { label: "保固", value: "原廠 5 年材料工藝保固（自安裝日起算）" }
  ],
  evPoints: [
    { title: "低滾動阻力配方", body: "針對 EV 續航優化的矽膠配方，減少能耗、延長每次充電的行駛里程。" },
    { title: "高扭力耐磨結構", body: "對應電動馬達瞬間輸出的加強胎體與胎面膠料，抑制 EV 常見的快速磨耗。" },
    { title: "靜音艙技術", body: "胎腔吸音棉設計，補上 EV 少了引擎聲後最明顯的路噪來源。" }
  ],
  timeline: [
    { tag: "Day 0", title: "訂單確認", body: "訂單成立與店家資訊即時通知" },
    { tag: "Day 1–5", title: "出貨通知", body: "輪胎出貨、附物流追蹤" },
    { tag: "到店日", title: "到貨＋預約", body: "輪胎到店，一鍵預約安裝時段" },
    { tag: "期限前 14/7/3 天", title: "安裝提醒", body: "尚未安裝者自動提醒，避免權益失效" },
    { tag: "完工日", title: "保固啟用", body: "保固起算、開始里程與保養追蹤" }
  ],
  faq: [
    { q: "輪胎會寄到我家嗎？", a: "不會。輪胎由原廠直送你選擇的安裝店家，到貨後你會收到通知並預約安裝，不需要自行搬運。" },
    { q: "如何認定「車主限定」資格？", a: "下單時選擇車型，安裝當日出示行照由店家核對。非 iX2 / X2 車輛恕無法適用本活動價。" },
    { q: "下單後可以更換安裝店家嗎？", a: "可以。出貨前可在「我的訂單」自行更換；輪胎出貨後因已配送至指定店家，恕無法變更。" },
    { q: "12/31 前來不及安裝怎麼辦？", a: "活動優惠以 12/31 前完成安裝為限，系統會在期限前 14、3、1 天主動提醒。如有特殊狀況請提前聯繫客服。" }
  ],
  reviews: [
    { stars: 5, body: "換完最有感的是路噪，高速巡航安靜非常多，續航看起來也沒有變差。", who: "iX2 xDrive30 車主", where: "台中安裝" },
    { stars: 5, body: "直送店家這點很方便，到貨收到通知直接約時間，前後不用打半通電話。", who: "X2 M35i 車主", where: "高雄安裝" },
    { stars: 4, body: "抓地力和原廠配胎有感升級，希望之後北部據點可以多一點。", who: "iX2 eDrive20 車主", where: "桃園安裝" }
  ],
  reviewSummary: { rating: "4.8", count: 36 },
  coverageNote:
    "本檔活動據點集中於西部走廊，雙北市區與宜花東暫無配合店家。留下你的地區，下一波據點招募將優先納入需求最高的區域。",
  paymentNote: "付款方式：信用卡（VISA / Master / JCB / 銀聯）・下單後 3–5 個工作天出貨・發票於出貨時開立",
  contact: {
    company: "正新橡膠工業股份有限公司",
    address: "彰化縣大村鄉美港路215號",
    phone: "04-8525151 #705",
    hours: "週一至週五 08:00–17:30",
    email: "maxxis.collection@tw.maxxis.com"
  }
};

export const SEED_CAMPAIGN = {
  id: "c-vsev-ix2-2026q4",
  slug: "vs-ev-plus-bmw-ix2-2026q4",
  title: "VICTRA SPORT EV+ 245/40R20",
  subtitle: "四條一組・含安裝・含四輪定位・含運費",
  productName: "VICTRA SPORT EV+ 245/40R20",
  sizeLabel: "245/40 R20 99W XL",
  includes: ["輪胎四條", "安裝工資", "四輪定位", "運費"],
  /** 2026-11-30 23:59:59 +08:00 */
  orderDeadline: "2026-11-30T15:59:59.000Z",
  /** 2026-12-31 23:59:59 +08:00 */
  installDeadline: "2026-12-31T15:59:59.000Z",
  /** Placeholder prices from the prototype — integer cents (NT$ 39,600 / NT$ 32,800). */
  listPriceCents: 3_960_000,
  salePriceCents: 3_280_000
} as const;

export const SEED_NOTIFICATION_TEMPLATES = [
  { kind: "order_paid", title: "訂單已成立", body: "{{name}} 您好，訂單 {{number}} 已付款成功。輪胎將直送 {{shopName}}，我們會在 3–5 個工作天內出貨。" },
  { kind: "order_shipped", title: "輪胎已出貨", body: "訂單 {{number}} 的輪胎已出貨，目的地：{{shopName}}。到店後會再通知您預約安裝。" },
  { kind: "order_arrived", title: "輪胎已到店，請預約安裝", body: "您的輪胎已送達 {{shopName}}，請於 {{installDeadline}} 前登入預約安裝時段。" },
  { kind: "booking_confirmed", title: "安裝預約成功", body: "已為您預約 {{shopName}}，時間：{{slotAt}}。請攜帶行照以便核對車型資格。" },
  { kind: "install_reminder", title: "安裝期限倒數 {{daysLeft}} 天", body: "訂單 {{number}} 尚未完成安裝，請於 {{installDeadline}} 前到 {{shopName}} 完成安裝，逾期視同放棄活動優惠。" },
  { kind: "warranty_active", title: "保固已啟用，歡迎成為 VSEV 車主", body: "安裝完成！5 年原廠保固已起算，您的專屬推薦碼與里程追蹤也已開通。" }
] as const;
