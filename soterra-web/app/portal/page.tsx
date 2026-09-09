"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useClerk, useUser } from "@clerk/nextjs";
import { upload } from "@vercel/blob/client";
import {
  CorrespondenceView,
  FixView,
  RfiThreadView,
  Shell,
  SignoffView,
  fmtDate,
  type CorrFile,
  type CorrViewData,
  type FixData,
  type RfiThread,
  type SignoffData,
} from "@/app/components/external-views";

// The consultant / subcontractor portal - soterra.co.nz/portal.
//
// A password-protected home for everyone on the other side of a builder's
// Soterra: sign in with the email the builder sends to, and every RFI, defect,
// sign-off and piece of correspondence addressed to that email is here, on
// every project, with the same pages the emailed links open. Nothing of the
// builder's beyond the items addressed to you (see /api/portal).

type Item = {
  kind: "rfi" | "corr" | "fix" | "signoff";
  id: string;
  table?: "flag" | "item" | "check";
  label: string;
  title: string;
  project: string;
  company: string;
  status: string;
  needsYou: boolean;
  overdue: boolean;
  due: string | null;
  at: string | null;
  meta: string;
};
type ListData = { me: { name: string; emails: string[] }; items: Item[] };

const KIND_LABEL: Record<Item["kind"], string> = { rfi: "RFI", corr: "Correspondence", fix: "Defect to fix", signoff: "Sign-off" };
const STATUS_TEXT = (it: Item): string => {
  if (it.kind === "rfi") return it.status === "open" ? "Awaiting your answer" : it.status === "answered" ? "Answered · with the builder" : "Closed";
  if (it.kind === "corr") return it.status === "sent" ? (it.needsYou ? "Response needed" : "For your records") : it.status === "responded" ? "You replied" : "Closed";
  if (it.kind === "fix") return it.status === "sent" ? "To fix" : it.status === "ready" ? "Marked fixed · with the builder" : it.status === "submitted" ? "With the consultant" : it.status === "closed" ? "Signed off" : it.status;
  return it.status === "submitted" ? "Awaiting your sign-off" : it.status === "closed" ? "Signed off" : it.status === "sent" ? "Bounced back to the sub" : it.status;
};

export default function PortalPage() {
  const { isLoaded, isSignedIn } = useUser();
  const clerk = useClerk();
  const [list, setList] = useState<ListData | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [tries, setTries] = useState(0);
  const [open, setOpen] = useState<Item | null>(null);
  const [detail, setDetail] = useState<{ kind: Item["kind"]; data: unknown } | null>(null);
  const [detailState, setDetailState] = useState<"idle" | "loading" | "error">("idle");
  const [filter, setFilter] = useState<"needs" | "all" | "closed">("needs");

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    void (async () => {
      setState("loading");
      try {
        const r = await fetch("/api/portal");
        if (!r.ok) return setState("error");
        setList((await r.json()) as ListData);
        setState("ready");
      } catch {
        setState("error");
      }
    })();
  }, [isLoaded, isSignedIn, tries]);

  const openItem = async (it: Item) => {
    setOpen(it);
    setDetail(null);
    setDetailState("loading");
    try {
      const q = `kind=${it.kind}&id=${encodeURIComponent(it.id)}${it.table ? `&table=${it.table}` : ""}`;
      const r = await fetch(`/api/portal?${q}`);
      if (!r.ok) return setDetailState("error");
      setDetail({ kind: it.kind, data: await r.json() });
      setDetailState("idle");
    } catch {
      setDetailState("error");
    }
  };
  const back = () => {
    setOpen(null);
    setDetail(null);
    setTries((t) => t + 1); // refresh the list: statuses may have moved
  };
  const post = async (payload: Record<string, unknown>) => {
    try {
      const r = await fetch("/api/portal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = (await r.json()) as { ok?: boolean; view?: unknown; approved?: boolean; error?: string };
      if (!r.ok || !j.ok) return { ok: false as const, error: j.error };
      return { ok: true as const, data: j.view, approved: j.approved };
    } catch {
      return { ok: false as const, error: "That didn't go through. Check your connection and try again." };
    }
  };

  if (!isLoaded) return <div className="ans"><div className="ans-card ans-center">Loading…</div></div>;

  if (!isSignedIn) {
    return (
      <Shell foot={<>Soterra · soterra.co.nz · for the consultants and subcontractors of builders using Soterra</>}>
        <div className="ans-card ans-center">
          <Image src="/logo-mark.png" alt="Soterra" width={34} height={46} />
          <h1>Your Soterra portal</h1>
          <p>
            Everything a builder has sent you through Soterra - RFIs to answer, defects to fix, sign-offs to give,
            notices and transmittals - in one place, on every project. Sign in with the email address the builder sends to.
          </p>
          <div className="ans-actions" style={{ justifyContent: "center", marginTop: 16 }}>
            <button className="ans-btn primary" onClick={() => clerk.openSignIn({ forceRedirectUrl: "/portal" })}>Sign in</button>
            <button className="ans-btn" onClick={() => clerk.openSignUp({ forceRedirectUrl: "/portal" })}>Create an account</button>
          </div>
          <p className="ans-fine" style={{ marginTop: 16 }}>Free for consultants and subcontractors. Use the address the builder&apos;s emails arrive at - that is how your items find you.</p>
        </div>
      </Shell>
    );
  }

  const top = (
    <span className="pt-me">
      {list?.me.name ? <b>{list.me.name}</b> : null}
      <button className="pt-out" onClick={() => void clerk.signOut({ redirectUrl: "/portal" })}>Sign out</button>
    </span>
  );

  // ── one item ──
  if (open) {
    const fileHref = (path: string) => `/api/corr-file?portal=${encodeURIComponent(open.id)}&path=${encodeURIComponent(path)}`;
    return (
      <Shell company={open.company} project={open.project} top={top} foot={<>Soterra · soterra.co.nz · your portal</>}>
        <div className="ans-back-row">
          <button className="ans-btn" onClick={back}>‹ All your items</button>
        </div>
        {detailState === "loading" && <div className="ans-card ans-center">Opening…</div>}
        {detailState === "error" && (
          <div className="ans-card ans-center">
            <p>Couldn&apos;t open that. Probably a patchy connection.</p>
            <div className="ans-actions" style={{ justifyContent: "center", marginTop: 14 }}>
              <button className="ans-btn primary" onClick={() => void openItem(open)}>Try again</button>
            </div>
          </div>
        )}
        {detail?.kind === "rfi" && (
          <RfiThreadView
            thread={detail.data as RfiThread}
            defaultName={list?.me.name}
            sheetSrc={(doc, page) => `/api/portal/sheet?id=${encodeURIComponent(open.id)}&doc=${encodeURIComponent(doc)}&page=${page}`}
            fileHref={(path) => `/api/rfi-file?portal=${encodeURIComponent(open.id)}&path=${encodeURIComponent(path)}`}
            uploadFile={
              (detail.data as RfiThread).rfi.uploadPrefix
                ? async (file) => {
                    const v = detail.data as RfiThread;
                    try {
                      const res = await upload(`${v.rfi.uploadPrefix}${file.name}`, file, {
                        access: "private",
                        handleUploadUrl: "/api/portal/upload",
                        clientPayload: JSON.stringify({ rfiId: open.id }),
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
              const r = await post({ kind: "rfi", id: open.id, action: kind, body: text, authorName: name, files });
              return r.ok ? { ok: true, data: r.data as RfiThread } : r;
            }}
          />
        )}
        {detail?.kind === "fix" && (
          <FixView
            d={detail.data as FixData}
            photoSrc={`/api/portal/photo?table=${open.table ?? "item"}&id=${encodeURIComponent(open.id)}`}
            onNote={async (text) => {
              const r = await post({ kind: "fix", id: open.id, table: open.table ?? "item", action: "note", body: text });
              return r.ok ? { ok: true, data: r.data as FixData } : r;
            }}
            uploadPhoto={async (blob) => {
              const r = await fetch(`/api/portal/photo?table=${open.table ?? "item"}&id=${encodeURIComponent(open.id)}`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: blob });
              const j = (await r.json().catch(() => ({}))) as { path?: string; error?: string };
              return r.ok && j.path ? { path: j.path } : { error: j.error ?? "That photo didn't upload. Try again." };
            }}
            act={async (note, photoPath) => {
              const r = await post({ kind: "fix", id: open.id, table: open.table ?? "item", body: note, photoPath });
              return r.ok ? { ok: true, data: r.data as FixData } : r;
            }}
          />
        )}
        {detail?.kind === "signoff" && (
          <SignoffView
            d={detail.data as SignoffData}
            photoSrc={`/api/portal/photo?table=item&id=${encodeURIComponent(open.id)}&side=consultant`}
            act={async (decision, note) => {
              const r = await post({ kind: "signoff", id: open.id, decision, body: note });
              return r.ok ? { ok: true, data: r.data as SignoffData } : r;
            }}
          />
        )}
        {detail?.kind === "corr" && (
          <CorrespondenceView
            view={detail.data as CorrViewData}
            defaultName={list?.me.name}
            fileHref={fileHref}
            uploadFile={async (file) => {
              const v = detail.data as CorrViewData;
              try {
                const res = await upload(`${v.item.uploadPrefix}${file.name}`, file, {
                  access: "private",
                  handleUploadUrl: "/api/portal/upload",
                  clientPayload: JSON.stringify({ corrId: open.id }),
                  contentType: file.type || "application/octet-stream",
                });
                const f: CorrFile = { filename: file.name, path: res.pathname, bytes: file.size, contentType: file.type || "application/octet-stream" };
                return { file: f };
              } catch (e) {
                return { error: e instanceof Error ? e.message : `${file.name} didn't upload.` };
              }
            }}
            act={async (text, name, files) => {
              const r = await post({ kind: "corr", id: open.id, body: text, authorName: name, files });
              return r.ok ? { ok: true, data: r.data as CorrViewData } : r;
            }}
          />
        )}
      </Shell>
    );
  }

  // ── the list ──
  const items = list?.items ?? [];
  const shown = items.filter((it) => (filter === "needs" ? it.needsYou : filter === "closed" ? it.status === "closed" : it.status !== "closed"));
  const needsCount = items.filter((it) => it.needsYou).length;

  return (
    <Shell top={top} foot={<>Soterra · soterra.co.nz · your portal</>}>
      <div className="ans-card">
        <div className="ans-head">
          <span className="ans-no">Your items</span>
          {needsCount > 0 && <span className="ans-pill open">{needsCount} need{needsCount === 1 ? "s" : ""} you</span>}
        </div>
        <p className="ans-note" style={{ margin: "4px 0 10px" }}>
          Everything sent to {list?.me.emails.join(", ") || "you"} through Soterra, on every project.
        </p>
        <div className="pt-filters">
          {(["needs", "all", "closed"] as const).map((f) => (
            <button key={f} className={"pt-f" + (filter === f ? " act" : "")} onClick={() => setFilter(f)}>
              {f === "needs" ? "Needs you" : f === "all" ? "Open" : "Closed"}
            </button>
          ))}
        </div>
        {state === "loading" && <div className="ans-note">Loading…</div>}
        {state === "error" && (
          <div className="ans-note">
            Couldn&apos;t load your items. <button className="pt-link" onClick={() => setTries((t) => t + 1)}>Try again</button>
          </div>
        )}
        {state === "ready" && shown.length === 0 && (
          <div className="ans-note">
            {items.length === 0
              ? "Nothing has been sent to this address yet. When a builder sends you an RFI, a defect, a sign-off or a notice, it will be here."
              : filter === "needs"
                ? "Nothing needs you right now."
                : "Nothing here."}
          </div>
        )}
        {state === "ready" &&
          shown.map((it) => (
            <button key={`${it.kind}:${it.id}`} className={"pt-row" + (it.needsYou ? " needs" : "")} onClick={() => void openItem(it)}>
              <span className="pt-row-top">
                <span className={"pt-kind " + it.kind}>{KIND_LABEL[it.kind]}{it.kind === "rfi" || it.kind === "corr" ? ` · ${it.label}` : ""}</span>
                <span className={"pt-status" + (it.overdue ? " late" : it.needsYou ? " needs" : "")}>{it.overdue ? "Overdue" : STATUS_TEXT(it)}</span>
              </span>
              <span className="pt-row-title">{it.title}</span>
              <span className="pt-row-meta">
                {it.company} · {it.project}
                {it.meta ? ` · ${it.meta}` : ""}
                {it.due && it.needsYou ? ` · due ${fmtDate(it.due)}` : ""}
              </span>
            </button>
          ))}
      </div>
    </Shell>
  );
}
