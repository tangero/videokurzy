/**
 * Returns true if the URL is allowed as a post-login callback.
 *
 * Allowed:
 * - `https://vibecoding.cz/...` (apex)
 * - `https://*.vibecoding.cz/...` (any subdomain)
 * - `http://localhost[:port]/...` (local development)
 *
 * Rejected:
 * - Anything else (other domains, non-http(s) schemes, malformed URLs).
 *
 * Prevents open-redirect attacks in the login flow where the callback URL
 * is passed from the consumer Worker.
 */
export function isAllowedCallback(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === "http:" && url.hostname === "localhost") return true;
  if (url.protocol !== "https:") return false;
  return url.hostname === "vibecoding.cz" || url.hostname.endsWith(".vibecoding.cz");
}
