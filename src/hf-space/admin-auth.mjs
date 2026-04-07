import crypto from "node:crypto";

const SESSION_COOKIE = "hf_admin_session";
const STATE_COOKIE = "hf_admin_state";
const OIDC_CACHE = new Map();

function sign(value, secret) {
  return crypto.createHmac("sha256", String(secret || "")).update(value).digest("base64url");
}

function encodePayload(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload(value) {
  return JSON.parse(Buffer.from(String(value || ""), "base64url").toString("utf8"));
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${value}`];
  parts.push(`Path=${options.path || "/"}`);
  if (options.httpOnly !== false) parts.push("HttpOnly");
  if (options.secure !== false) parts.push("Secure");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.maxAge != null) parts.push(`Max-Age=${options.maxAge}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  return parts.join("; ");
}

function parseCookies(req) {
  const raw = String(req.headers.cookie || "");
  const cookies = {};
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    cookies[trimmed.slice(0, idx)] = decodeURIComponent(trimmed.slice(idx + 1));
  }
  return cookies;
}

function resolveBaseUrl(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const forwardedHost = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
  const proto = forwardedProto || "https";
  const host = forwardedHost || String(req.headers.host || "");
  return `${proto}://${host}`;
}

function allowedUsersFromEnv(env) {
  return new Set(
    String(env.ADMIN_HF_USERNAMES || "")
      .split(/[,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function decodeJwtPayload(token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length < 2) return null;
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function createSignedToken(payload, secret) {
  const encoded = encodePayload(payload);
  return `${encoded}.${sign(encoded, secret)}`;
}

export function verifySignedToken(token, secret) {
  const [encoded, signature] = String(token || "").split(".");
  if (!encoded || !signature) return null;
  const expected = sign(encoded, secret);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    return null;
  }
  const payload = decodePayload(encoded);
  if (payload?.exp && Number(payload.exp) < Date.now()) {
    return null;
  }
  return payload;
}

export function createAdminSessionCookie(user, secret) {
  const token = createSignedToken(
    {
      username: user.username,
      displayName: user.displayName || user.username,
      exp: Date.now() + 8 * 60 * 60 * 1000,
    },
    secret,
  );
  return serializeCookie(SESSION_COOKIE, token, {
    sameSite: "Lax",
    maxAge: 8 * 60 * 60,
  });
}

export function clearAdminSessionCookie() {
  return serializeCookie(SESSION_COOKIE, "", {
    sameSite: "Lax",
    maxAge: 0,
    expires: new Date(0),
  });
}

export function getAdminSession(req, secret) {
  const cookies = parseCookies(req);
  const payload = verifySignedToken(cookies[SESSION_COOKIE], secret);
  if (!payload?.username) return null;
  return {
    username: payload.username,
    displayName: payload.displayName || payload.username,
  };
}

export function isAdminUser(session, env) {
  if (!session?.username) return false;
  const allowed = allowedUsersFromEnv(env);
  return allowed.size === 0 ? false : allowed.has(session.username);
}

async function getOidcConfiguration(providerUrl) {
  if (OIDC_CACHE.has(providerUrl)) {
    return OIDC_CACHE.get(providerUrl);
  }
  const response = await fetch(`${providerUrl.replace(/\/+$/, "")}/.well-known/openid-configuration`);
  if (!response.ok) {
    throw new Error(`Failed to load OpenID configuration: ${response.status}`);
  }
  const config = await response.json();
  OIDC_CACHE.set(providerUrl, config);
  return config;
}

export async function beginAdminOAuth(req, res, env = process.env) {
  const providerUrl = env.OPENID_PROVIDER_URL;
  const clientId = env.OAUTH_CLIENT_ID;
  const clientSecret = env.OAUTH_CLIENT_SECRET;
  const sessionSecret = env.ADMIN_SESSION_SECRET;

  if (!providerUrl || !clientId || !clientSecret) {
    res.statusCode = 404;
    res.end("OAuth disabled");
    return;
  }
  if (!sessionSecret) {
    throw new Error("ADMIN_SESSION_SECRET is required.");
  }

  const config = await getOidcConfiguration(providerUrl);
  const stateToken = createSignedToken(
    {
      nonce: crypto.randomUUID(),
      exp: Date.now() + 10 * 60 * 1000,
    },
    sessionSecret,
  );
  const redirectUri = `${resolveBaseUrl(req)}/login/callback`;
  const authUrl = new URL(config.authorization_endpoint);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", env.OAUTH_SCOPES || env.HF_OAUTH_SCOPES || "openid profile");
  authUrl.searchParams.set("state", stateToken);

  res.statusCode = 302;
  res.setHeader("set-cookie", serializeCookie(STATE_COOKIE, stateToken, {
    sameSite: "Lax",
    maxAge: 10 * 60,
  }));
  res.setHeader("location", authUrl.toString());
  res.end();
}

export async function finishAdminOAuth(req, res, env = process.env) {
  const providerUrl = env.OPENID_PROVIDER_URL;
  const clientId = env.OAUTH_CLIENT_ID;
  const clientSecret = env.OAUTH_CLIENT_SECRET;
  const sessionSecret = env.ADMIN_SESSION_SECRET;
  const config = await getOidcConfiguration(providerUrl);
  const url = new URL(req.url || "/", resolveBaseUrl(req));
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const cookies = parseCookies(req);
  const storedState = cookies[STATE_COOKIE] || "";
  if (!code || state !== storedState || !verifySignedToken(state, sessionSecret)) {
    res.statusCode = 401;
    res.end("Invalid OAuth state.");
    return;
  }

  const redirectUri = `${resolveBaseUrl(req)}/login/callback`;
  const tokenResponse = await fetch(config.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }).toString(),
  });
  if (!tokenResponse.ok) {
    res.statusCode = 502;
    res.end("OAuth token exchange failed.");
    return;
  }

  const tokenPayload = await tokenResponse.json();
  let profile = null;
  if (config.userinfo_endpoint && tokenPayload.access_token) {
    const userinfoResponse = await fetch(config.userinfo_endpoint, {
      headers: {
        authorization: `Bearer ${tokenPayload.access_token}`,
      },
    });
    if (userinfoResponse.ok) {
      profile = await userinfoResponse.json();
    }
  }
  if (!profile && tokenPayload.id_token) {
    profile = decodeJwtPayload(tokenPayload.id_token);
  }

  const username =
    profile?.preferred_username || profile?.nickname || profile?.name || profile?.sub || "";
  const session = { username, displayName: profile?.name || username };
  if (!isAdminUser(session, env)) {
    res.statusCode = 403;
    res.end("Forbidden");
    return;
  }

  res.statusCode = 302;
  res.setHeader("set-cookie", [
    createAdminSessionCookie(session, sessionSecret),
    serializeCookie(STATE_COOKIE, "", {
      sameSite: "Lax",
      maxAge: 0,
      expires: new Date(0),
    }),
  ]);
  res.setHeader("location", "/admin");
  res.end();
}
