import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";

import { HistoryStore } from "./history-store.mjs";
import { ApiPoolProxyManager } from "./api-pool-proxy-manager.mjs";

function listenOnce(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

test("ApiPoolProxyManager reports port conflicts with 409", async () => {
  const occupied = await listenOnce(0);
  const address = occupied.address();
  const port = typeof address === "object" && address ? address.port : 8789;
  const historyStore = new HistoryStore("/tmp/api-pool-proxy-manager-test");
  historyStore.items = [];
  historyStore.load = async () => {};
  historyStore.add = async () => {};

  const manager = new ApiPoolProxyManager(historyStore);

  try {
    await assert.rejects(
      manager.start({
        provider: "codex",
        host: "127.0.0.1",
        port,
      }),
      (error) => error?.statusCode === 409 && new RegExp(String(port)).test(error.message),
    );
  } finally {
    await new Promise((resolve, reject) => occupied.close((error) => (error ? reject(error) : resolve())));
  }
});
