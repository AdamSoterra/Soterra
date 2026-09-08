"use client";

import { useEffect, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { upload } from "@vercel/blob/client";
import { ErrorCard, InvalidCard, Loading, LoginGate, RfiThreadView, Shell, type CorrFile, type RfiThread } from "@/app/components/external-views";

// The consultant's side of an RFI - soterra.co.nz/answer/<token>.
//
// Behind the "Answer this RFI online" button in the emailed RFI. The token in
// the link is the authorisation (lib/rfi.ts); on top of it the builder's
// company can require a sign-in on the address the RFI was sent to
// (lib/externalAuth.ts) - the page shows the gate when the API says so.
// The view itself is shared with the portal (app/components/external-views).

export default function AnswerPage({ params }: { params: { token: string } }) {
  const token = params.token;
  // Re-check the link whenever the signed-in state changes (the gate signs
  // people in and out in place, without a page reload).
  const { isSignedIn } = useUser();
  const [thread, setThread] = useState<RfiThread | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "invalid" | "error" | "login" | "mismatch">("loading");
  const [tries, setTries] = useState(0);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch(`/api/rfi-answer?token=${encodeURIComponent(token)}`);
        if (r.status === 404) return setState("invalid");
        if (r.status === 401) return setState("login");
        if (r.status === 403) return setState("mismatch");
        if (!r.ok) return setState("error");
        setThread((await r.json()) as RfiThread);
        setState("ready");
      } catch {
        setState("error");
      }
    })();
  }, [token, tries, isSignedIn]);

  if (state === "loading") return <Loading what="the RFI" />;
  if (state === "error") return <ErrorCard what="the RFI" onRetry={() => { setState("loading"); setTries((t) => t + 1); }} />;
  if (state === "login" || state === "mismatch") return <LoginGate reason={state} what="this RFI" />;
  if (state === "invalid" || !thread) return <InvalidCard hint="The RFI it pointed to may have been withdrawn. Reply to the original email instead and the builder will log your response." />;

  return (
    <Shell company={thread.company} project={thread.project} foot={<>Sent with <b>Soterra</b> · soterra.co.nz · This link is private to this RFI - don&apos;t forward it.</>}>
      <RfiThreadView
        thread={thread}
        sheetSrc={(doc, page) => `/api/rfi-answer/sheet?token=${encodeURIComponent(token)}&doc=${encodeURIComponent(doc)}&page=${page}`}
        fileHref={(path) => `/api/rfi-file?token=${encodeURIComponent(token)}&path=${encodeURIComponent(path)}`}
        uploadFile={
          thread.rfi.uploadPrefix
            ? async (file) => {
                try {
                  // The route only signs paths under this RFI's own folder.
                  const res = await upload(`${thread.rfi.uploadPrefix}${file.name}`, file, {
                    access: "private",
                    handleUploadUrl: "/api/rfi-answer/upload",
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
        act={async (kind, text, name, files) => {
          try {
            const r = await fetch("/api/rfi-answer", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token, kind, body: text, authorName: name, files }),
            });
            const d = (await r.json()) as { ok?: boolean; thread?: RfiThread; error?: string };
            if (!r.ok || !d.ok) return { ok: false, error: d.error };
            return { ok: true, data: d.thread };
          } catch {
            return { ok: false, error: "That didn't go through. Check your connection and try again." };
          }
        }}
      />
    </Shell>
  );
}
