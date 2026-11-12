import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { ReactElement, ReactNode } from "react";
import { useAuth } from "./auth";
import { AccountPage } from "./pages/AccountPage";
import { AuthPage } from "./pages/AuthPage";
import { CampaignPage } from "./pages/CampaignPage";
import { CheckoutPage } from "./pages/CheckoutPage";
import { OrderPage } from "./pages/OrderPage";

export function RequireAuth({ children }: { children: ReactNode }): ReactElement {
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return <p className="page">載入中…</p>;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace state={loc.state} />;
  return <>{children}</>;
}

export function Header(): ReactElement {
  const { user, logout } = useAuth();
  return (
    <header>
      <Link className="logo" to="/">
        MAXXIS<span> eSHOP</span>
      </Link>
      <div className="top-actions">
        <nav className="top">
          <a href="/#spec">產品規格</a>
          <a href="/#shops">安裝據點</a>
          <a href="/#reviews">車主評價</a>
          <a href="/#faq">常見問題</a>
        </nav>
        {user ? (
          <>
            <Link to="/account">{user.name}</Link>
            <button className="link" onClick={logout}>
              登出
            </button>
          </>
        ) : (
          <Link to="/login">登入</Link>
        )}
      </div>
    </header>
  );
}

export function App(): ReactElement {
  return (
    <>
      <Header />
      <Routes>
        <Route path="/" element={<CampaignPage />} />
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />
        <Route path="/checkout" element={<RequireAuth><CheckoutPage /></RequireAuth>} />
        <Route path="/account" element={<RequireAuth><AccountPage /></RequireAuth>} />
        <Route path="/orders/:id" element={<RequireAuth><OrderPage /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
