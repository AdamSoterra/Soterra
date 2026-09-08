"use client";

import { useEffect, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { upload } from "@vercel/blob/client";
import { CorrespondenceView, ErrorCard, InvalidCard, Loading, LoginGate, Shell, type CorrFile, type CorrViewData } from "@/app/components/external-views";

// The recipient's side of a piece of correspondence - soterra.co.nz/correspondence/<token>.
//
// Behind the "Open in Soterra" button in the emailed notice / instruction /
// transmittal / letter. The token in the link is the authorisation
// (lib/correspondence.ts); the builder's company can also require a sign-in
// on the address it was sent to. The page shows the item, its files and the
// thread, and takes a reply (with files) straight into the register.

export default function CorrespondencePage({ params }: { params: { token: string } }) {
  const token = params.token;
  // Re-check the link whenever the signed-in state changes (the gate signs
  // people in and out in place, without a page reload).
  const { isSignedIn } = useUser();
  const [view, setView] = useState<CorrViewData | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "invalid" | "error" | "login" | "mismatch">("loading");
  const [tries, setTries] = useState(0);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch(`/api/correspondence-link?token=${encodeURIComponent(token)}`);
        if (r.status === 404) return setState("invalid");
        if (r.status === 401) return setState("login");
        if (r.status === 403) return setState("mismatch");
        if (!r.ok) return setState("error");
        setView((await r.json()) as CorrViewData);
        setState("ready");
      } catch {
        setState("error");
      }
    })();
  }, [token, tries, isSignedIn]);

  if (state === "loading") return <Loading what="the item" />;
  if (state === "error") return <ErrorCard what="the item" onRetry={() => { setState("loading"); setTries((t) => t + 1); }} />;
  if (state === "login" || state === "mismatch") return <LoginGate reason={state} what="this item" />;
  if (state === "invalid" || !view) return <InvalidCard hint="The item it pointed to may have been withdrawn. Reply to the original email instead and the builder will log your response." />;

  const fileHref = (path: string) => `/api/corr-file?token=${encodeURIComponent(token)}&path=${encodeURIComponent(path)}`;

  return (
    <Shell company={view.company} project={view.project} foot={<>Sent with <b>Soterra</b> · soterra.co.nz · This link is private to this item - don&apos;t forward it.</>}>
      <CorrespondenceView
        view={view}
        fileHref={fileHref}
        uploadFile={async (file) => {
          try {
            // The route only signs paths under the item's own folder.
            const res = await upload(`${view.item.uploadPrefix}${file.name}`, file, {
              access: "private",
              handleUploadUrl: "/api/correspondence-link/upload",
              clientPayload: JSON.stringify({ token }),
              contentType: file.type || "application/octet-stream",
            });
            const f: CorrFile = { filename: file.name, path: res.pathname, bytes: file.size, contentType: file.type || "application/octet-stream" };
            return { file: f };
          } catch (e) {
            return { error: e instanceof Error ? e.message : `${file.name} didn't upload.` };
          }
        }}
        act={async (text, name, files) => {
          try {
            const r = await fetch("/api/correspondence-link", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token, body: text, authorName: name, files }),
            });
            const j = (await r.json()) as { ok?: boolean; view?: CorrViewData; error?: string };
            if (!r.ok || !j.ok) return { ok: false, error: j.error };
            return { ok: true, data: j.view };
          } catch {
            return { ok: false, error: "That didn't go through. Check your connection and try again." };
          }
        }}
      />
    </Shell>
  );
}
