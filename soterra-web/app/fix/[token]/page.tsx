"use client";

import { useEffect, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { upload } from "@vercel/blob/client";
import { ErrorCard, FixView, InvalidCard, Loading, LoginGate, Shell, type CorrFile, type FixData } from "@/app/components/external-views";

// The sub's side of a QA defect - soterra.co.nz/fix/<token>.
//
// Behind the "Mark it fixed" button in the emailed defect. The token in the
// link is the authorisation (lib/qaCloseout.ts); the builder's company can
// also require a sign-in on the address it was sent to (lib/externalAuth.ts).
// The sub is on a phone, at the wall, one hand free: the defect, one photo,
// one note, one button. The view is shared with the portal.

export default function FixPage({ params }: { params: { token: string } }) {
  const token = params.token;
  // Re-check the link whenever the signed-in state changes (the gate signs
  // people in and out in place, without a page reload).
  const { isSignedIn } = useUser();
  const [d, setD] = useState<FixData | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "invalid" | "error" | "login" | "mismatch">("loading");
  const [tries, setTries] = useState(0);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch(`/api/qa-fix?token=${encodeURIComponent(token)}`);
        if (r.status === 404) return setState("invalid");
        if (r.status === 401) return setState("login");
        if (r.status === 403) return setState("mismatch");
        if (!r.ok) return setState("error");
        setD((await r.json()) as FixData);
        setState("ready");
      } catch {
        setState("error");
      }
    })();
  }, [token, tries, isSignedIn]);

  if (state === "loading") return <Loading what="the item" />;
  if (state === "error") return <ErrorCard what="the item" onRetry={() => { setState("loading"); setTries((t) => t + 1); }} />;
  if (state === "login" || state === "mismatch") return <LoginGate reason={state} what="this item" />;
  if (state === "invalid" || !d) return <InvalidCard hint="Reply to the original email instead and the builder will log your update." />;

  return (
    <Shell company={d.company} project={d.project} foot={<>Sent with <b>Soterra</b> · soterra.co.nz · This link is private to this item - don&apos;t forward it.</>}>
      <FixView
        d={d}
        photoSrc={`/api/qa-fix/photo?token=${encodeURIComponent(token)}`}
        fileHref={(path) => `/api/defect-file?token=${encodeURIComponent(token)}&path=${encodeURIComponent(path)}`}
        uploadFile={
          d.uploadPrefix
            ? async (file) => {
                try {
                  const res = await upload(`${d.uploadPrefix}${file.name}`, file, {
                    access: "private",
                    handleUploadUrl: "/api/qa-fix/upload",
                    clientPayload: JSON.stringify({ token }),
                    contentType: file.type || "application/octet-stream",
                  });
                  const f: CorrFile = { filename: file.name, path: res.pathname, bytes: file.size, contentType: file.type || "application/octet-stream" };
                  return { file: f };
                } catch (e) {
                  return { error: e instanceof Error ? e.message : `${file.name} didn't upload.` };
                }
              }
            : null
        }
        onNote={async (text, files) => {
          try {
            const r = await fetch("/api/qa-fix", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, action: "note", note: text, files }) });
            const j = (await r.json()) as { ok?: boolean; defect?: FixData; error?: string };
            if (!r.ok || !j.ok) return { ok: false, error: j.error };
            return { ok: true, data: j.defect };
          } catch {
            return { ok: false, error: "That didn't go through. Check your connection and try again." };
          }
        }}
        uploadPhoto={async (blob) => {
          const r = await fetch(`/api/qa-fix/photo?token=${encodeURIComponent(token)}`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: blob });
          const j = (await r.json().catch(() => ({}))) as { path?: string; error?: string };
          return r.ok && j.path ? { path: j.path } : { error: j.error ?? "That photo didn't upload. Try again." };
        }}
        act={async (note, photoPath, files) => {
          try {
            const r = await fetch("/api/qa-fix", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, note, photoPath, files }) });
            const j = (await r.json()) as { ok?: boolean; defect?: FixData; error?: string };
            if (!r.ok || !j.ok) return { ok: false, error: j.error };
            return { ok: true, data: j.defect };
          } catch {
            return { ok: false, error: "That didn't go through. Check your connection and try again." };
          }
        }}
      />
    </Shell>
  );
}
