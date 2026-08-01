const COOKIE_NAME = "glasgow_signals_auth";
const SESSION_SECONDS = 60 * 60 * 24 * 30;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function base64UrlEncode(bytes) {
  let binary = "";

  bytes.forEach(byte => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function parseCookies(header) {
  const cookies = {};

  (header || "").split(";").forEach(part => {
    const separatorIndex = part.indexOf("=");

    if (separatorIndex === -1) {
      return;
    }

    const name = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();

    if (name) {
      cookies[name] = value;
    }
  });

  return cookies;
}

async function sign(value, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));

  return base64UrlEncode(new Uint8Array(signature));
}

async function createToken(secret) {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const payload = String(expiresAt);
  const signature = await sign(payload, secret);

  return `${payload}.${signature}`;
}

async function tokenIsValid(token, secret) {
  if (!token || !secret) {
    return false;
  }

  const [expiresAtText, signature] = token.split(".");
  const expiresAt = Number(expiresAtText);

  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
    return false;
  }

  return signature === await sign(expiresAtText, secret);
}

function loginPage(returnTo = "/", errorMessage = "") {
  const safeReturnTo = returnTo.startsWith("/") ? returnTo : "/";
  const errorHtml = errorMessage
    ? `<div class="error">${escapeHtml(errorMessage)}</div>`
    : "";

  return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Glasgow Signals</title>
  <style>
    html, body {
      min-height: 100%;
      margin: 0;
      font-family: Arial, sans-serif;
      background: #f2f4f7;
      color: #111;
    }

    body {
      display: grid;
      place-items: center;
      padding: 20px;
      box-sizing: border-box;
    }

    .panel {
      width: min(390px, 100%);
      background: #fff;
      border: 1px solid #d7dbe1;
      border-radius: 6px;
      padding: 22px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
      box-sizing: border-box;
    }

    h1 {
      margin: 0 0 14px;
      font-size: 24px;
      line-height: 1.2;
    }

    label {
      display: block;
      margin-bottom: 8px;
      font-weight: bold;
    }

    input {
      width: 100%;
      box-sizing: border-box;
      padding: 11px;
      border: 1px solid #777;
      border-radius: 4px;
      font-size: 16px;
    }

    button {
      width: 100%;
      margin-top: 14px;
      padding: 11px;
      border: 1px solid #222;
      border-radius: 4px;
      background: #111;
      color: #fff;
      font-size: 16px;
      cursor: pointer;
    }

    .error {
      margin-bottom: 12px;
      padding: 10px;
      border: 1px solid #c40000;
      border-radius: 4px;
      background: #fff1f1;
      color: #9a0000;
    }
  </style>
</head>
<body>
  <form class="panel" method="post" action="/__login">
    <h1>Glasgow Signals</h1>
    ${errorHtml}
    <input type="hidden" name="returnTo" value="${escapeHtml(safeReturnTo)}" />
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" autofocus required />
    <button type="submit">Open map</button>
  </form>
</body>
</html>`, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function setupErrorPage() {
  return new Response("SITE_PASSWORD has not been configured for this Worker.", {
    status: 503,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const password = env.SITE_PASSWORD;

    if (!password) {
      return setupErrorPage();
    }

    if (url.pathname === "/__login" && request.method === "POST") {
      const formData = await request.formData();
      const submittedPassword = String(formData.get("password") || "");
      const returnTo = String(formData.get("returnTo") || "/");

      if (submittedPassword !== password) {
        return loginPage(returnTo, "Password not recognised.");
      }

      const token = await createToken(password);
      const redirectTo = returnTo.startsWith("/") ? returnTo : "/";

      return new Response(null, {
        status: 303,
        headers: {
          "Location": redirectTo,
          "Set-Cookie": `${COOKIE_NAME}=${token}; Max-Age=${SESSION_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Lax`,
          "Cache-Control": "no-store"
        }
      });
    }

    if (url.pathname === "/__logout") {
      return new Response(null, {
        status: 303,
        headers: {
          "Location": "/",
          "Set-Cookie": `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`,
          "Cache-Control": "no-store"
        }
      });
    }

    const cookies = parseCookies(request.headers.get("Cookie"));

    if (!await tokenIsValid(cookies[COOKIE_NAME], password)) {
      const returnTo = `${url.pathname}${url.search}`;

      return loginPage(returnTo);
    }

    return env.ASSETS.fetch(request);
  }
};
