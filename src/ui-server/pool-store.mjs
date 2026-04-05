import fs from "node:fs/promises";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");

const POOL_DEFINITIONS = [
  {
    id: "codex-accounts",
    label: "Codex 账号池",
    category: "accounts",
    provider: "codex",
    filePath: path.join(REPO_ROOT, "acc_pool", "pool.json"),
  },
  {
    id: "codex-api",
    label: "Codex API 池",
    category: "api",
    provider: "codex",
    filePath: path.join(REPO_ROOT, "api_pool", "codex", "pool.json"),
  },
  {
    id: "claude-code-api",
    label: "Claude Code API 池",
    category: "api",
    provider: "claude-code",
    filePath: path.join(REPO_ROOT, "api_pool", "claude-code", "pool.json"),
  },
];

function nowStamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function normalizeBoolean(value) {
  return value === true || value === "true";
}

function normalizeText(value) {
  return value == null ? "" : String(value);
}

function isValidDate(value) {
  if (!value) return true;
  const stamp = new Date(value).getTime();
  return !Number.isNaN(stamp);
}

function validationError(pathName, message) {
  return { path: pathName, message };
}

function normalizeCodexAccountItem(item) {
  const tokenSource = item?.tokens && typeof item.tokens === "object" ? item.tokens : item || {};
  return {
    OPENAI_API_KEY: normalizeText(item?.OPENAI_API_KEY),
    auth_mode: normalizeText(item?.auth_mode) || "chatgpt",
    type: normalizeText(item?.type) || "codex",
    disabled: normalizeBoolean(item?.disabled),
    email: normalizeText(item?.email),
    name: normalizeText(item?.name),
    last_refresh: normalizeText(item?.last_refresh),
    expired: normalizeText(item?.expired),
    tokens: {
      access_token: normalizeText(tokenSource.access_token),
      account_id: normalizeText(tokenSource.account_id),
      id_token: normalizeText(tokenSource.id_token),
      refresh_token: normalizeText(tokenSource.refresh_token),
    },
  };
}

function validateCodexAccountItem(item, index) {
  const errors = [];
  if ((normalizeText(item.type) || "codex") !== "codex") {
    errors.push(validationError(`${index}.type`, "账号池条目的 type 必须是 codex"));
  }
  if (item.last_refresh && !isValidDate(item.last_refresh)) {
    errors.push(validationError(`${index}.last_refresh`, "last_refresh 不是合法时间"));
  }
  if (item.expired && !isValidDate(item.expired)) {
    errors.push(validationError(`${index}.expired`, "expired 不是合法时间"));
  }
  if (!item.tokens.access_token) {
    errors.push(validationError(`${index}.tokens.access_token`, "缺少 access_token"));
  }
  if (!item.tokens.account_id) {
    errors.push(validationError(`${index}.tokens.account_id`, "缺少 account_id"));
  }
  if (!item.tokens.id_token) {
    errors.push(validationError(`${index}.tokens.id_token`, "缺少 id_token"));
  }
  if (!item.tokens.refresh_token) {
    errors.push(validationError(`${index}.tokens.refresh_token`, "缺少 refresh_token"));
  }
  return errors;
}

function normalizeApiItem(item, provider) {
  return {
    name: normalizeText(item?.name),
    type: normalizeText(item?.type) || provider,
    baseUrl: normalizeText(item?.baseUrl),
    apiKey: normalizeText(item?.apiKey),
    model: normalizeText(item?.model),
    probePath: normalizeText(item?.probePath),
    disabled: normalizeBoolean(item?.disabled),
  };
}

function validateApiItem(item, provider, index) {
  const errors = [];
  if (item.type !== provider) {
    errors.push(validationError(`${index}.type`, `API 池条目的 type 必须是 ${provider}`));
  }
  if (!item.name) {
    errors.push(validationError(`${index}.name`, "缺少 name"));
  }
  if (!item.baseUrl) {
    errors.push(validationError(`${index}.baseUrl`, "缺少 baseUrl"));
  } else {
    try {
      new URL(item.baseUrl);
    } catch {
      errors.push(validationError(`${index}.baseUrl`, "baseUrl 不是合法 URL"));
    }
  }
  if (!item.apiKey) {
    errors.push(validationError(`${index}.apiKey`, "缺少 apiKey"));
  }
  return errors;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export class PoolStore {
  constructor(definitions = POOL_DEFINITIONS) {
    this.definitions = definitions;
  }

  listPools() {
    return this.definitions.map((item) => ({
      id: item.id,
      label: item.label,
      category: item.category,
      provider: item.provider,
      filePath: item.filePath,
    }));
  }

  getDefinition(poolId) {
    const definition = this.definitions.find((item) => item.id === poolId) || null;
    if (!definition) {
      const error = new Error(`Unknown pool: ${poolId}`);
      error.statusCode = 404;
      throw error;
    }
    return definition;
  }

  async loadPool(poolId) {
    const definition = this.getDefinition(poolId);
    let items = [];
    let savedAt = null;

    if (await fileExists(definition.filePath)) {
      const raw = JSON.parse(await fs.readFile(definition.filePath, "utf8"));
      items = Array.isArray(raw) ? raw : [];
      const stat = await fs.stat(definition.filePath);
      savedAt = stat.mtime.toISOString();
    }

    return {
      pool: {
        id: definition.id,
        label: definition.label,
        category: definition.category,
        provider: definition.provider,
        filePath: definition.filePath,
      },
      items,
      savedAt,
    };
  }

  validatePoolItems(poolId, items) {
    const definition = this.getDefinition(poolId);
    if (!Array.isArray(items)) {
      return {
        ok: false,
        errors: [validationError("items", "items 必须是数组")],
        normalizedItems: [],
      };
    }

    const normalizedItems = [];
    const errors = [];
    for (const [index, rawItem] of items.entries()) {
      if (!rawItem || typeof rawItem !== "object") {
        errors.push(validationError(String(index), "条目必须是对象"));
        continue;
      }
      if (definition.category === "accounts") {
        const normalized = normalizeCodexAccountItem(rawItem);
        normalizedItems.push(normalized);
        errors.push(...validateCodexAccountItem(normalized, index));
        continue;
      }
      const normalized = normalizeApiItem(rawItem, definition.provider);
      normalizedItems.push(normalized);
      errors.push(...validateApiItem(normalized, definition.provider, index));
    }

    return {
      ok: errors.length === 0,
      errors,
      normalizedItems,
    };
  }

  async savePool(poolId, items) {
    const definition = this.getDefinition(poolId);
    const validation = this.validatePoolItems(poolId, items);
    if (!validation.ok) {
      const error = new Error("Pool validation failed");
      error.statusCode = 400;
      error.details = validation.errors;
      throw error;
    }

    await fs.mkdir(path.dirname(definition.filePath), { recursive: true });
    if (await fileExists(definition.filePath)) {
      const backupDir = path.join(path.dirname(definition.filePath), "_backup");
      await fs.mkdir(backupDir, { recursive: true });
      const backupPath = path.join(backupDir, `pool-${nowStamp()}.json`);
      await fs.copyFile(definition.filePath, backupPath);
    }

    await fs.writeFile(
      definition.filePath,
      `${JSON.stringify(validation.normalizedItems, null, 2)}\n`,
      "utf8",
    );
    const stat = await fs.stat(definition.filePath);
    return {
      pool: {
        id: definition.id,
        label: definition.label,
        category: definition.category,
        provider: definition.provider,
        filePath: definition.filePath,
      },
      items: validation.normalizedItems,
      savedAt: stat.mtime.toISOString(),
      count: validation.normalizedItems.length,
    };
  }
}
