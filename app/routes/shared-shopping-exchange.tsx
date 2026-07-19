import { LoaderCircle, ListChecks } from "lucide-react";
import { useEffect, useState } from "react";

import type { Route } from "./+types/shared-shopping-exchange";
import { publicSecurityHeaders } from "../../src/sharing/shopping-share";

export function headers() { return publicSecurityHeaders(); }

export default function SharedShoppingExchange(_: Route.ComponentProps) {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("access");
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    if (!token) {
      setError("This checklist link is incomplete or no longer available.");
      return;
    }
    void fetch("/api/public/shopping/exchange", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }).then(async (response) => {
      if (!response.ok) throw new Error("This checklist link has expired or was revoked.");
      const body = await response.json() as { shareId: string };
      window.location.replace(`/shared/shopping/${encodeURIComponent(body.shareId)}`);
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "The checklist could not be opened."));
  }, []);
  return <main className="shared-loading"><div><span className="brand-mark"><ListChecks size={20} /></span>{error ? <><h1>Checklist unavailable</h1><p>{error}</p></> : <><LoaderCircle className="spin" size={24} /><h1>Opening your checklist</h1><p>Loading the latest shopping-list state.</p></>}</div></main>;
}
