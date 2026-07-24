import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helper = path.join(root, "scripts", "wmux-shell-run-event");

test("wmux-shell-run-event reports shell starts and terminal exit status", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "wmux-shell-run-event-"));
  const payloads: Array<Record<string, unknown>> = [];
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      payloads.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      response.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}`;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    WMUX_PANE_ID: "pane_shell_test",
    WMUX_WORKSPACE_ID: "ws_shell_test",
    WMUX_TAB_ID: "tab_shell_test",
  };
  delete env.WMUX_HELPER_TOKEN;
  delete env.WMUX_HELPER_TOKEN_PATH;
  delete env.WMUX_TOKEN;
  delete env.WMUX_TOKEN_PATH;

  try {
    await execFileAsync("python3", [
      helper,
      "start",
      "--run-id",
      "run_shell_test",
      "--command",
      "make   test",
      "--url",
      url,
    ], { cwd: root, env });
    await execFileAsync("python3", [
      helper,
      "finish",
      "--run-id",
      "run_shell_test",
      "--command",
      "make test",
      "--exit-code",
      "7",
      "--url",
      url,
    ], { cwd: root, env });

    assert.equal(payloads.length, 2);
    assert.deepEqual(
      payloads.map(({ runId, command, paneId, workspaceId, tabId, status, exitCode }) => ({
        runId,
        command,
        paneId,
        workspaceId,
        tabId,
        status,
        exitCode,
      })),
      [
        {
          runId: "run_shell_test",
          command: "make test",
          paneId: "pane_shell_test",
          workspaceId: "ws_shell_test",
          tabId: "tab_shell_test",
          status: "started",
          exitCode: undefined,
        },
        {
          runId: "run_shell_test",
          command: "make test",
          paneId: "pane_shell_test",
          workspaceId: "ws_shell_test",
          tabId: "tab_shell_test",
          status: "failed",
          exitCode: 7,
        },
      ],
    );
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    fs.rmSync(home, { recursive: true, force: true });
  }
});
