import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { decryptJson, encryptJson } from "../shared/pool-crypto.mjs";
import { maskSecret } from "../shared/secret-sanitizer.mjs";
import { PoolStore } from "../ui-server/pool-store.mjs";

function makeDefinitions(dataDir) {
  return [
    {
      id: "codex-accounts",
      label: "Codex 账号池",
      category: "accounts",
      provider: "codex",
      filePath: path.join(dataDir, "pools", "codex-accounts.enc"),
    },
    {
      id: "codex-api",
      label: "Codex API 池",
      category: "api",
      provider: "codex",
      filePath: path.join(dataDir, "pools", "codex-api.enc"),
    },
    {
      id: "claude-code-api",
      label: "Claude Code API 池",
      category: "api",
      provider: "claude-code",
      filePath: path.join(dataDir, "pools", "claude-code-api.enc"),
    },
  ];
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function maskCodexAccount(item) {
  const tokenSource = item?.tokens && typeof item.tokens === "object" ? item.tokens : {};
  return {
    ...item,
    OPENAI_API_KEY: "",
    OPENAI_API_KEY_MASKED: item?.OPENAI_API_KEY ? maskSecret(item.OPENAI_API_KEY) : "",
    tokens: {
      ...tokenSource,
      access_token: "",
      id_token: "",
      refresh_token: "",
      access_token_masked: tokenSource.access_token ? maskSecret(tokenSource.access_token) : "",
      id_token_masked: tokenSource.id_token ? maskSecret(tokenSource.id_token) : "",
      refresh_token_masked: tokenSource.refresh_token ? maskSecret(tokenSource.refresh_token) : "",
    },
  };
}

function maskApiItem(item) {
  return {
    ...item,
    apiKey: "",
    apiKeyMasked: item?.apiKey ? maskSecret(item.apiKey) : "",
  };
}

function mergeAccountSecrets(item, previous = {}) {
  const nextTokens = item?.tokens && typeof item.tokens === "object" ? item.tokens : {};
  const prevTokens = previous?.tokens && typeof previous.tokens === "object" ? previous.tokens : {};
  return {
    ...item,
    OPENAI_API_KEY: item?.OPENAI_API_KEY || previous?.OPENAI_API_KEY || "",
    tokens: {
      ...nextTokens,
      access_token: nextTokens.access_token || prevTokens.access_token || "",
      id_token: nextTokens.id_token || prevTokens.id_token || "",
      refresh_token: nextTokens.refresh_token || prevTokens.refresh_token || "",
    },
  };
}

function mergeApiSecrets(item, previous = {}) {
  return {
    ...item,
    apiKey: item?.apiKey || previous?.apiKey || "",
  };
}

export class EncryptedPoolStore {
  constructor({ dataDir, cryptoKey }) {
    this.dataDir = dataDir;
    this.cryptoKey = cryptoKey;
    this.definitions = makeDefinitions(dataDir);
    this.validator = new PoolStore(this.definitions);
    this.readOnly = false;
    this.readOnlyReason = "";
    this.storageBackend = path.resolve(dataDir) === "/data" ? "bucket-mounted-fs" : "local-fs";
  }

  async init() {
    if (!this.cryptoKey) {
      throw new Error("POOL_CRYPTO_KEY is required.");
    }

    if (path.resolve(this.dataDir) === "/data") {
      try {
        const stat = await fs.stat(this.dataDir);
        if (!stat.isDirectory()) {
          this.readOnly = true;
          this.readOnlyReason = "DATA_DIR is not a directory.";
          return;
        }
        await fs.access(this.dataDir, fsConstants.R_OK | fsConstants.W_OK);
      } catch {
        this.readOnly = true;
        this.readOnlyReason = "Storage bucket is not mounted at /data.";
        return;
      }
    } else {
      await fs.mkdir(this.dataDir, { recursive: true });
    }

    await fs.mkdir(path.join(this.dataDir, "pools"), { recursive: true });
    await fs.mkdir(path.join(this.dataDir, "config"), { recursive: true });
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

  async loadRawPoolItems(poolId) {
    const definition = this.getDefinition(poolId);
    if (!(await fileExists(definition.filePath))) {
      return [];
    }
    const encrypted = await fs.readFile(definition.filePath, "utf8");
    const items = decryptJson(encrypted, this.cryptoKey);
    return Array.isArray(items) ? items : [];
  }

  maskItems(poolId, items) {
    if (poolId === "codex-accounts") {
      return items.map(maskCodexAccount);
    }
    return items.map(maskApiItem);
  }

  async loadPool(poolId) {
    const definition = this.getDefinition(poolId);
    const items = await this.loadRawPoolItems(poolId);
    let savedAt = null;
    if (await fileExists(definition.filePath)) {
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
      items: this.maskItems(poolId, items),
      savedAt,
      readOnly: this.readOnly,
      readOnlyReason: this.readOnlyReason,
      storageBackend: this.storageBackend,
    };
  }

  async mergeSecrets(poolId, items) {
    const previousItems = await this.loadRawPoolItems(poolId);
    return items.map((item, index) => {
      const previous = previousItems[index] || {};
      if (poolId === "codex-accounts") {
        return mergeAccountSecrets(item, previous);
      }
      return mergeApiSecrets(item, previous);
    });
  }

  async validatePoolItems(poolId, items) {
    const mergedItems = await this.mergeSecrets(poolId, items);
    return this.validator.validatePoolItems(poolId, mergedItems);
  }

  async writeEncryptedPool(poolId, items) {
    if (this.readOnly) {
      const error = new Error(this.readOnlyReason || "Encrypted pool store is read-only.");
      error.statusCode = 503;
      throw error;
    }
    const definition = this.getDefinition(poolId);
    const encrypted = encryptJson(items, this.cryptoKey);
    await fs.mkdir(path.dirname(definition.filePath), { recursive: true });
    await fs.writeFile(definition.filePath, `${encrypted}\n`, "utf8");
    return definition.filePath;
  }

  async savePool(poolId, items) {
    const definition = this.getDefinition(poolId);
    const validation = await this.validatePoolItems(poolId, items);
    if (!validation.ok) {
      const error = new Error("Pool validation failed");
      error.statusCode = 400;
      error.details = validation.errors;
      throw error;
    }

    await this.writeEncryptedPool(poolId, validation.normalizedItems);
    const stat = await fs.stat(definition.filePath);
    return {
      pool: {
        id: definition.id,
        label: definition.label,
        category: definition.category,
        provider: definition.provider,
        filePath: definition.filePath,
      },
      items: this.maskItems(poolId, validation.normalizedItems),
      savedAt: stat.mtime.toISOString(),
      count: validation.normalizedItems.length,
      readOnly: this.readOnly,
      readOnlyReason: this.readOnlyReason,
      storageBackend: this.storageBackend,
    };
  }

  async importPool(poolId, items) {
    return this.savePool(poolId, items);
  }

  runtimeConfigPath(configId) {
    return path.join(this.dataDir, "config", `${configId}.json`);
  }

  async loadRuntimeConfig(configId, defaults = {}) {
    const filePath = this.runtimeConfigPath(configId);
    if (!(await fileExists(filePath))) {
      return { ...defaults };
    }
    const content = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(content);
    return {
      ...defaults,
      ...(parsed && typeof parsed === "object" ? parsed : {}),
    };
  }

  async saveRuntimeConfig(configId, value) {
    if (this.readOnly) {
      const error = new Error(this.readOnlyReason || "Encrypted pool store is read-only.");
      error.statusCode = 503;
      throw error;
    }
    const filePath = this.runtimeConfigPath(configId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    return value;
  }
}
