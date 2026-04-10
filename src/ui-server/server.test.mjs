import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { ConfigSwitchStore } from "./config-switch-store.mjs";
import { createRequestListener } from "./server.mjs";

async function makeTempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "local-ui-server-test-"));
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

async function makeConfigSwitchListener() {
  const root = await makeTempRoot();
  const configSwitchStore = new ConfigSwitchStore(path.join(root, "data"), {
    providerDefinitions: makeProviderDefinitions(root),
  });
  await configSwitchStore.load();

  return {
    root,
    configSwitchStore,
    listener: createRequestListener({
      staticDir: path.join(root, "static"),
      historyStore: { list: async () => [] },
      poolStore: {
        listPools: () => [],
        loadPool: async () => {
          throw new Error("not implemented");
        },
        savePool: async () => {
          throw new Error("not implemented");
        },
        validatePoolItems: () => ({ ok: true, errors: [], normalizedItems: [] }),
      },
      runManager: {
        execute: async () => {
          throw new Error("not implemented");
        },
        getRun: () => null,
      },
      proxyManager: {
        start: async () => ({ reused: false, status: {} }),
        stop: async () => ({}),
        getStatus: async () => ({}),
      },
      apiPoolProxyManagerCodex: {
        start: async () => ({ reused: false, status: {} }),
        stop: async () => ({}),
        getStatus: async () => ({}),
      },
      apiPoolProxyManagerClaude: {
        start: async () => ({ reused: false, status: {} }),
        stop: async () => ({}),
        getStatus: async () => ({}),
      },
      configSwitchStore,
    }),
  };
}

async function invoke(listener, { method, url, body }) {
  const req = Readable.from(
    body == null ? [] : [Buffer.from(JSON.stringify(body), "utf8")],
  );
  req.method = method;
  req.url = url;

  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) {
        this.headers[name.toLowerCase()] = value;
      },
      end(chunk) {
        const text = Buffer.isBuffer(chunk)
          ? chunk.toString("utf8")
          : String(chunk || "");
        resolve({
          statusCode: this.statusCode,
          headers: this.headers,
          body: text ? JSON.parse(text) : null,
        });
      },
    };

    listener(req, res).catch(reject);
  });
}

test("local ui server exposes config-switch GET and POST routes", async () => {
  const { listener } = await makeConfigSwitchListener();

  const created = await invoke(listener, {
    method: "POST",
    url: "/api/config-switch/codex",
    body: {
      name: "主配置",
      payload: {
        authJsonText: '{"OPENAI_API_KEY":"sk-main"}',
        configTomlText: 'model_provider = "OpenAI"\nmodel = "gpt-5.4"',
      },
    },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.providers.codex.presets.length, 1);

  const fetched = await invoke(listener, {
    method: "GET",
    url: "/api/config-switch",
  });
  assert.equal(fetched.statusCode, 200);
  assert.equal(fetched.body.providers.codex.presets[0].name, "主配置");
});

test("local ui server returns 4xx for invalid config-switch provider and missing confirmation", async () => {
  const { listener } = await makeConfigSwitchListener();

  const invalidProvider = await invoke(listener, {
    method: "POST",
    url: "/api/config-switch/missing",
    body: {
      name: "bad",
      payload: {
        authJsonText: '{"OPENAI_API_KEY":"sk"}',
        configTomlText: 'model = "gpt-5.4"',
      },
    },
  });
  assert.equal(invalidProvider.statusCode, 404);

  const created = await invoke(listener, {
    method: "POST",
    url: "/api/config-switch/codex",
    body: {
      name: "主配置",
      payload: {
        authJsonText: '{"OPENAI_API_KEY":"sk-main"}',
        configTomlText: 'model_provider = "OpenAI"',
      },
    },
  });
  const presetId = created.body.providers.codex.presets[0].id;

  const activateWithoutConfirm = await invoke(listener, {
    method: "POST",
    url: `/api/config-switch/codex/${presetId}/activate`,
    body: {},
  });
  assert.equal(activateWithoutConfirm.statusCode, 409);
});
