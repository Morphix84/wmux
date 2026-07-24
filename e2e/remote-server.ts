import { spawn } from "node:child_process";
import net from "node:net";
import { prepareStandardE2eRuntime } from "./standard-runtime.js";

const host = process.env.WMUX_E2E_SERVER_HOST?.trim() ?? "";
const port = Number.parseInt(process.env.WMUX_E2E_SERVER_PORT?.trim() || "3491", 10);

if (!net.isIP(host)) {
  throw new Error("WMUX_E2E_SERVER_HOST must be an explicit IP address");
}
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("WMUX_E2E_SERVER_PORT must be an integer from 1 through 65535");
}

const bracketedHost = net.isIPv6(host) ? `[${host}]` : host;
const baseURL = `http://${bracketedHost}:${port}`;
const runtime = prepareStandardE2eRuntime({ baseURL });
const child = spawn(
  process.execPath,
  [
    "--import",
    "tsx",
    "src/server/index.ts",
    "--dev",
    "--host",
    host,
    "--port",
    String(port),
  ],
  {
    env: { ...process.env, ...runtime.environment },
    stdio: "inherit",
  },
);

const forwardSignal = (signal: NodeJS.Signals) => {
  if (!child.killed) child.kill(signal);
};

process.once("SIGINT", () => forwardSignal("SIGINT"));
process.once("SIGTERM", () => forwardSignal("SIGTERM"));
child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
