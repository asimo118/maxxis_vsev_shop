import { ErrorNote } from "@vsev/ui";
import type { AdminRole } from "@vsev/shared";
import { useState, type FormEvent, type ReactElement } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { errorText } from "./api";
import { useAdmin } from "./auth";
import { AccountSettingsPage } from "./pages/AccountSettingsPage";
import { AdminsPage } from "./pages/AdminsPage";
import { CampaignsPage } from "./pages/CampaignsPage";
import { ConnectorsPage } from "./pages/ConnectorsPage";
import { ContentPage } from "./pages/ContentPage";
import { DashboardPage } from "./pages/DashboardPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { OrderDetailPage, OrdersPage } from "./pages/OrdersPage";
import { OwnersPage } from "./pages/OwnersPage";
import { ShopsPage } from "./pages/ShopsPage";

function Login(): ReactElement {
  const { login } = useAdmin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    try {
      await login(email, password);
    } catch (ex) {
      setError(errorText(ex));
    }
  };
  return (
    <form className="card login" onSubmit={(e) => void submit(e)}>
      <h2>VSEV 營運後台</h2>
      <div className="field"><label htmlFor="e">Email</label><input id="e" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <div className="field"><label htmlFor="p">密碼</label><input id="p" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
      {error && <ErrorNote message={error} />}
      <button className="btn">登入</button>
    </form>
  );
}

/** [path, label, roles that see it (omitted = everyone)]. The API enforces the same limits. */
const NAV: [string, string, AdminRole[]?][] = [
  ["/", "儀表板"], ["/orders", "訂單管理"], ["/content", "產品規格"], ["/shops", "店家管理"], ["/campaigns", "活動"],
  ["/notifications", "通知"], ["/owners", "車主與點數"], ["/connectors", "外部連接"], ["/admins", "後台帳號", ["manager"]]
];

export function App(): ReactElement {
  const { admin, ready, logout, can } = useAdmin();
  if (!ready) return <p style={{ padding: 24 }}>載入中…</p>;
  if (!admin) return <Login />;
  return (
    <div className="shell">
      <nav className="side">
        <div className="brand">VSEV ADMIN</div>
        {NAV.filter(([, , roles]) => !roles || can(...roles)).map(([to, label]) => (
          <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => (isActive ? "active" : "")}>{label}</NavLink>
        ))}
        <div className="who">
          {admin.name}（{admin.role}）<br />
          <NavLink to="/account" className="link">帳號設定</NavLink>{"　"}<button className="link" onClick={logout}>登出</button>
        </div>
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/orders/:id" element={<OrderDetailPage />} />
          <Route path="/content" element={<ContentPage />} />
          <Route path="/shops" element={<ShopsPage />} />
          <Route path="/campaigns" element={<CampaignsPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/owners" element={<OwnersPage />} />
          <Route path="/connectors" element={<ConnectorsPage />} />
          <Route path="/account" element={<AccountSettingsPage />} />
          {can("manager") && <Route path="/admins" element={<AdminsPage />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
