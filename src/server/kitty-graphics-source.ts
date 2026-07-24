import { constants as fsConstants, promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import type { MachineConfig } from "./types.js";
import { sshControlOnlyArgs, sshControlPath } from "./ssh-control.js";

export const MAX_KITTY_GRAPHICS_SOURCE_BYTES = 32 * 1024 * 1024;

export interface KittyGraphicsSourceRequest {
  medium: "f" | "t" | "s";
  source: string;
  size?: number;
  offset?: number;
}

export class KittyGraphicsSourceError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

export const readKittyGraphicsSource = async (
  machine: MachineConfig,
  paneId: string,
  request: KittyGraphicsSourceRequest,
): Promise<Buffer> => {
  validateRequest(request);
  if (machine.kind === "local") return readLocalSource(request);
  if (machine.kind === "ssh") return readSshSource(machine, paneId, request, false);
  if (machine.kind === "powershell-ssh") {
    if (request.medium === "s") {
      throw new KittyGraphicsSourceError(422, "kitty_shared_memory_unsupported");
    }
    return readSshSource(machine, paneId, request, true);
  }
  throw new KittyGraphicsSourceError(422, "kitty_graphics_source_unsupported");
};

export const readLocalSource = async (request: KittyGraphicsSourceRequest): Promise<Buffer> => {
  validateRequest(request);
  const sourcePath = request.medium === "s"
    ? localSharedMemoryPath(request.source)
    : request.source;
  if (!path.isAbsolute(sourcePath)) {
    throw new KittyGraphicsSourceError(400, "kitty_source_not_absolute");
  }
  if (request.medium === "t" && !isSafeTemporaryPath(sourcePath)) {
    throw new KittyGraphicsSourceError(400, "kitty_temporary_source_unsafe");
  }

  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    const noFollow = "O_NOFOLLOW" in fsConstants ? fsConstants.O_NOFOLLOW : 0;
    handle = await fs.open(sourcePath, fsConstants.O_RDONLY | noFollow);
    const stat = await handle.stat();
    if (!stat.isFile()) throw new KittyGraphicsSourceError(400, "kitty_source_not_regular");
    const range = sourceRange(stat.size, request);
    const buffer = Buffer.allocUnsafe(range.length);
    const result = await handle.read(buffer, 0, range.length, range.offset);
    if (result.bytesRead !== range.length) {
      throw new KittyGraphicsSourceError(409, "kitty_source_changed");
    }
    await handle.close();
    handle = undefined;
    if (request.medium === "t" || request.medium === "s") {
      await fs.unlink(sourcePath);
    }
    return buffer;
  } catch (error) {
    if (error instanceof KittyGraphicsSourceError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    throw new KittyGraphicsSourceError(code === "ENOENT" ? 404 : 422, "kitty_source_read_failed");
  } finally {
    await handle?.close().catch(() => undefined);
  }
};

export const posixKittyGraphicsReadScript = (request: KittyGraphicsSourceRequest): string => {
  validateRequest(request);
  const source = request.medium === "s" ? posixSharedMemoryPath(request.source) : request.source;
  if (!source.startsWith("/")) throw new KittyGraphicsSourceError(400, "kitty_source_not_absolute");
  if (request.medium === "t" && !isSafeTemporaryPath(source)) {
    throw new KittyGraphicsSourceError(400, "kitty_temporary_source_unsafe");
  }
  const offset = request.offset ?? 0;
  const requestedSize = request.size;
  const size = requestedSize ?? MAX_KITTY_GRAPHICS_SOURCE_BYTES;
  const remove = request.medium === "t" || request.medium === "s";
  return `set -eu
wmux_source=${shellQuote(source)}
test -f "$wmux_source" && test ! -L "$wmux_source"
wmux_size=$(wc -c < "$wmux_source")
test "$wmux_size" -ge ${offset}
${requestedSize === undefined ? `test $((wmux_size - ${offset})) -le ${MAX_KITTY_GRAPHICS_SOURCE_BYTES}` : ":"}
wmux_count=${size}
if [ "$wmux_count" -gt $((wmux_size - ${offset})) ]; then wmux_count=$((wmux_size - ${offset})); fi
test "$wmux_count" -le ${MAX_KITTY_GRAPHICS_SOURCE_BYTES}
dd if="$wmux_source" bs=1 skip=${offset} count="$wmux_count" 2>/dev/null
${remove ? 'rm -f "$wmux_source"' : ":"}
`;
};

export const powershellKittyGraphicsReadScript = (request: KittyGraphicsSourceRequest): string => {
  validateRequest(request);
  if (request.medium === "s") {
    throw new KittyGraphicsSourceError(422, "kitty_shared_memory_unsupported");
  }
  if (!/^[A-Za-z]:[\\/]/.test(request.source)) {
    throw new KittyGraphicsSourceError(400, "kitty_source_not_absolute");
  }
  if (request.medium === "t" && !isSafeTemporaryPath(request.source)) {
    throw new KittyGraphicsSourceError(400, "kitty_temporary_source_unsafe");
  }
  const encodedPath = Buffer.from(request.source, "utf8").toString("base64");
  const offset = request.offset ?? 0;
  const size = request.size ?? MAX_KITTY_GRAPHICS_SOURCE_BYTES;
  const remove = request.medium === "t";
  return `
$ErrorActionPreference='Stop'
$Path=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPath}'))
$Item=Get-Item -LiteralPath $Path -Force
if ($Item.PSIsContainer -or ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'not a regular file' }
$Stream=[IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
try {
  if ($Stream.Length -lt ${offset}) { throw 'invalid offset' }
  $Stream.Position=${offset}
  $Count=[Math]::Min([Int64]${size},$Stream.Length-${offset})
  if ($Count -gt ${MAX_KITTY_GRAPHICS_SOURCE_BYTES}) { throw 'source too large' }
  $Buffer=New-Object byte[] ([int]$Count)
  $Read=0
  while ($Read -lt $Buffer.Length) {
    $Chunk=$Stream.Read($Buffer,$Read,$Buffer.Length-$Read)
    if ($Chunk -eq 0) { throw 'source changed' }
    $Read+=$Chunk
  }
  [Console]::OpenStandardOutput().Write($Buffer,0,$Buffer.Length)
} finally { $Stream.Dispose() }
${remove ? "Remove-Item -LiteralPath $Path -Force" : ""}
`;
};

const readSshSource = async (
  machine: MachineConfig,
  paneId: string,
  request: KittyGraphicsSourceRequest,
  powershell: boolean,
): Promise<Buffer> => {
  await requireSshControl(machine, paneId);
  const args = ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", ...sshControlOnlyArgs(paneId)];
  if (machine.port) args.push("-p", String(machine.port));
  args.push(sshTarget(machine));
  if (powershell) {
    args.push(
      machine.shell ?? "pwsh",
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(powershellKittyGraphicsReadScript(request), "utf16le").toString("base64"),
    );
  } else {
    args.push(`exec /bin/sh -c ${shellQuote(posixKittyGraphicsReadScript(request))}`);
  }
  return runSshRead(args);
};

const runSshRead = (args: string[]): Promise<Buffer> => new Promise((resolve, reject) => {
  const child = spawn("ssh", args, { stdio: ["ignore", "pipe", "ignore"] });
  const chunks: Buffer[] = [];
  let bytes = 0;
  let settled = false;
  const finish = (error?: Error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (error) reject(error);
    else resolve(Buffer.concat(chunks));
  };
  const timer = setTimeout(() => {
    child.kill("SIGTERM");
    finish(new KittyGraphicsSourceError(504, "kitty_source_read_timeout"));
  }, 20_000);
  child.stdout.on("data", (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > MAX_KITTY_GRAPHICS_SOURCE_BYTES) {
      child.kill("SIGTERM");
      finish(new KittyGraphicsSourceError(413, "kitty_source_too_large"));
      return;
    }
    chunks.push(Buffer.from(chunk));
  });
  child.once("error", () => finish(new KittyGraphicsSourceError(502, "kitty_source_read_failed")));
  child.once("close", (code) => finish(code === 0
    ? undefined
    : new KittyGraphicsSourceError(422, "kitty_source_read_failed")));
});

const validateRequest = (request: KittyGraphicsSourceRequest): void => {
  if (typeof request.medium !== "string" || !["f", "t", "s"].includes(request.medium)) {
    throw new KittyGraphicsSourceError(400, "kitty_source_medium_invalid");
  }
  if (
    typeof request.source !== "string"
    || !request.source
    || request.source.length > 4096
    || /[\x00-\x1f\x7f-\x9f]/.test(request.source)
  ) {
    throw new KittyGraphicsSourceError(400, "kitty_source_invalid");
  }
  for (const value of [request.size, request.offset]) {
    if (
      value !== undefined
      && (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    ) {
      throw new KittyGraphicsSourceError(400, "kitty_source_range_invalid");
    }
  }
  if ((request.size ?? 0) > MAX_KITTY_GRAPHICS_SOURCE_BYTES) {
    throw new KittyGraphicsSourceError(413, "kitty_source_too_large");
  }
};

const sourceRange = (
  fileSize: number,
  request: KittyGraphicsSourceRequest,
): { offset: number; length: number } => {
  const offset = request.offset ?? 0;
  if (offset > fileSize) throw new KittyGraphicsSourceError(400, "kitty_source_range_invalid");
  const available = fileSize - offset;
  const length = Math.min(request.size ?? available, available);
  if (length > MAX_KITTY_GRAPHICS_SOURCE_BYTES) {
    throw new KittyGraphicsSourceError(413, "kitty_source_too_large");
  }
  return { offset, length };
};

const posixSharedMemoryPath = (name: string): string => {
  if (!/^\/[A-Za-z0-9._-]{1,255}$/.test(name)) {
    throw new KittyGraphicsSourceError(422, "kitty_shared_memory_unsupported");
  }
  return path.posix.join("/dev/shm", name.slice(1));
};

const localSharedMemoryPath = (name: string): string => {
  if (process.platform !== "linux") {
    throw new KittyGraphicsSourceError(422, "kitty_shared_memory_unsupported");
  }
  return posixSharedMemoryPath(name);
};

const isSafeTemporaryPath = (source: string): boolean => {
  const normalized = source.replaceAll("\\", "/").toLowerCase();
  const temporaryRoots = [
    os.tmpdir().replaceAll("\\", "/").toLowerCase(),
    "/tmp",
    "/var/tmp",
    process.env.TMPDIR?.replaceAll("\\", "/").toLowerCase(),
    process.env.TEMP?.replaceAll("\\", "/").toLowerCase(),
  ].filter((value): value is string => Boolean(value));
  return normalized.includes("tty-graphics-protocol")
    && (
      temporaryRoots.some((root) => normalized === root || normalized.startsWith(`${root}/`))
      || /\/(?:tmp|temp)\//.test(normalized)
    );
};

const requireSshControl = async (machine: MachineConfig, paneId: string): Promise<void> => {
  const deadline = Date.now() + 3000;
  do {
    if (await checkSshControl(machine, paneId)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  throw new KittyGraphicsSourceError(409, "kitty_source_pane_not_attached");
};

const checkSshControl = (machine: MachineConfig, paneId: string): Promise<boolean> => new Promise((resolve) => {
  const args = ["-S", sshControlPath(paneId), "-O", "check"];
  if (machine.port) args.push("-p", String(machine.port));
  args.push(sshTarget(machine));
  const child = spawn("ssh", args, { stdio: "ignore" });
  let settled = false;
  const finish = (result: boolean) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolve(result);
  };
  const timer = setTimeout(() => {
    child.kill("SIGTERM");
    finish(false);
  }, 750);
  child.once("error", () => finish(false));
  child.once("close", (code) => finish(code === 0));
});

const sshTarget = (machine: MachineConfig): string => {
  if (!machine.host) throw new KittyGraphicsSourceError(422, "kitty_source_host_missing");
  return machine.user ? `${machine.user}@${machine.host}` : machine.host;
};

const shellQuote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;
