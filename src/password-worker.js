const COOKIE_NAME = "glasgow_signals_auth";
const SESSION_SECONDS = 60 * 60 * 24 * 30;

function normalisePassword(value) {
  return String(value || "").normalize("NFKC").trim();
}

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
  <title>Glasgow Signals Map</title>
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

    .summary {
      margin: -4px 0 14px;
      color: #4b5563;
      line-height: 1.4;
    }

    .notice {
      display: grid;
      gap: 10px;
      margin: 0 0 22px;
      color: #374151;
      font-size: 14px;
      line-height: 1.45;
    }

    .notice p {
      margin: 0;
    }

    label {
      display: block;
      margin-bottom: 8px;
      font-weight: bold;
    }

    .show-password {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 10px;
      font-weight: normal;
    }

    input {
      width: 100%;
      box-sizing: border-box;
      padding: 11px;
      border: 1px solid #777;
      border-radius: 4px;
      font-size: 16px;
    }

    .show-password input {
      width: auto;
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
    <h1>Glasgow Signals Map</h1>
    <p class="summary">Glasgow Signals Map is a reference map for authorised railway staff showing railway signalling asset locations for Glasgow DU.</p>
    <div class="notice">
      <p>Data has been obtained using M12s, AIVR footage, GeoRIMN, and the Hazard Directory.</p>
      <p>The information shown in the map is for guidance only and must not be used for safety-critical decisions.</p>
      <p>Current open faults may not be shown due to the constraints of the MyIM system.</p>
      <p>Access is password protected and intended only for users who have been given permission to use it.</p>
    </div>
    ${errorHtml}
    <input type="hidden" name="returnTo" value="${escapeHtml(safeReturnTo)}" />
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" autofocus required />
    <label class="show-password">
      <input id="showPassword" type="checkbox" />
      Show password
    </label>
    <button type="submit">Open map</button>
  </form>
  <script>
    const showPassword = document.getElementById("showPassword");
    const password = document.getElementById("password");

    showPassword.addEventListener("change", () => {
      password.type = showPassword.checked ? "text" : "password";
    });
  </script>
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

    if (url.protocol !== "https:") {
      url.protocol = "https:";

      return new Response(null, {
        status: 301,
        headers: {
          "Location": url.toString(),
          "Cache-Control": "no-store"
        }
      });
    }

    if (url.hostname === "www.glasgowsignals.co.uk") {
      url.hostname = "glasgowsignals.co.uk";

      return new Response(null, {
        status: 301,
        headers: {
          "Location": url.toString(),
          "Cache-Control": "no-store"
        }
      });
    }

    const configuredPassword = normalisePassword(password);

    if (!configuredPassword) {
      return setupErrorPage();
    }

    if (url.pathname === "/__login" && request.method === "POST") {
      const formData = await request.formData();
      const submittedPassword = normalisePassword(formData.get("password"));
      const returnTo = String(formData.get("returnTo") || "/");

      if (submittedPassword !== configuredPassword) {
        return loginPage(returnTo, "Password not recognised.");
      }

      const token = await createToken(configuredPassword);
      const redirectTo = returnTo.startsWith("/") ? returnTo : "/";
      const redirectUrl = new URL(redirectTo, url.origin);

      redirectUrl.searchParams.set("__login", "ok");

      return new Response(null, {
        status: 303,
        headers: {
          "Location": `${redirectUrl.pathname}${redirectUrl.search}${redirectUrl.hash}`,
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

    if (!await tokenIsValid(cookies[COOKIE_NAME], configuredPassword)) {
      const returnTo = `${url.pathname}${url.search}`;
      const errorMessage = url.searchParams.get("__login") === "ok"
        ? "Password was accepted, but this browser did not save the sign-in cookie. Please allow cookies for this site and try again."
        : "";

      return loginPage(returnTo, errorMessage);
    }

    if (url.searchParams.get("__login") === "ok") {
      url.searchParams.delete("__login");

      return new Response(null, {
        status: 303,
        headers: {
          "Location": `${url.pathname}${url.search}${url.hash}`,
          "Cache-Control": "no-store"
        }
      });
    }

    return env.ASSETS.fetch(request);
  }
};
