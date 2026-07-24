import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { SessionBackend } from "./backends/backend.js";
import type { AttachReplay } from "./terminal-checkpoint.js";

export const CURRENT_TERMINAL_CHECKPOINT_SCHEMA_VERSION = 1;
const CHECKPOINT_WRITE_DEBOUNCE_MS = 200;
const CHECKPOINT_MAX_DELAY_MS = 5_000;
const MAX_CHECKPOINT_BYTES = 4 * 1024 * 1024;
const MAX_CHECKPOINT_FILE_BYTES = MAX_CHECKPOINT_BYTES + 4 * 1024;

type BackendId = SessionBackend["id"];

interface TerminalCheckpointEnvelope {
  schemaVersion: number;
  paneId: string;
  backendId: BackendId;
  capturedAt: string;
  replay: AttachReplay;
}

const checkpointSchema = z.object({
  schemaVersion: z.literal(CURRENT_TERMINAL_CHECKPOINT_SCHEMA_VERSION),
  paneId: z.string().min(1).max(128),
  backendId: z.enum([
    "raw-pty",
    "durable-multiplexer",
    "windows-agent",
  ]),
  capturedAt: z.string().min(1).max(80),
  replay: z.object({
    data: z.string().max(MAX_CHECKPOINT_BYTES),
    kind: z.literal("checkpoint"),
  }).strict(),
}).strict();

export class UnsupportedTerminalCheckpointVersionError extends Error {
  constructor(readonly version: number) {
    super(
      `terminal checkpoint schema ${version} is newer than this wmux build supports (${CURRENT_TERMINAL_CHECKPOINT_SCHEMA_VERSION})`,
    );
    this.name = "UnsupportedTerminalCheckpointVersionError";
  }
}

interface PendingCheckpoint {
  backendId: BackendId;
  capture: () => AttachReplay | undefined;
  firstScheduledAt: number;
  timer: ReturnType<typeof setTimeout>;
}

export class TerminalCheckpointStore {
  private readonly pending = new Map<string, PendingCheckpoint>();

  constructor(
    private readonly directory: string,
    private readonly debounceMs = CHECKPOINT_WRITE_DEBOUNCE_MS,
  ) {}

  schedule(
    paneId: string,
    backendId: BackendId,
    capture: () => AttachReplay | undefined,
  ): void {
    const previous = this.pending.get(paneId);
    if (previous) clearTimeout(previous.timer);
    const firstScheduledAt = previous?.firstScheduledAt ?? Date.now();
    const delayMs = Math.min(
      this.debounceMs,
      Math.max(0, CHECKPOINT_MAX_DELAY_MS - (Date.now() - firstScheduledAt)),
    );
    const timer = setTimeout(
      () => {
        try {
          this.flushPane(paneId);
        } catch (error) {
          console.warn(
            `wmux: failed to persist terminal checkpoint for ${paneId}: ${formatError(error)}`,
          );
        }
      },
      delayMs,
    );
    timer.unref?.();
    this.pending.set(paneId, {
      backendId,
      capture,
      firstScheduledAt,
      timer,
    });
  }

  load(paneId: string, backendId: BackendId): AttachReplay | undefined {
    const checkpointPath = this.checkpointPath(paneId);
    let checkpoint = this.readEnvelope(checkpointPath);
    if (!checkpoint) {
      checkpoint = this.readEnvelope(this.backupPath(paneId));
      if (checkpoint && fs.existsSync(checkpointPath)) {
        const quarantinePath = `${checkpointPath}.corrupt-${new Date()
          .toISOString()
          .replace(/[:.]/g, "-")}`;
        fs.renameSync(checkpointPath, quarantinePath);
      }
    }
    if (!checkpoint) return undefined;
    if (
      checkpoint.paneId !== paneId
      || checkpoint.backendId !== backendId
    ) {
      return undefined;
    }
    return structuredClone(checkpoint.replay);
  }

  delete(paneId: string): void {
    const pending = this.pending.get(paneId);
    if (pending) clearTimeout(pending.timer);
    this.pending.delete(paneId);
    fs.rmSync(this.checkpointPath(paneId), { force: true });
    fs.rmSync(this.backupPath(paneId), { force: true });
  }

  save(
    paneId: string,
    backendId: BackendId,
    replay: AttachReplay | undefined,
  ): void {
    if (
      !replay
      || replay.kind !== "checkpoint"
      || !replay.data
      || Buffer.byteLength(replay.data) > MAX_CHECKPOINT_BYTES
    ) {
      return;
    }
    this.writeEnvelope({
      schemaVersion: CURRENT_TERMINAL_CHECKPOINT_SCHEMA_VERSION,
      paneId,
      backendId,
      capturedAt: new Date().toISOString(),
      replay,
    });
  }

  prune(retainedPaneIds: ReadonlySet<string>): void {
    if (!fs.existsSync(this.directory)) return;
    for (const entry of fs.readdirSync(this.directory, {
      withFileTypes: true,
    })) {
      if (
        !entry.isFile()
        || (
          !entry.name.endsWith(".json")
          && !entry.name.endsWith(".json.bak")
        )
      ) {
        continue;
      }
      const filePath = path.join(this.directory, entry.name);
      let checkpoint: TerminalCheckpointEnvelope | undefined;
      try {
        checkpoint = this.readEnvelope(filePath);
      } catch (error) {
        if (error instanceof UnsupportedTerminalCheckpointVersionError) {
          throw error;
        }
      }
      if (checkpoint && retainedPaneIds.has(checkpoint.paneId)) continue;
      fs.rmSync(filePath, { force: true });
    }
  }

  flush(): void {
    for (const paneId of [...this.pending.keys()]) {
      this.flushPane(paneId);
    }
  }

  dispose(): void {
    this.flush();
  }

  private flushPane(paneId: string): void {
    const pending = this.pending.get(paneId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(paneId);
    this.save(paneId, pending.backendId, pending.capture());
  }

  private readEnvelope(
    filePath: string,
  ): TerminalCheckpointEnvelope | undefined {
    if (!fs.existsSync(filePath)) return undefined;
    try {
      if (fs.statSync(filePath).size > MAX_CHECKPOINT_FILE_BYTES) {
        return undefined;
      }
      const input = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        return undefined;
      }
      const version = (input as Record<string, unknown>).schemaVersion;
      if (
        typeof version === "number"
        && Number.isInteger(version)
        && version > CURRENT_TERMINAL_CHECKPOINT_SCHEMA_VERSION
      ) {
        throw new UnsupportedTerminalCheckpointVersionError(version);
      }
      return checkpointSchema.parse(input);
    } catch (error) {
      if (error instanceof UnsupportedTerminalCheckpointVersionError) {
        throw error;
      }
      return undefined;
    }
  }

  private writeEnvelope(checkpoint: TerminalCheckpointEnvelope): void {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(this.directory, 0o700);
    const checkpointPath = this.checkpointPath(checkpoint.paneId);
    const temporaryPath = `${checkpointPath}.tmp`;
    try {
      const handle = fs.openSync(temporaryPath, "w", 0o600);
      try {
        fs.writeFileSync(handle, JSON.stringify(checkpoint));
        fs.fsyncSync(handle);
      } finally {
        fs.closeSync(handle);
      }
      fs.chmodSync(temporaryPath, 0o600);
      if (fs.existsSync(checkpointPath)) {
        fs.copyFileSync(checkpointPath, this.backupPath(checkpoint.paneId));
        fs.chmodSync(this.backupPath(checkpoint.paneId), 0o600);
      }
      fs.renameSync(temporaryPath, checkpointPath);
    } catch (error) {
      fs.rmSync(temporaryPath, { force: true });
      throw error;
    }
  }

  private checkpointPath(paneId: string): string {
    return path.join(this.directory, `${paneFileName(paneId)}.json`);
  }

  private backupPath(paneId: string): string {
    return `${this.checkpointPath(paneId)}.bak`;
  }
}

const paneFileName = (paneId: string): string =>
  crypto.createHash("sha256").update(paneId).digest("hex");

const formatError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
