import Landing from "../../landing";

// Standalone preview of the chosen "Command Centre" landing. No Clerk handlers →
// the Log in / Get set up buttons link to "/". The live front page (app/page.tsx)
// renders the same <Landing/> with Clerk handlers wired.
export default function PreviewCommand() {
  return <Landing />;
}
