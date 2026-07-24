import type http from "node:http";

export const BROWSER_SESSION_COOKIE = "wmux_session";

export const browserSessionCookie = (
  token: string,
  expiresAt: number,
  secure: boolean,
): string => [
  `${BROWSER_SESSION_COOKIE}=${token}`,
  "Path=/",
  "HttpOnly",
  "SameSite=Strict",
  ...(secure ? ["Secure"] : []),
  `Expires=${new Date(expiresAt).toUTCString()}`,
  `Max-Age=${Math.max(0, Math.floor((expiresAt - Date.now()) / 1_000))}`,
].join("; ");

export const expiredBrowserSessionCookie = (secure: boolean): string => [
  `${BROWSER_SESSION_COOKIE}=`,
  "Path=/",
  "HttpOnly",
  "SameSite=Strict",
  ...(secure ? ["Secure"] : []),
  "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  "Max-Age=0",
].join("; ");

export const requestBrowserSessionCookie = (
  request: http.IncomingMessage,
): string | null => {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const segment of header.split(";")) {
    const separator = segment.indexOf("=");
    if (separator < 0) continue;
    const name = segment.slice(0, separator).trim();
    if (name !== BROWSER_SESSION_COOKIE) continue;
    const value = segment.slice(separator + 1).trim();
    return value || null;
  }
  return null;
};
