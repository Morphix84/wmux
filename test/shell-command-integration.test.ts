import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { test } from "node:test";
import { spawn } from "node-pty";
import { buildSpawnSpec } from "../src/server/machines.js";

test("managed bash reports an unwrapped command and exit status", { skip: process.platform === "win32" }, async () => {
  const payloads: Array<Record<string, unknown>> = [];
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      if (request.method === "POST" && request.url === "/api/run-events" && body) {
        payloads.push(JSON.parse(body));
      }
      response.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const spec = buildSpawnSpec({
    id: "tracked",
    name: "Tracked",
    kind: "local",
    shell: "/bin/bash",
    cwd: path.resolve("e2e", "fixtures", "shell-tracking"),
    sessionBackend: "pty",
  }, 100, 32, {
    WMUX_PANE_ID: "pane_shell_integration",
    WMUX_WORKSPACE_ID: "ws_shell_integration",
    WMUX_TAB_ID: "tab_shell_integration",
    WMUX_URL: `http://127.0.0.1:${address.port}`,
    WMUX_SHELL_COMMAND_TRACKING: "1",
  });
  const pty = spawn(spec.file, spec.args, {
    cols: 100,
    rows: 32,
    cwd: spec.cwd,
    env: spec.env,
  });

  try {
    await new Promise<void>((resolve, reject) => {
      let output = "";
      const timeout = setTimeout(() => reject(new Error(`shell prompt timeout: ${output}`)), 5_000);
      const disposable = pty.onData((data) => {
        output += data;
        if (!output.includes("\u001b[?2004h")) return;
        clearTimeout(timeout);
        disposable.dispose();
        resolve();
      });
    });
    pty.write("make test\r");
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`run event timeout: ${JSON.stringify(payloads)}`)), 5_000);
      const interval = setInterval(() => {
        if (!payloads.some((payload) => payload.command === "make test" && payload.status === "failed")) return;
        clearInterval(interval);
        clearTimeout(timeout);
        resolve();
      }, 25);
    });
    const finished = payloads.find((payload) => payload.command === "make test" && payload.status === "failed");
    assert.equal(finished?.exitCode, 2);
  } finally {
    pty.kill();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
