/** Where external links point. One env override for previews. */
export const APP_URL = (process.env.APP_BASE_URL ?? "https://soterra.co.nz").replace(/\/+$/, "");
/** The consultant / subcontractor portal: everything sent to a signed-in email. */
export const PORTAL_URL = `${APP_URL}/portal`;
