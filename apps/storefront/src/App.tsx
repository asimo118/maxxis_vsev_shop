import { Link, NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useEffect, type ReactElement, type ReactNode } from "react";
import { useAuth } from "./auth";
import { AccountPage } from "./pages/AccountPage";
import { AuthPage } from "./pages/AuthPage";
import { CampaignPage } from "./pages/CampaignPage";
import { CheckoutPage } from "./pages/CheckoutPage";
import { FaqPage } from "./pages/FaqPage";
import { OrderPage } from "./pages/OrderPage";
import { OrdersPage } from "./pages/OrdersPage";
import { ShopsPage } from "./pages/ShopsPage";
import { SpecPage } from "./pages/SpecPage";

/** Start each page at the top (in-page anchors like /#reviews still scroll to their section). */
function ScrollToTop(): null {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (!hash) window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}

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
          <NavLink to="/spec">產品規格</NavLink>
          <NavLink to="/shops">安裝據點</NavLink>
          <NavLink to="/faq">常見問題</NavLink>
          <NavLink to="/orders">我的訂單</NavLink>
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
      <ScrollToTop />
      <Header />
      <Routes>
        <Route path="/" element={<CampaignPage />} />
        <Route path="/spec" element={<SpecPage />} />
        <Route path="/shops" element={<ShopsPage />} />
        <Route path="/faq" element={<FaqPage />} />
        <Route path="/orders" element={<RequireAuth><OrdersPage /></RequireAuth>} />
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
