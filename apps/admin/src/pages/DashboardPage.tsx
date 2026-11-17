import { ORDER_STATUS_LABELS, formatTWD, type DashboardDto } from "@vsev/shared";
import { ErrorNote, Spinner } from "@vsev/ui";
import type { ReactElement } from "react";
import { useResource } from "../hooks";

export function DashboardPage(): ReactElement {
  const { data, error } = useResource<DashboardDto>("/dashboard");
  if (error) return <ErrorNote message={error} />;
  if (!data) return <Spinner />;
  const top = Math.max(1, ...data.funnel.map((f) => f.count));
  return (
    <>
      <h1>儀表板{data.campaign ? `・${data.campaign.title}` : ""}</h1>
      <div className="kpis">
        <div className="kpi"><small>訂單數</small><b>{data.kpis.orders}</b></div>
        <div className="kpi"><small>已收款金額</small><b>{formatTWD(data.kpis.paidRevenueCents)}</b></div>
        <div className="kpi"><small>完成安裝</small><b>{data.kpis.installed}</b></div>
        <div className={`kpi${data.kpis.atRisk > 0 ? " warn" : ""}`}><small>14 天內到期未安裝</small><b>{data.kpis.atRisk}</b></div>
      </div>
      <div className="card">
        <h2>轉換漏斗</h2>
        {data.funnel.map((f) => (
          <div className="funnel" key={f.key}>
            <span>{f.label}</span>
            <div className="bar" style={{ width: `${(f.count / top) * 100}%` }} />
            <b>{f.count}</b>
          </div>
        ))}
      </div>
      <div className="grid2">
        <div className="card">
          <h2>各店訂單</h2>
          <table className="t"><thead><tr><th>店家</th><th>訂單</th><th>已安裝</th></tr></thead>
            <tbody>{data.byShop.map((s) => <tr key={s.shopId}><td>{s.shopName}</td><td>{s.orders}</td><td>{s.installed}</td></tr>)}</tbody></table>
        </div>
        <div className="card">
          <h2>狀態分布</h2>
          <table className="t"><tbody>{data.byStatus.map((s) => <tr key={s.status}><td>{ORDER_STATUS_LABELS[s.status]}</td><td>{s.count}</td></tr>)}</tbody></table>
        </div>
      </div>
    </>
  );
}
