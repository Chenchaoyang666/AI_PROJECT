import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createApiPoolProxyServer, createApiPoolProxyService } from "./api-pool-proxy.mjs";

async function makePoolDir(provider, endpoints) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "api-pool-script-test-"));
  const dir = path.join(root, provider);
  await fs.mkdir(dir, { recursive: true });
  for (const [name, body] of endpoints) {
    await fs.writeFile(path.join(dir, `${name}.json`), `${JSON.stringify(body, null, 2)}\n`, "utf8");
  }
  return dir;
}

async function startServer(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function stopServer(server) {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

test("api pool proxy exposes health and status", async () => {
  const poolDir = await makePoolDir("codex", [
    [
      "main",
      [
        {
          name: "main",
          type: "codex",
          baseUrl: "https://upstream.example.com/v1",
          apiKey: "sk-main",
        },
      ],
    ],
  ]);

  const { server } = await createApiPoolProxyServer({
    provider: "codex",
    poolDir,
    localApiKey: "local-key",
    maxSwitchAttempts: 2,
    requestTimeoutMs: 2000,
    proxyUrl: "",
    fetchFn: async () => new Response('{"data":[{"id":"gpt-5.4"}]}', { status: 200 }),
  });
  const baseUrl = await startServer(server);

  try {
    const [healthRes, statusRes] = await Promise.all([
      fetch(`${baseUrl}/healthz`),
      fetch(`${baseUrl}/proxy/status`),
    ]);
    const health = await healthRes.json();
    const status = await statusRes.json();

    assert.equal(health.ok, true);
    assert.equal(health.provider, "codex");
    assert.equal(status.provider, "codex");
    assert.equal(status.endpoints.length, 1);
  } finally {
    await stopServer(server);
  }
});

test("api pool proxy rejects missing local auth", async () => {
  const poolDir = await makePoolDir("codex", [
    [
      "main",
      [
        {
          name: "main",
          type: "codex",
          baseUrl: "https://upstream.example.com/v1",
          apiKey: "sk-main",
        },
      ],
    ],
  ]);

  const { server } = await createApiPoolProxyServer({
    provider: "codex",
    poolDir,
    localApiKey: "local-key",
    maxSwitchAttempts: 2,
    requestTimeoutMs: 2000,
    proxyUrl: "",
    fetchFn: async () => new Response('{"data":[{"id":"gpt-5.4"}]}', { status: 200 }),
  });
  const baseUrl = await startServer(server);

  try {
    const response = await fetch(`${baseUrl}/v1/models`);
    assert.equal(response.status, 401);
  } finally {
    await stopServer(server);
  }
});

test("api pool proxy switches endpoint after retryable upstream failure", async () => {
  const poolDir = await makePoolDir("codex", [
    [
      "pool",
      [
        {
          name: "a",
          type: "codex",
          baseUrl: "https://a.example.com/v1",
          apiKey: "sk-a",
        },
        {
          name: "b",
          type: "codex",
          baseUrl: "https://b.example.com/v1",
          apiKey: "sk-b",
        },
      ],
    ],
  ]);

  const fetchFn = async (url, options) => {
    const auth = options?.headers?.authorization || "";
    if (String(url).includes("a.example.com")) {
      if (auth.includes("sk-a")) {
        return new Response("ratelimit", { status: 429 });
      }
    }
    return new Response('{"data":[{"id":"gpt-5.4"}]}', { status: 200 });
  };

  const { server } = await createApiPoolProxyServer({
    provider: "codex",
    poolDir,
    localApiKey: "local-key",
    maxSwitchAttempts: 2,
    requestTimeoutMs: 2000,
    proxyUrl: "",
    fetchFn,
  });
  const baseUrl = await startServer(server);

  try {
    const response = await fetch(`${baseUrl}/v1/models`, {
      headers: {
        authorization: "Bearer local-key",
      },
    });
    assert.equal(response.status, 200);

    const statusRes = await fetch(`${baseUrl}/proxy/status`);
    const status = await statusRes.json();
    assert.equal(status.active.name, "b");
  } finally {
    await stopServer(server);
  }
});

test("api pool proxy scheduled switch rotates to the next healthy endpoint", async () => {
  const poolDir = await makePoolDir("codex", [
    [
      "pool",
      [
        {
          name: "a",
          type: "codex",
          baseUrl: "https://a.example.com/v1",
          apiKey: "sk-a",
        },
        {
          name: "b",
          type: "codex",
          baseUrl: "https://b.example.com/v1",
          apiKey: "sk-b",
        },
      ],
    ],
  ]);

  const service = await createApiPoolProxyService({
    provider: "codex",
    poolDir,
    localApiKey: "local-key",
    maxSwitchAttempts: 2,
    requestTimeoutMs: 2000,
    proxyUrl: "",
    enableScheduledSwitch: true,
    scheduledSwitchIntervalMs: 900000,
    fetchFn: async () => new Response('{"data":[{"id":"gpt-5.4"}]}', { status: 200 }),
  });

  try {
    const result = await service.runScheduledSwitchNow();
    assert.equal(result.switched, true);
    assert.equal(service.getAdminStatus().active.name, "b");
    assert.equal(service.getAdminStatus().lastScheduledSwitchReason, "switched");
  } finally {
    service.close();
  }
});

test("api pool proxy defers scheduled switch while requests are in flight", async () => {
  const poolDir = await makePoolDir("codex", [
    [
      "pool",
      [
        {
          name: "a",
          type: "codex",
          baseUrl: "https://a.example.com/v1",
          apiKey: "sk-a",
        },
        {
          name: "b",
          type: "codex",
          baseUrl: "https://b.example.com/v1",
          apiKey: "sk-b",
        },
      ],
    ],
  ]);

  let resolveUpstream;
  const upstreamDone = new Promise((resolve) => {
    resolveUpstream = resolve;
  });
  let aRequestCount = 0;
  const fetchFn = async (url) => {
    if (String(url).includes("a.example.com")) {
      aRequestCount += 1;
      if (aRequestCount > 1) {
        await upstreamDone;
      }
    }
    return new Response('{"data":[{"id":"gpt-5.4"}]}', { status: 200 });
  };

  const { server, service } = await createApiPoolProxyServer({
    provider: "codex",
    poolDir,
    localApiKey: "local-key",
    maxSwitchAttempts: 2,
    requestTimeoutMs: 2000,
    proxyUrl: "",
    enableScheduledSwitch: true,
    scheduledSwitchIntervalMs: 900000,
    fetchFn,
  });
  const baseUrl = await startServer(server);

  try {
    const request = fetch(`${baseUrl}/v1/models`, {
      headers: {
        authorization: "Bearer local-key",
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    const deferred = await service.runScheduledSwitchNow();
    assert.equal(deferred.switched, false);
    assert.equal(deferred.reason, "busy");
    assert.equal(service.getAdminStatus().active.name, "a");

    resolveUpstream();
    const response = await request;
    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(service.getAdminStatus().active.name, "b");
    assert.equal(service.getAdminStatus().inflightRequests, 0);
    assert.equal(service.getAdminStatus().lastScheduledSwitchReason, "switched");
  } finally {
    await stopServer(server);
  }
});
