#!/usr/bin/env node

import { spawn } from "node:child_process";

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function start(label, args) {
  const child = spawn(npmCommand(), args, {
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`${label} exited with code ${code}`);
      process.exitCode = code;
    }
  });
  return child;
}

async function main() {
  const backend = start("ui:server", ["run", "ui:server"]);
  const frontend = start("ui:client", ["run", "ui:client", "--", "--host", "127.0.0.1"]);

  const cleanup = () => {
    if (!backend.killed) backend.kill("SIGTERM");
    if (!frontend.killed) frontend.kill("SIGTERM");
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
