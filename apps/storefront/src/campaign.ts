import { SEED_CAMPAIGN, type CampaignPageDto } from "@vsev/shared";
import { useEffect, useState } from "react";
import { api } from "./api";
import { errorText, sessionId } from "./format";

export const CAMPAIGN_SLUG = (import.meta.env["VITE_CAMPAIGN_SLUG"] as string | undefined) ?? SEED_CAMPAIGN.slug;

// One fetch per page load, shared by the campaign, spec, shops and FAQ pages.
let cached: Promise<CampaignPageDto> | null = null;
function loadCampaign(): Promise<CampaignPageDto> {
  cached ??= api.get<CampaignPageDto>(`/campaigns/${CAMPAIGN_SLUG}`).catch((err: unknown) => {
    cached = null; // let the next page retry
    throw err;
  });
  return cached;
}

export function useCampaign(): { page: CampaignPageDto | null; error: string | null } {
  const [page, setPage] = useState<CampaignPageDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    loadCampaign()
      .then((p) => alive && setPage(p))
      .catch((e: unknown) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, []);
  return { page, error };
}

/** Anonymous funnel beacon (never blocks the UI). */
export function beacon(event: string): void {
  void api.post("/track", { sessionId: sessionId(), event, campaignSlug: CAMPAIGN_SLUG }).catch(() => undefined);
}
