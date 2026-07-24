import assert from "node:assert/strict";
import type http from "node:http";
import test from "node:test";
import {
  BROWSER_SESSION_COOKIE,
  browserSessionCookie,
  expiredBrowserSessionCookie,
  requestBrowserSessionCookie,
} from "../src/server/browser-session-cookie.js";

test("browser session cookies are HttpOnly, strict, and secure on HTTPS", () => {
  const expiresAt = Date.now() + 60_000;
  const plain = browserSessionCookie("opaque", expiresAt, false);
  const secure = browserSessionCookie("opaque", expiresAt, true);
  assert.match(plain, new RegExp(`^${BROWSER_SESSION_COOKIE}=opaque;`));
  assert.match(plain, /Path=\//);
  assert.match(plain, /HttpOnly/);
  assert.match(plain, /SameSite=Strict/);
  assert.doesNotMatch(plain, /Secure/);
  assert.match(secure, /Secure/);
  assert.match(expiredBrowserSessionCookie(true), /Max-Age=0/);
});

test("browser session cookie parsing is exact and ignores neighbors", () => {
  const request = {
    headers: {
      cookie: `other=value; ${BROWSER_SESSION_COOKIE}=opaque-token; suffix=value`,
    },
  } as http.IncomingMessage;
  assert.equal(requestBrowserSessionCookie(request), "opaque-token");
  assert.equal(
    requestBrowserSessionCookie({
      headers: { cookie: `${BROWSER_SESSION_COOKIE}_suffix=wrong` },
    } as http.IncomingMessage),
    null,
  );
});
