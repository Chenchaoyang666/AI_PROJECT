import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function nowIso() {
  return new Date().toISOString();
}

function validationError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function ensureTrailingNewline(text) {
  const normalized = String(text ?? "").replace(/\r\n/g, "\n");
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

function normalizeTomlText(text) {
  return String(text ?? "").replace(/\r\n/g, "\n").trimEnd();
}

function normalizeJsonText(text) {
  return `${JSON.stringify(JSON.parse(String(text ?? "")), null, 2)}\n`;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function defaultProviderDefinitions(homeDir = os.homedir()) {
  return {
    codex: {
      provider: "codex",
      label: "Codex 配置",
      targetPaths: [
        {
          key: "authJsonText",
          label: "auth.json",
          path: path.join(homeDir, ".codex", "auth.json"),
          kind: "json",
        },
        {
          key: "configTomlText",
          label: "config.toml",
          path: path.join(homeDir, ".codex", "config.toml"),
          kind: "toml",
        },
      ],
    },
    "claude-code": {
      provider: "claude-code",
      label: "Claude Code 配置",
      targetPaths: [
        {
          key: "settingsJsonText",
          label: "settings.json",
          path: path.join(homeDir, ".claude", "settings.json"),
          kind: "json",
        },
      ],
    },
  };
}

function makeEmptyState() {
  return {
    version: 1,
    presetsByProvider: {
      codex: [],
      "claude-code": [],
    },
    lastAppliedPresetIdByProvider: {
      codex: null,
      "claude-code": null,
    },
    lastAppliedAtByProvider: {
      codex: null,
      "claude-code": null,
    },
  };
}

async function readOptionalText(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

function normalizePresetInput(provider, input = {}) {
  return {
    id: input.id ? String(input.id) : "",
    name: String(input.name ?? "").trim(),
    provider,
    payload:
      provider === "codex"
        ? {
            authJsonText: String(input.payload?.authJsonText ?? ""),
            configTomlText: String(input.payload?.configTomlText ?? ""),
          }
        : {
            settingsJsonText: String(input.payload?.settingsJsonText ?? ""),
          },
  };
}

function validatePreset(provider, preset) {
  if (!preset.name) {
    throw validationError("name 不能为空");
  }

  if (provider === "codex") {
    if (!preset.payload.configTomlText.trim()) {
      throw validationError("configTomlText 不能为空");
    }
    try {
      normalizeJsonText(preset.payload.authJsonText);
    } catch {
      throw validationError("authJsonText 不是合法 JSON");
    }
    return;
  }

  try {
    normalizeJsonText(preset.payload.settingsJsonText);
  } catch {
    throw validationError("settingsJsonText 不是合法 JSON");
  }
}

function compareContent(kind, leftText, rightText) {
  if (kind === "json") {
    try {
      return normalizeJsonText(leftText) === normalizeJsonText(rightText);
    } catch {
      return false;
    }
  }
  return normalizeTomlText(leftText) === normalizeTomlText(rightText);
}

function prepareWrittenText(kind, text) {
  if (kind === "json") return normalizeJsonText(text);
  return ensureTrailingNewline(text);
}

export class ConfigSwitchStore {
  constructor(dataDir, options = {}) {
    this.dataDir = dataDir;
    this.filePath = path.join(dataDir, "config-switch.json");
    this.providerDefinitions = options.providerDefinitions || defaultProviderDefinitions();
    this.state = makeEmptyState();
    this.loaded = false;
  }

  requireProvider(provider) {
    const normalized = String(provider || "");
    if (!this.providerDefinitions[normalized]) {
      throw validationError(`Unknown config-switch provider: ${provider}`, 404);
    }
    return normalized;
  }

  async load() {
    if (this.loaded) return;
    await fs.mkdir(this.dataDir, { recursive: true });
    try {
      const raw = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      this.state = {
        ...makeEmptyState(),
        ...raw,
        presetsByProvider: {
          ...makeEmptyState().presetsByProvider,
          ...(raw.presetsByProvider || {}),
        },
        lastAppliedPresetIdByProvider: {
          ...makeEmptyState().lastAppliedPresetIdByProvider,
          ...(raw.lastAppliedPresetIdByProvider || {}),
        },
        lastAppliedAtByProvider: {
          ...makeEmptyState().lastAppliedAtByProvider,
          ...(raw.lastAppliedAtByProvider || {}),
        },
      };
    } catch {
      this.state = makeEmptyState();
      await this.persist();
    }
    this.loaded = true;
  }

  async persist() {
    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.writeFile(
      this.filePath,
      `${JSON.stringify(this.state, null, 2)}\n`,
      "utf8",
    );
  }

  findPreset(provider, presetId) {
    const items = this.state.presetsByProvider[provider] || [];
    const preset = items.find((item) => item.id === presetId) || null;
    if (!preset) {
      throw validationError(`Preset not found: ${presetId}`, 404);
    }
    return preset;
  }

  async serializeProvider(provider) {
    const definition = this.providerDefinitions[provider];
    const items = this.state.presetsByProvider[provider] || [];
    const lastAppliedPresetId = this.state.lastAppliedPresetIdByProvider[provider] || null;
    const currentFiles = {};

    for (const target of definition.targetPaths) {
      currentFiles[target.key] = await readOptionalText(target.path);
    }

    return {
      provider,
      label: definition.label,
      targetPaths: definition.targetPaths.map((target) => ({
        key: target.key,
        label: target.label,
        path: target.path,
      })),
      lastAppliedPresetId,
      lastAppliedAt: this.state.lastAppliedAtByProvider[provider] || null,
      presets: items
        .map((item) => {
          const matchesCurrent = definition.targetPaths.every((target) =>
            compareContent(
              target.kind,
              item.payload?.[target.key] || "",
              currentFiles[target.key] || "",
            ),
          );
          const status =
            item.id === lastAppliedPresetId
              ? matchesCurrent
                ? "active"
                : "drifted"
              : "idle";
          return {
            ...item,
            status,
            statusText:
              status === "active"
                ? "已启用"
                : status === "drifted"
                  ? "已偏离"
                  : "未启用",
            currentPayload:
              status === "drifted"
                ? Object.fromEntries(
                    definition.targetPaths.map((target) => [
                      target.key,
                      currentFiles[target.key] || "",
                    ]),
                  )
                : null,
          };
        })
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    };
  }

  async getConfigSwitchData() {
    await this.load();
    return {
      providers: {
        codex: await this.serializeProvider("codex"),
        "claude-code": await this.serializeProvider("claude-code"),
      },
    };
  }

  async upsertPreset(provider, input) {
    await this.load();
    const normalizedProvider = this.requireProvider(provider);
    const preset = normalizePresetInput(normalizedProvider, input);
    validatePreset(normalizedProvider, preset);

    const now = nowIso();
    const items = [...(this.state.presetsByProvider[normalizedProvider] || [])];
    if (preset.id) {
      const index = items.findIndex((item) => item.id === preset.id);
      if (index < 0) {
        throw validationError(`Preset not found: ${preset.id}`, 404);
      }
      items[index] = {
        ...items[index],
        name: preset.name,
        payload: preset.payload,
        updatedAt: now,
      };
    } else {
      items.unshift({
        id: crypto.randomUUID(),
        name: preset.name,
        provider: normalizedProvider,
        payload: preset.payload,
        createdAt: now,
        updatedAt: now,
      });
    }
    this.state.presetsByProvider[normalizedProvider] = items;
    await this.persist();
    return this.getConfigSwitchData();
  }

  async deletePreset(provider, presetId) {
    await this.load();
    const normalizedProvider = this.requireProvider(provider);
    const items = [...(this.state.presetsByProvider[normalizedProvider] || [])];
    const index = items.findIndex((item) => item.id === presetId);
    if (index < 0) {
      throw validationError(`Preset not found: ${presetId}`, 404);
    }

    items.splice(index, 1);
    this.state.presetsByProvider[normalizedProvider] = items;
    if (this.state.lastAppliedPresetIdByProvider[normalizedProvider] === presetId) {
      this.state.lastAppliedPresetIdByProvider[normalizedProvider] = null;
      this.state.lastAppliedAtByProvider[normalizedProvider] = null;
    }
    await this.persist();
    return this.getConfigSwitchData();
  }

  async copyPreset(provider, presetId) {
    await this.load();
    const normalizedProvider = this.requireProvider(provider);
    const source = this.findPreset(normalizedProvider, presetId);
    const now = nowIso();
    const copied = {
      ...source,
      id: crypto.randomUUID(),
      name: `${source.name} - 副本`,
      createdAt: now,
      updatedAt: now,
    };
    this.state.presetsByProvider[normalizedProvider] = [
      copied,
      ...(this.state.presetsByProvider[normalizedProvider] || []),
    ];
    await this.persist();
    return this.getConfigSwitchData();
  }

  async activatePreset(provider, presetId, options = {}) {
    await this.load();
    const normalizedProvider = this.requireProvider(provider);
    if (options.confirmed !== true) {
      throw validationError("Confirmation required before activating this preset.", 409);
    }

    const definition = this.providerDefinitions[normalizedProvider];
    const preset = this.findPreset(normalizedProvider, presetId);
    validatePreset(normalizedProvider, preset);

    for (const target of definition.targetPaths) {
      await fs.mkdir(path.dirname(target.path), { recursive: true });
      await fs.writeFile(
        target.path,
        prepareWrittenText(target.kind, preset.payload[target.key] || ""),
        "utf8",
      );
    }

    this.state.lastAppliedPresetIdByProvider[normalizedProvider] = presetId;
    this.state.lastAppliedAtByProvider[normalizedProvider] = nowIso();
    await this.persist();

    return {
      ...(await this.getConfigSwitchData()),
      activation: {
        provider: normalizedProvider,
        presetId,
        targetPaths: definition.targetPaths.map((target) => target.path),
      },
    };
  }
}
