import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { decryptJson, encryptJson } from "../shared/pool-crypto.mjs";
import { maskSecret } from "../shared/secret-sanitizer.mjs";
import { PoolStore } from "../ui-server/pool-store.mjs";

function makeDefinitions(resolveFilePath) {
  return [
    {
      id: "codex-accounts",
      label: "Codex 账号池",
      category: "accounts",
      provider: "codex",
      filePath: resolveFilePath("pools/codex-accounts.enc"),
      storagePath: "pools/codex-accounts.enc",
    },
    {
      id: "codex-api",
      label: "Codex API 池",
      category: "api",
      provider: "codex",
      filePath: resolveFilePath("pools/codex-api.enc"),
      storagePath: "pools/codex-api.enc",
    },
    {
      id: "claude-code-api",
      label: "Claude Code API 池",
      category: "api",
      provider: "claude-code",
      filePath: resolveFilePath("pools/claude-code-api.enc"),
      storagePath: "pools/claude-code-api.enc",
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

class LocalFsStorageBackend {
  constructor({ dataDir }) {
    this.dataDir = dataDir;
    this.storageBackend = path.resolve(dataDir) === "/data" ? "bucket-mounted-fs" : "local-fs";
    this.readOnly = false;
    this.readOnlyReason = "";
  }

  describeLocation(relativePath) {
    return path.join(this.dataDir, relativePath);
  }

  resolvePath(relativePath) {
    return path.join(this.dataDir, relativePath);
  }

  async init() {
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

  async exists(relativePath) {
    return fileExists(this.resolvePath(relativePath));
  }

  async readText(relativePath) {
    return fs.readFile(this.resolvePath(relativePath), "utf8");
  }

  async writeText(relativePath, content) {
    const filePath = this.resolvePath(relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf8");
    return filePath;
  }

  async stat(relativePath) {
    return fs.stat(this.resolvePath(relativePath));
  }
}

class HfDatasetStorageBackend {
  constructor({
    dataDir,
    repoId,
    token,
    branch = "main",
    fetchFn = globalThis.fetch,
  }) {
    this.dataDir = dataDir;
    this.repoId = repoId;
    this.token = token;
    this.branch = branch;
    this.fetchFn = fetchFn;
    this.storageBackend = "hf-dataset";
    this.readOnly = false;
    this.readOnlyReason = "";
    this.fileMeta = new Map();
  }

  describeLocation(relativePath) {
    return `hf://datasets/${this.repoId}/${this.branch}/${relativePath}`;
  }

  headers(extra = {}) {
    return {
      authorization: `Bearer ${this.token}`,
      ...extra,
    };
  }

  resolveUrl(relativePath) {
    return `https://huggingface.co/datasets/${this.repoId}/resolve/${encodeURIComponent(this.branch)}/${relativePath}`;
  }

  commitUrl() {
    return `https://huggingface.co/api/datasets/${this.repoId}/commit/${encodeURIComponent(this.branch)}`;
  }

  async request(url, options = {}) {
    const response = await this.fetchFn(url, options);
    return response;
  }

  async init() {
    await fs.mkdir(this.dataDir, { recursive: true });

    if (!this.repoId) {
      this.readOnly = true;
      this.readOnlyReason = "HF_DATASET_REPO is required when using the hf dataset backend.";
      return;
    }
    if (!this.token) {
      this.readOnly = true;
      this.readOnlyReason = "HF_TOKEN is required to read and write the private hf dataset.";
      return;
    }

    try {
      const response = await this.request(
        `https://huggingface.co/api/datasets/${this.repoId}`,
        { headers: this.headers() },
      );
      if (!response.ok) {
        throw new Error(`Dataset API returned ${response.status}`);
      }
    } catch (error) {
      this.readOnly = true;
      this.readOnlyReason = `Unable to sync private hf dataset: ${error?.message || String(error)}`;
    }
  }

  async exists(relativePath) {
    const response = await this.request(this.resolveUrl(relativePath), {
      method: "HEAD",
      headers: this.headers(),
    });
    if (response.ok) {
      const lastModified = response.headers.get("last-modified");
      this.fileMeta.set(relativePath, {
        mtime: lastModified ? new Date(lastModified) : new Date(),
      });
      return true;
    }
    if (response.status === 404) {
      this.fileMeta.delete(relativePath);
      return false;
    }
    throw new Error(`Failed to check dataset file ${relativePath}: ${response.status}`);
  }

  async readText(relativePath) {
    const response = await this.request(this.resolveUrl(relativePath), {
      headers: this.headers(),
    });
    if (response.status === 404) {
      const error = new Error(`Dataset file not found: ${relativePath}`);
      error.statusCode = 404;
      throw error;
    }
    if (!response.ok) {
      throw new Error(`Failed to read dataset file ${relativePath}: ${response.status}`);
    }
    const lastModified = response.headers.get("last-modified");
    this.fileMeta.set(relativePath, {
      mtime: lastModified ? new Date(lastModified) : new Date(),
    });
    return response.text();
  }

  async writeText(relativePath, content) {
    const payload = [
      {
        key: "header",
        value: {
          summary: `Update ${relativePath}`,
          description: "",
        },
      },
      {
        key: "file",
        value: {
          content: Buffer.from(content, "utf8").toString("base64"),
          path: relativePath,
          encoding: "base64",
        },
      },
    ]
      .map((item) => JSON.stringify(item))
      .join("\n");

    const response = await this.request(this.commitUrl(), {
      method: "POST",
      headers: this.headers({
        "content-type": "application/x-ndjson",
      }),
      body: `${payload}\n`,
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Failed to write dataset file ${relativePath}: ${response.status} ${message}`.trim());
    }
    this.fileMeta.set(relativePath, { mtime: new Date() });
    return this.describeLocation(relativePath);
  }

  async stat(relativePath) {
    const meta = this.fileMeta.get(relativePath);
    if (meta?.mtime) {
      return { mtime: meta.mtime };
    }
    if (await this.exists(relativePath)) {
      return { mtime: this.fileMeta.get(relativePath)?.mtime || new Date() };
    }
    const error = new Error(`Dataset file not found: ${relativePath}`);
    error.statusCode = 404;
    throw error;
  }
}

export class EncryptedPoolStore {
  constructor({
    dataDir,
    cryptoKey,
    storageBackend = "local-fs",
    hfDatasetRepo = "",
    hfToken = "",
    hfDatasetBranch = "main",
    fetchFn,
  }) {
    this.dataDir = dataDir;
    this.cryptoKey = cryptoKey;
    this.backend =
      storageBackend === "hf-dataset"
        ? new HfDatasetStorageBackend({
            dataDir,
            repoId: hfDatasetRepo,
            token: hfToken,
            branch: hfDatasetBranch,
            fetchFn,
          })
        : new LocalFsStorageBackend({ dataDir });
    this.definitions = makeDefinitions((relativePath) => this.backend.describeLocation(relativePath));
    this.validator = new PoolStore(this.definitions);
    this.readOnly = false;
    this.readOnlyReason = "";
    this.storageBackend = this.backend.storageBackend;
  }

  async init() {
    if (!this.cryptoKey) {
      throw new Error("POOL_CRYPTO_KEY is required.");
    }
    await this.backend.init();
    this.readOnly = this.backend.readOnly;
    this.readOnlyReason = this.backend.readOnlyReason;
    this.storageBackend = this.backend.storageBackend;
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
    if (!(await this.backend.exists(definition.storagePath))) {
      return [];
    }
    const encrypted = await this.backend.readText(definition.storagePath);
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
    if (await this.backend.exists(definition.storagePath)) {
      const stat = await this.backend.stat(definition.storagePath);
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
    await this.backend.writeText(definition.storagePath, `${encrypted}\n`);
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
    const stat = await this.backend.stat(definition.storagePath);
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
    return `config/${configId}.json`;
  }

  async loadRuntimeConfig(configId, defaults = {}) {
    const filePath = this.runtimeConfigPath(configId);
    if (!(await this.backend.exists(filePath))) {
      return { ...defaults };
    }
    const content = await this.backend.readText(filePath);
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
    await this.backend.writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
    return value;
  }
}
