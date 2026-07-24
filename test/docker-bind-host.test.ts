import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const selector = path.resolve("deploy/docker/docker-bind-host.mjs");
const dockerfile = fs.readFileSync(path.resolve("deploy/docker/Dockerfile"), "utf8");

const runSelector = (environment: Record<string, string>, args: string[] = []) =>
  spawnSync(process.execPath, [selector, ...args], {
    encoding: "utf8",
    env: { ...process.env, WMUX_HOST: "", WMUX_PUBLISH_HOST: "", ...environment },
  });

test("explicit private container bind addresses are honored", () => {
  const result = runSelector({ WMUX_HOST: "172.20.0.9" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "172.20.0.9");
});

test("container loopback is rejected because published traffic arrives off-loopback", () => {
  for (const host of ["127.0.0.1", "::1", "localhost"]) {
    const result = runSelector({ WMUX_HOST: host });
    assert.notEqual(result.status, 0, `${host} should be rejected`);
    assert.match(result.stderr, /Refusing WMUX_HOST/);
  }
});

test("publish host validation accepts private addresses and rejects wildcard or public addresses", () => {
  for (const host of ["127.0.0.1", "100.64.0.10", "192.168.1.10"]) {
    const result = runSelector({ WMUX_PUBLISH_HOST: host }, ["--validate-publish"]);
    assert.equal(result.status, 0, result.stderr);
  }
  for (const host of ["0.0.0.0", "8.8.8.8", "::", "example.com"]) {
    const result = runSelector({ WMUX_PUBLISH_HOST: host }, ["--validate-publish"]);
    assert.notEqual(result.status, 0, `${host} should be rejected`);
    assert.match(result.stderr, /Refusing WMUX_PUBLISH_HOST/);
  }
});

test("Dockerfile does not require BuildKit-only COPY flags", () => {
  assert.doesNotMatch(dockerfile, /^COPY\s+--chmod(?:=|\s)/m);
});

test("Docker build stage includes every repository build script", () => {
  assert.match(
    dockerfile,
    /FROM dependencies AS build[\s\S]*COPY scripts \.\/scripts[\s\S]*RUN npm run build/,
  );
});
