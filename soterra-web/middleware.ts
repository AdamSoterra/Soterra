import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// The landing-page design mockups. These were internal drafts asking which
// direction should become the real site, and they were publicly reachable on
// soterra.co.nz — a prospect who guessed the path found a page reading "tell me
// which to make the real site" alongside earlier drafts. clerkMiddleware() on
// its own only ATTACHES auth; it does not require it, so nothing was gating
// them. Sign-in is enough of a gate here: the point is that a customer or a
// competitor cannot browse to unfinished work, not that it is a secret.
//
// Everything else stays exactly as it was, including the public landing page
// and /install, which people need to reach while signed out.
const isInternalDraft = createRouteMatcher(["/preview(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isInternalDraft(req)) await auth.protect();
});

export const config = {
  matcher: [
    // Run on everything except Next internals and static files…
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // …and always on API routes.
    "/(api|trpc)(.*)",
  ],
};
