import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_REFRESH_ENDPOINT = "https://auth.openai.com/oauth/token";
const DEFAULT_PROBE_URL = "https://api.openai.com/v1/models";
const DEFAULT_REFRESH_LEEWAY_SECONDS = 300;

const COOLDOWN_SECONDS = {
  auth: 1800,
  quota: 900,
  rate_limit: 120,
  server: 45,
  network: 30,
  invalid: 300,
};

function nowMs(nowFn = Date.now) {
  return Number(nowFn());
}

export function decodeJwtPayload(token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length < 2) return null;
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function parseDateMs(value) {
  const date = new Date(value);
  const stamp = date.getTime();
  return Number.isNaN(stamp) ? null : stamp;
}

function isoFromMs(ms) {
  return new Date(ms).toISOString();
}

function containsAny(text, needles) {
  const lower = String(text || "").toLowerCase();
  return needles.some((needle) => lower.includes(needle));
}

export function classifyFailure({ status = 0, detail = "" }) {
  if (status === 401 || status === 403) {
    return { category: "auth", reason: `http-${status}` };
  }
  if (status === 429) {
    return { category: "rate_limit", reason: "http-429" };
  }
  if (status >= 500) {
    return { category: "server", reason: `http-${status}` };
  }
  if (
    containsAny(detail, [
      "insufficient_quota",
      "quota",
      "subscription_not_found",
      "billing",
      "insufficient balance",
      "credit",
      "额度",
      "余额",
      "订阅",
    ])
  ) {
    return { category: "quota", reason: "quota-related" };
  }
  if (status === 0) {
    return { category: "network", reason: "network" };
  }
  return { category: "invalid", reason: status ? `http-${status}` : "unknown" };
}

function makeAccount(raw, filePath, now) {
  const isAuthJsonShape = raw && typeof raw === "object" && raw.tokens && typeof raw.tokens === "object";
  const tokenSource = isAuthJsonShape ? raw.tokens : raw;
  const normalizedType = raw.type || (isAuthJsonShape ? "codex" : "");
  const payload = decodeJwtPayload(tokenSource.access_token);
  const accessTokenExpMs =
    typeof payload?.exp === "number" ? Number(payload.exp) * 1000 : null;
  const expiredFieldMs = parseDateMs(raw.expired);
  const expiresAtMs = accessTokenExpMs || expiredFieldMs;

  return {
    id: path.basename(filePath),
    filePath,
    raw,
    type: normalizedType,
    email: raw.email || "",
    accountId: tokenSource.account_id || "",
    accessToken: tokenSource.access_token || "",
    idToken: tokenSource.id_token || "",
    refreshToken: tokenSource.refresh_token || "",
    clientId: payload?.client_id || "",
    accessTokenExpMs: expiresAtMs,
    disabled: Boolean(raw.disabled),
    lastRefresh: raw.last_refresh || null,
    lastValidation: null,
    lastFailureReason: "",
    consecutiveFailures: 0,
    cooldownUntilMs: 0,
    healthy: false,
    loadedAtMs: now,
  };
}

export function isAccountStructurallyEligible(account) {
  if (!account) return false;
  if (account.type !== "codex") return false;
  if (account.disabled) return false;
  if (!account.accountId || !account.accessToken || !account.idToken) return false;
  if (!account.refreshToken) return false;
  return true;
}

export class CodexAccountPool {
  constructor({
    tokensDir,
    refreshEndpoint = DEFAULT_REFRESH_ENDPOINT,
    probeUrl = DEFAULT_PROBE_URL,
    refreshLeewaySeconds = DEFAULT_REFRESH_LEEWAY_SECONDS,
    fetchFn = fetch,
    nowFn = Date.now,
    logger = () => {},
  }) {
    this.tokensDir = tokensDir;
    this.refreshEndpoint = refreshEndpoint;
    this.probeUrl = probeUrl;
    this.refreshLeewaySeconds = refreshLeewaySeconds;
    this.fetchFn = fetchFn;
    this.nowFn = nowFn;
    this.logger = logger;
    this.accounts = [];
    this.activeAccountId = null;
  }

  listAccounts() {
    return [...this.accounts];
  }

  getActiveAccount() {
    if (!this.activeAccountId) return null;
    return this.accounts.find((account) => account.id === this.activeAccountId) || null;
  }

  async load() {
    const now = nowMs(this.nowFn);
    const dirEntries = await fs.readdir(this.tokensDir, { withFileTypes: true });
    const files = dirEntries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(this.tokensDir, entry.name))
      .sort((left, right) => left.localeCompare(right));

    const loaded = [];
    for (const filePath of files) {
      let raw;
      try {
        raw = JSON.parse(await fs.readFile(filePath, "utf8"));
      } catch {
        continue;
      }
      const account = makeAccount(raw, filePath, now);
      if (!isAccountStructurallyEligible(account)) {
        this.logger("load:skip", {
          file: path.basename(filePath),
          reason: "structurally-ineligible",
        });
        continue;
      }
      this.logger("load:account", {
        file: path.basename(filePath),
        accountId: account.accountId,
        hasRefreshToken: Boolean(account.refreshToken),
      });
      loaded.push(account);
    }

    this.accounts = loaded;
    if (!this.activeAccountId && this.accounts.length > 0) {
      this.activeAccountId = this.accounts[0].id;
    }
    if (
      this.activeAccountId &&
      !this.accounts.find((account) => account.id === this.activeAccountId)
    ) {
      this.activeAccountId = this.accounts[0]?.id || null;
    }
  }

  needsRefresh(account) {
    const now = nowMs(this.nowFn);
    if (!account.accessTokenExpMs) return false;
    return account.accessTokenExpMs - now <= this.refreshLeewaySeconds * 1000;
  }

  isCoolingDown(account) {
    return account.cooldownUntilMs > nowMs(this.nowFn);
  }

  pickNextHealthyAccount(excluded = new Set()) {
    const ordered = this.accounts;
    const activeId = this.activeAccountId;
    const startIdx = activeId
      ? Math.max(ordered.findIndex((account) => account.id === activeId), 0)
      : 0;
    const rotated = ordered
      .slice(startIdx + 1)
      .concat(ordered.slice(0, startIdx + 1));

    return (
      rotated.find((account) => !excluded.has(account.id) && !this.isCoolingDown(account)) ||
      null
    );
  }

  markSuccess(account) {
    account.healthy = true;
    account.consecutiveFailures = 0;
    account.lastFailureReason = "";
    account.cooldownUntilMs = 0;
    account.lastValidation = isoFromMs(nowMs(this.nowFn));
    this.activeAccountId = account.id;
  }

  markFailure(account, category, reason) {
    account.healthy = false;
    account.consecutiveFailures += 1;
    account.lastFailureReason = `${category}:${reason}`;
    const cooldownSeconds = COOLDOWN_SECONDS[category] || COOLDOWN_SECONDS.invalid;
    account.cooldownUntilMs = nowMs(this.nowFn) + cooldownSeconds * 1000;
  }

  async persistAccount(account) {
    const nextExpired = account.accessTokenExpMs
      ? isoFromMs(account.accessTokenExpMs)
      : account.raw.expired;
    const nextLastRefresh = account.lastRefresh || new Date().toISOString();

    const nextRaw =
      account.raw && typeof account.raw === "object" && account.raw.tokens
        ? {
            ...account.raw,
            OPENAI_API_KEY: account.raw.OPENAI_API_KEY || "",
            auth_mode: account.raw.auth_mode || "chatgpt",
            last_refresh: nextLastRefresh,
            expired: nextExpired,
            type: account.raw.type || "codex",
            tokens: {
              ...(account.raw.tokens || {}),
              access_token: account.accessToken,
              id_token: account.idToken,
              refresh_token: account.refreshToken,
              account_id: account.accountId,
            },
          }
        : {
            ...account.raw,
            type: account.raw.type || "codex",
            access_token: account.accessToken,
            id_token: account.idToken,
            refresh_token: account.refreshToken,
            account_id: account.accountId,
            last_refresh: nextLastRefresh,
            expired: nextExpired,
          };
    account.raw = nextRaw;
    await fs.writeFile(account.filePath, `${JSON.stringify(nextRaw, null, 2)}\n`, "utf8");
  }

  async refreshAccount(account) {
    this.logger("refresh:start", {
      id: account.id,
      accountId: account.accountId,
    });
    const clientId =
      account.clientId || decodeJwtPayload(account.accessToken)?.client_id || "";
    if (!clientId) {
      this.logger("refresh:fail", {
        id: account.id,
        accountId: account.accountId,
        reason: "missing-client-id",
      });
      throw new Error("missing-client-id");
    }

    const payload = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: account.refreshToken,
      client_id: clientId,
    });

    const response = await this.fetchFn(this.refreshEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: payload.toString(),
    });

    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }

    if (!response.ok) {
      const detail = json?.error_description || json?.error || text || `http-${response.status}`;
      const classified = classifyFailure({ status: response.status, detail });
      this.markFailure(account, classified.category, detail);
      this.logger("refresh:fail", {
        id: account.id,
        accountId: account.accountId,
        status: response.status,
        category: classified.category,
        detail,
      });
      throw new Error(`refresh-failed:${classified.category}:${detail}`);
    }

    const accessToken = json?.access_token;
    if (!accessToken) {
      this.markFailure(account, "invalid", "refresh-no-access-token");
      throw new Error("refresh-no-access-token");
    }

    account.accessToken = accessToken;
    account.refreshToken = json?.refresh_token || account.refreshToken;
    account.idToken = json?.id_token || account.idToken;
    account.clientId = json?.client_id || clientId;
    account.lastRefresh = new Date().toISOString();

    const jwt = decodeJwtPayload(accessToken);
    if (typeof jwt?.exp === "number") {
      account.accessTokenExpMs = Number(jwt.exp) * 1000;
    } else if (typeof json?.expires_in === "number") {
      account.accessTokenExpMs = nowMs(this.nowFn) + Number(json.expires_in) * 1000;
    }

    await this.persistAccount(account);
    this.logger("refresh:ok", {
      id: account.id,
      accountId: account.accountId,
      expiresAt: account.accessTokenExpMs ? isoFromMs(account.accessTokenExpMs) : null,
    });
  }

  async probeAccount(account) {
    this.logger("probe:start", {
      id: account.id,
      accountId: account.accountId,
    });
    let response;
    try {
      response = await this.fetchFn(this.probeUrl, {
        method: "GET",
        headers: { authorization: `Bearer ${account.accessToken}` },
      });
    } catch (error) {
      const detail = error?.message || String(error);
      this.markFailure(account, "network", detail);
      this.logger("probe:fail", {
        id: account.id,
        accountId: account.accountId,
        category: "network",
        detail,
      });
      return {
        ok: false,
        status: 0,
        category: "network",
        reason: "network",
        detail,
      };
    }

    if (response.ok) {
      this.markSuccess(account);
      this.logger("probe:ok", {
        id: account.id,
        accountId: account.accountId,
        status: response.status,
      });
      return { ok: true, status: response.status, category: "ok", reason: "probe-ok" };
    }

    const detail = await response.text();
    const classified = classifyFailure({ status: response.status, detail });
    this.markFailure(account, classified.category, detail || `http-${response.status}`);
    this.logger("probe:fail", {
      id: account.id,
      accountId: account.accountId,
      status: response.status,
      category: classified.category,
      detail,
    });
    return {
      ok: false,
      status: response.status,
      category: classified.category,
      reason: classified.reason,
      detail,
    };
  }

  async ensureAccountHealthy(account) {
    this.logger("account:check", {
      id: account.id,
      accountId: account.accountId,
      needsRefresh: this.needsRefresh(account),
    });
    if (this.needsRefresh(account)) {
      await this.refreshAccount(account);
    }
    return this.probeAccount(account);
  }

  async getInitialAccount() {
    if (this.accounts.length === 0) return null;

    const excluded = new Set();
    for (let i = 0; i < this.accounts.length; i += 1) {
      const candidate =
        i === 0 && this.getActiveAccount() && !excluded.has(this.getActiveAccount().id)
          ? this.getActiveAccount()
          : this.pickNextHealthyAccount(excluded);
      if (!candidate) break;

      excluded.add(candidate.id);
      if (this.isCoolingDown(candidate)) continue;

      try {
        const probe = await this.ensureAccountHealthy(candidate);
        if (probe.ok) {
          this.activeAccountId = candidate.id;
          return candidate;
        }
      } catch {
        continue;
      }
    }

    return null;
  }
}
