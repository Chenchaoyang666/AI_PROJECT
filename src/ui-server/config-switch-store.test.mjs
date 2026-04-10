import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ConfigSwitchStore } from "./config-switch-store.mjs";

async function makeTempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "config-switch-store-test-"));
}

function makeProviderDefinitions(root) {
  return {
    codex: {
      provider: "codex",
      label: "Codex 配置",
      targetPaths: [
        {
          key: "authJsonText",
          label: "auth.json",
          path: path.join(root, "home", ".codex", "auth.json"),
          kind: "json",
        },
        {
          key: "configTomlText",
          label: "config.toml",
          path: path.join(root, "home", ".codex", "config.toml"),
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
          path: path.join(root, "home", ".claude", "settings.json"),
          kind: "json",
        },
      ],
    },
  };
}

async function makeStore() {
  const root = await makeTempRoot();
  const dataDir = path.join(root, "data");
  const store = new ConfigSwitchStore(dataDir, {
    providerDefinitions: makeProviderDefinitions(root),
  });
  await store.load();
  return { root, dataDir, store };
}

test("ConfigSwitchStore initializes empty providers", async () => {
  const { store } = await makeStore();
  const result = await store.getConfigSwitchData();
  assert.deepEqual(Object.keys(result.providers), ["codex", "claude-code"]);
  assert.equal(result.providers.codex.presets.length, 0);
  assert.equal(result.providers["claude-code"].presets.length, 0);
});

test("ConfigSwitchStore persists codex presets to local data dir", async () => {
  const { dataDir, store } = await makeStore();
  const result = await store.upsertPreset("codex", {
    name: "主配置",
    payload: {
      authJsonText: '{"OPENAI_API_KEY":"sk-main"}',
      configTomlText: 'model_provider = "OpenAI"\nmodel = "gpt-5.4"',
    },
  });

  assert.equal(result.providers.codex.presets.length, 1);
  const written = JSON.parse(
    await fs.readFile(path.join(dataDir, "config-switch.json"), "utf8"),
  );
  assert.equal(written.presetsByProvider.codex[0].name, "主配置");
});

test("ConfigSwitchStore copies and deletes claude presets", async () => {
  const { store } = await makeStore();
  const created = await store.upsertPreset("claude-code", {
    name: "Claude 主配置",
    payload: {
      settingsJsonText: '{"env":{"ANTHROPIC_AUTH_TOKEN":"sk-claude"}}',
    },
  });
  const presetId = created.providers["claude-code"].presets[0].id;

  const copied = await store.copyPreset("claude-code", presetId);
  assert.equal(copied.providers["claude-code"].presets.length, 2);
  assert.match(copied.providers["claude-code"].presets[0].name, /副本/);

  const afterDelete = await store.deletePreset(
    "claude-code",
    copied.providers["claude-code"].presets[1].id,
  );
  assert.equal(afterDelete.providers["claude-code"].presets.length, 1);
});

test("ConfigSwitchStore rejects invalid JSON payloads", async () => {
  const { store } = await makeStore();
  await assert.rejects(
    store.upsertPreset("claude-code", {
      name: "非法配置",
      payload: { settingsJsonText: "{" },
    }),
    (error) => error?.statusCode === 400,
  );
});

test("ConfigSwitchStore activation writes codex files", async () => {
  const { root, store } = await makeStore();
  const authPath = path.join(root, "home", ".codex", "auth.json");
  const configPath = path.join(root, "home", ".codex", "config.toml");
  await fs.mkdir(path.dirname(authPath), { recursive: true });
  await fs.writeFile(authPath, '{"OPENAI_API_KEY":"old"}\n', "utf8");
  await fs.writeFile(configPath, 'model = "old"\n', "utf8");

  const created = await store.upsertPreset("codex", {
    name: "HF 代理",
    payload: {
      authJsonText: '{"OPENAI_API_KEY":"hf-key"}',
      configTomlText: 'model_provider = "OpenAI"\nmodel = "gpt-5.4"',
    },
  });
  const presetId = created.providers.codex.presets[0].id;

  const activated = await store.activatePreset("codex", presetId, { confirmed: true });
  assert.equal(activated.providers.codex.presets[0].status, "active");
  assert.match(await fs.readFile(authPath, "utf8"), /hf-key/);
  assert.match(await fs.readFile(configPath, "utf8"), /gpt-5.4/);
});

test("ConfigSwitchStore activation requires confirmation", async () => {
  const { store } = await makeStore();
  const created = await store.upsertPreset("codex", {
    name: "主配置",
    payload: {
      authJsonText: '{"OPENAI_API_KEY":"sk-main"}',
      configTomlText: 'model_provider = "OpenAI"',
    },
  });

  await assert.rejects(
    store.activatePreset("codex", created.providers.codex.presets[0].id, { confirmed: false }),
    (error) => error?.statusCode === 409,
  );
});

test("ConfigSwitchStore marks last applied preset as drifted after local change", async () => {
  const { root, store } = await makeStore();
  const settingsPath = path.join(root, "home", ".claude", "settings.json");
  const created = await store.upsertPreset("claude-code", {
    name: "Claude 代理",
    payload: {
      settingsJsonText: '{"env":{"ANTHROPIC_AUTH_TOKEN":"sk-claude","ANTHROPIC_MODEL":"claude-sonnet"}}',
    },
  });
  const presetId = created.providers["claude-code"].presets[0].id;

  await store.activatePreset("claude-code", presetId, { confirmed: true });
  await fs.writeFile(
    settingsPath,
    '{\n  "env": {\n    "ANTHROPIC_AUTH_TOKEN": "changed"\n  }\n}\n',
    "utf8",
  );

  const result = await store.getConfigSwitchData();
  assert.equal(result.providers["claude-code"].presets[0].status, "drifted");
  assert.match(
    result.providers["claude-code"].presets[0].currentPayload.settingsJsonText,
    /changed/,
  );
});
