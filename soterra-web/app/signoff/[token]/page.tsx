"use client";

import { useEffect, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { ErrorCard, InvalidCard, Loading, LoginGate, Shell, SignoffView, type SignoffData } from "@/app/components/external-views";

// The consultant's side of a QA defect - soterra.co.nz/signoff/<token>.
//
// Behind the "Sign it off" button in the emailed sign-off request. The token
// in the link is the authorisation (lib/qaCloseout.ts); the builder's company
// can also require a sign-in on the address it was sent to. The sub has
// marked the defect fixed and attached a photo; the consultant sees the photo
// and either signs it off (closed) or bounces it back (the sub redoes).

export default function SignoffPage({ params }: { params: { token: string } }) {
  const token = params.token;
  // Re-check the link whenever the signed-in state changes (the gate signs
  // people in and out in place, without a page reload).
  const { isSignedIn } = useUser();
  const [d, setD] = useState<SignoffData | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "invalid" | "error" | "login" | "mismatch">("loading");
  const [tries, setTries] = useState(0);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch(`/api/qa-signoff?token=${encodeURIComponent(token)}`);
        if (r.status === 404) return setState("invalid");
        if (r.status === 401) return setState("login");
        if (r.status === 403) return setState("mismatch");
        if (!r.ok) return setState("error");
        setD((await r.json()) as SignoffData);
        setState("ready");
      } catch {
        setState("error");
      }
    })();
  }, [token, tries, isSignedIn]);

  if (state === "loading") return <Loading what="the item" />;
  if (state === "error") return <ErrorCard what="the item" onRetry={() => { setState("loading"); setTries((t) => t + 1); }} />;
  if (state === "login" || state === "mismatch") return <LoginGate reason={state} what="this sign-off" />;
  if (state === "invalid" || !d) return <InvalidCard hint="Reply to the original email instead and the builder will log your decision." />;

  return (
    <Shell company={d.company} project={d.project} foot={<>Sent with <b>Soterra</b> · soterra.co.nz · This link is private to this item - don&apos;t forward it.</>}>
      <SignoffView
        d={d}
        photoSrc={`/api/qa-fix/photo?token=${encodeURIComponent(token)}`}
        act={async (decision, note) => {
          try {
            const r = await fetch("/api/qa-signoff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, decision, note }) });
            const j = (await r.json()) as { ok?: boolean; approved?: boolean; defect?: SignoffData; error?: string };
            if (!r.ok || !j.ok) return { ok: false, error: j.error };
            return { ok: true, data: j.defect ? { ...j.defect, approved: j.approved } : undefined };
          } catch {
            return { ok: false, error: "That didn't go through. Check your connection and try again." };
          }
        }}
      />
    </Shell>
  );
}
