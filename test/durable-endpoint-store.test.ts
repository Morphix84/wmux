import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CURRENT_DURABLE_ENDPOINT_SCHEMA_VERSION,
  DurableEndpointStore,
  UnsupportedDurableEndpointVersionError,
} from "../src/server/durable-endpoint-store.js";
import type { MachineConfig } from "../src/server/types.js";

const registeredMachine = (
  host: string,
  overrides: Partial<MachineConfig> = {},
): MachineConfig => ({
  id: "dynamic-node",
  name: "Dynamic node",
  kind: "ssh",
  host,
  user: "wmux",
  sessionBackend: "auto",
  source: "registered",
  agentToken: "server-only-agent-secret",
  ...overrides,
});

test("durable endpoint records survive restart with owner-only permissions", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wmux-endpoint-store-"));
  const filePath = path.join(directory, "session-endpoints.json");
  try {
    const store = new DurableEndpointStore(filePath);
    const record = store.bind("pane-one", registeredMachine("100.64.0.10"), "durable-multiplexer");
    assert.ok(record);
    assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);

    const restored = new DurableEndpointStore(filePath);
    assert.deepEqual(restored.snapshot(), store.snapshot());
    assert.equal(restored.activeForPane("pane-one")?.machine.agentToken, "server-only-agent-secret");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("reassignment strands the old endpoint and binds the replacement separately", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wmux-endpoint-reassign-"));
  const filePath = path.join(directory, "session-endpoints.json");
  try {
    const store = new DurableEndpointStore(filePath);
    const first = store.bind("pane-one", registeredMachine("100.64.0.10"), "durable-multiplexer");
    assert.ok(first);

    store.reconcile(
      new Set(["pane-one"]),
      [registeredMachine("100.64.0.11")],
    );
    const second = store.bind(
      "pane-one",
      registeredMachine("100.64.0.11"),
      "durable-multiplexer",
    );
    assert.ok(second);
    assert.notEqual(second.id, first.id);

    const records = store.recordsForPane("pane-one");
    assert.equal(records.length, 2);
    assert.equal(records.find((record) => record.id === first.id)?.status, "stranded");
    assert.equal(records.find((record) => record.id === second.id)?.status, "active");

    store.reconcile(new Set(["pane-one"]), [registeredMachine("100.64.0.10")]);
    const returned = store.bind(
      "pane-one",
      registeredMachine("100.64.0.10"),
      "durable-multiplexer",
    );
    assert.equal(returned?.id, first.id);
    assert.equal(store.recordsForPane("pane-one").length, 2);
    assert.equal(store.find(first.id).status, "active");
    assert.equal(store.find(second.id).status, "stranded");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("invalid primary recovers from the last validated backup", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wmux-endpoint-backup-"));
  const filePath = path.join(directory, "session-endpoints.json");
  try {
    const store = new DurableEndpointStore(filePath);
    const first = store.bind("pane-one", registeredMachine("100.64.0.10"), "durable-multiplexer");
    assert.ok(first);
    store.bind("pane-two", registeredMachine("100.64.0.10"), "durable-multiplexer");
    fs.writeFileSync(filePath, "{invalid");

    const recovered = new DurableEndpointStore(filePath);
    assert.deepEqual(recovered.snapshot().map((record) => record.id), [first.id]);
    assert.equal(JSON.parse(fs.readFileSync(filePath, "utf8")).records.length, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("future endpoint ledger versions are refused without rewriting", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wmux-endpoint-future-"));
  const filePath = path.join(directory, "session-endpoints.json");
  const payload = `${JSON.stringify({
    schemaVersion: CURRENT_DURABLE_ENDPOINT_SCHEMA_VERSION + 1,
    records: [],
  })}\n`;
  try {
    fs.writeFileSync(filePath, payload, { mode: 0o600 });
    assert.throws(
      () => new DurableEndpointStore(filePath),
      UnsupportedDurableEndpointVersionError,
    );
    assert.equal(fs.readFileSync(filePath, "utf8"), payload);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("endpoint ledger rejects unsafe parents and record files", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wmux-endpoint-security-"));
  const filePath = path.join(directory, "session-endpoints.json");
  try {
    fs.chmodSync(directory, 0o755);
    assert.throws(
      () => new DurableEndpointStore(filePath),
      /parent directory must be owner-only/,
    );

    fs.chmodSync(directory, 0o700);
    new DurableEndpointStore(filePath)
      .bind("pane-one", registeredMachine("100.64.0.10"), "durable-multiplexer");
    fs.chmodSync(filePath, 0o644);
    assert.throws(
      () => new DurableEndpointStore(filePath),
      /permissions must be 0600/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
