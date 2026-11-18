import type { CampaignContent } from "@vsev/shared";
import type { ReactElement } from "react";
import { Link } from "react-router-dom";

export function SiteFooter({ contact }: { contact: CampaignContent["contact"] }): ReactElement {
  return (
    <footer>
      <nav className="foot-links">
        <Link to="/">活動首頁</Link>
        <Link to="/spec">產品規格</Link>
        <Link to="/shops">安裝據點</Link>
        <Link to="/faq">常見問題</Link>
        <Link to="/orders">我的訂單</Link>
      </nav>
      {contact.company}・{contact.address}
      <br />
      客服專線 {contact.phone}（{contact.hours}）・{contact.email}
    </footer>
  );
}
