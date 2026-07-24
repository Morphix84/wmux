export type TerminalGraphicsDiagnosticProtocol = "kitty" | "sixel" | "iterm2";

export interface TerminalGraphicsDiagnostic {
  protocol: TerminalGraphicsDiagnosticProtocol;
  message: string;
}

export interface KittyGraphicsSourceRequest {
  medium: "f" | "t" | "s";
  source: string;
  size?: number;
  offset?: number;
}

export interface KittyGraphicsTransfer {
  control: Record<string, string>;
  payloadBase64: string;
}

export type TerminalGraphicsParseEvent =
  | { kind: "text"; text: string }
  | { kind: "kitty"; transfer: KittyGraphicsTransfer }
  | { kind: "diagnostic"; diagnostic: TerminalGraphicsDiagnostic };

interface PendingTransfer {
  control: Record<string, string>;
  payloadParts: string[];
  payloadChars: number;
}

const KITTY_START = "\x1b_G";
const ITERM2_START = "\x1b]1337;File=";
const DCS_START = "\x1bP";
const ST = "\x1b\\";
const BEL = "\x07";
const MAX_CARRY_CHARS = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_IMAGE_BASE64_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
const KITTY_CHUNK_BASE64_CHARS = 4096;

export class TerminalGraphicsParser {
  private carry = "";
  private transfer: PendingTransfer | null = null;

  push(data: string): TerminalGraphicsParseEvent[] {
    const events: TerminalGraphicsParseEvent[] = [];
    let input = this.carry + data;
    this.carry = "";

    while (input.length > 0) {
      const candidate = nextProtocolStart(input);
      if (!candidate) {
        const partialLength = trailingProtocolPrefixLength(input);
        const text = partialLength > 0 ? input.slice(0, -partialLength) : input;
        if (text) events.push({ kind: "text", text });
        if (partialLength > 0) this.carry = input.slice(-partialLength);
        break;
      }
      if (candidate.index > 0) {
        events.push({ kind: "text", text: input.slice(0, candidate.index) });
        input = input.slice(candidate.index);
      }

      const bodyStart = candidate.start.length;
      const end = findTerminator(input, bodyStart, candidate.protocol);
      if (!end) {
        this.carry = input.slice(0, MAX_CARRY_CHARS);
        break;
      }
      if (end.index > MAX_CARRY_CHARS) {
        events.push({
          kind: "diagnostic",
          diagnostic: {
            protocol: candidate.protocol,
            message: "terminal graphics control sequence exceeds 2 MiB",
          },
        });
        input = input.slice(end.index + end.length);
        continue;
      }
      const raw = input.slice(0, end.index + end.length);
      const body = input.slice(bodyStart, end.index);
      input = input.slice(end.index + end.length);

      if (candidate.protocol === "sixel" && body.startsWith("tmux;")) {
        const nested = body.slice("tmux;".length).replaceAll("\x1b\x1b", "\x1b");
        events.push(...this.push(nested));
        continue;
      }
      if (candidate.protocol === "iterm2") {
        events.push({
          kind: "diagnostic",
          diagnostic: {
            protocol: "iterm2",
            message: "iTerm2 inline images are unsupported. Use Kitty graphics or wmux-media.",
          },
        });
        continue;
      }
      if (candidate.protocol === "sixel") {
        if (/^[0-9;?]*q/.test(body)) {
          events.push({
            kind: "diagnostic",
            diagnostic: {
              protocol: "sixel",
              message: "Sixel graphics are unsupported. Use Kitty graphics or wmux-media.",
            },
          });
        } else {
          events.push({ kind: "text", text: raw });
        }
        continue;
      }
      this.pushKitty(raw, body, events);
    }

    return events;
  }

  reset(): void {
    this.carry = "";
    this.transfer = null;
  }

  private pushKitty(raw: string, body: string, events: TerminalGraphicsParseEvent[]): void {
    const semicolon = body.indexOf(";");
    const control = parseControl(semicolon === -1 ? body : body.slice(0, semicolon));
    const payload = semicolon === -1 ? "" : body.slice(semicolon + 1).replace(/\s+/g, "");
    const shouldNormalize = this.transfer !== null
      || control.f === "100"
      || ["f", "t", "s"].includes(control.t ?? "");

    if (!shouldNormalize) {
      events.push({ kind: "text", text: raw });
      return;
    }

    if (control.m === "1") {
      if (!this.transfer) {
        this.transfer = { control, payloadParts: [payload], payloadChars: payload.length };
      } else {
        this.transfer.payloadParts.push(payload);
        this.transfer.payloadChars += payload.length;
      }
      if (this.transfer.payloadChars > MAX_IMAGE_BASE64_CHARS) {
        this.transfer = null;
        events.push({
          kind: "diagnostic",
          diagnostic: { protocol: "kitty", message: "Kitty image exceeds 32 MiB" },
        });
      }
      return;
    }

    if (this.transfer) {
      this.transfer.payloadParts.push(payload);
      this.transfer.payloadChars += payload.length;
      if (this.transfer.payloadChars > MAX_IMAGE_BASE64_CHARS) {
        this.transfer = null;
        events.push({
          kind: "diagnostic",
          diagnostic: { protocol: "kitty", message: "Kitty image exceeds 32 MiB" },
        });
        return;
      }
      const merged = { ...this.transfer.control, ...control };
      delete merged.m;
      events.push({
        kind: "kitty",
        transfer: { control: merged, payloadBase64: this.transfer.payloadParts.join("") },
      });
      this.transfer = null;
      return;
    }

    events.push({ kind: "kitty", transfer: { control, payloadBase64: payload } });
  }
}

export const normalizeKittyTransfer = async (
  transfer: KittyGraphicsTransfer,
  readSource: (request: KittyGraphicsSourceRequest) => Promise<Uint8Array>,
  decodePng: (bytes: Uint8Array) => Promise<{ width: number; height: number; rgba: Uint8Array }> = decodePngToRgba,
): Promise<string> => {
  const control = { ...transfer.control };
  const medium = control.t ?? "d";
  let bytes: Uint8Array;

  if (medium === "d") {
    bytes = base64ToBytes(transfer.payloadBase64);
  } else if (medium === "f" || medium === "t" || medium === "s") {
    const source = decodeSourceName(transfer.payloadBase64);
    bytes = await readSource({
      medium,
      source,
      size: parseNonNegativeInt(control.S),
      offset: parseNonNegativeInt(control.O),
    });
  } else {
    throw new Error(`unsupported Kitty transmission medium: ${medium}`);
  }

  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("Kitty image exceeds 32 MiB");
  if (control.o === "z") {
    bytes = await decompressZlib(bytes);
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("Kitty image exceeds 32 MiB");
  }

  delete control.t;
  delete control.S;
  delete control.O;
  delete control.m;
  if (control.o === "z") delete control.o;

  if (control.f === "100") {
    const decoded = await decodePng(bytes);
    if (
      !Number.isSafeInteger(decoded.width)
      || !Number.isSafeInteger(decoded.height)
      || decoded.width <= 0
      || decoded.height <= 0
      || decoded.width * decoded.height * 4 > MAX_IMAGE_BYTES
      || decoded.rgba.byteLength !== decoded.width * decoded.height * 4
    ) {
      throw new Error("decoded Kitty PNG exceeds 32 MiB or has invalid dimensions");
    }
    bytes = decoded.rgba;
    control.f = "32";
    control.s = String(decoded.width);
    control.v = String(decoded.height);
  }

  return encodeKittyDirect(control, bytes);
};

export const kittyErrorResponse = (
  transfer: KittyGraphicsTransfer,
  message: string,
): string | null => {
  const imageId = transfer.control.i;
  const quiet = transfer.control.q ?? "";
  if (!imageId || quiet === "2") return null;
  return `\x1b_Gi=${imageId};EINVAL: ${message}\x1b\\`;
};

export const encodeKittyDirect = (
  control: Record<string, string>,
  bytes: Uint8Array,
): string => {
  const payload = bytesToBase64(bytes);
  const parts = payload.match(new RegExp(`.{1,${KITTY_CHUNK_BASE64_CHARS}}`, "g")) ?? [""];
  return parts.map((part, index) => {
    const more = index < parts.length - 1 ? "1" : "0";
    const encodedControl = index === 0
      ? stringifyControl({ ...control, t: "d", ...(parts.length > 1 ? { m: more } : {}) })
      : `m=${more}`;
    return `${KITTY_START}${encodedControl};${part}${ST}`;
  }).join("");
};

const nextProtocolStart = (
  value: string,
): { index: number; start: string; protocol: TerminalGraphicsDiagnosticProtocol } | null => {
  const candidates = [
    { index: value.indexOf(KITTY_START), start: KITTY_START, protocol: "kitty" as const },
    { index: value.indexOf(ITERM2_START), start: ITERM2_START, protocol: "iterm2" as const },
    { index: value.indexOf(DCS_START), start: DCS_START, protocol: "sixel" as const },
  ].filter((candidate) => candidate.index >= 0);
  candidates.sort((left, right) => left.index - right.index);
  return candidates[0] ?? null;
};

const trailingProtocolPrefixLength = (value: string): number => {
  const starts = [KITTY_START, ITERM2_START, DCS_START];
  const maximum = Math.min(value.length, Math.max(...starts.map((start) => start.length - 1)));
  for (let length = maximum; length > 0; length -= 1) {
    const suffix = value.slice(-length);
    if (starts.some((start) => start.startsWith(suffix))) return length;
  }
  return 0;
};

const findTerminator = (
  value: string,
  from: number,
  protocol: TerminalGraphicsDiagnosticProtocol,
): { index: number; length: number } | null => {
  if (protocol === "sixel") {
    let st = value.indexOf(ST, from);
    while (st > from && value[st - 1] === "\x1b") st = value.indexOf(ST, st + ST.length);
    return st === -1 ? null : { index: st, length: ST.length };
  }
  const st = value.indexOf(ST, from);
  const bel = value.indexOf(BEL, from);
  if (st === -1 && bel === -1) return null;
  if (st !== -1 && (bel === -1 || st < bel)) return { index: st, length: ST.length };
  return { index: bel, length: BEL.length };
};

const parseControl = (value: string): Record<string, string> => {
  const control: Record<string, string> = {};
  for (const part of value.split(",")) {
    if (!part) continue;
    const equals = part.indexOf("=");
    control[equals === -1 ? part : part.slice(0, equals)] = equals === -1 ? "" : part.slice(equals + 1);
  }
  return control;
};

const stringifyControl = (control: Record<string, string>): string =>
  Object.entries(control).map(([key, value]) => `${key}=${value}`).join(",");

const parseNonNegativeInt = (value?: string): number | undefined => {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw new Error("invalid Kitty source range");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("invalid Kitty source range");
  return parsed;
};

const decodeSourceName = (payload: string): string => {
  const bytes = base64ToBytes(payload);
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (!source || source.length > 4096 || /[\x00-\x1f\x7f-\x9f]/.test(source)) {
    throw new Error("invalid Kitty source name");
  }
  return source;
};

const base64ToBytes = (value: string): Uint8Array => {
  if (value.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error("invalid Kitty base64 payload");
  }
  const decoded = atob(value);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return bytes;
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.slice(offset, offset + 0x8000));
  }
  return btoa(binary);
};

const decompressZlib = async (bytes: Uint8Array): Promise<Uint8Array> => {
  if (!("DecompressionStream" in globalThis)) throw new Error("zlib decompression is unavailable");
  const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const stream = new Blob([source]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

const decodePngToRgba = async (
  bytes: Uint8Array,
): Promise<{ width: number; height: number; rgba: Uint8Array }> => {
  if (!("createImageBitmap" in globalThis)) throw new Error("PNG decoding is unavailable");
  if (
    bytes.byteLength < 24
    || !bytes.slice(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index])
  ) {
    throw new Error("invalid Kitty PNG");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declaredWidth = view.getUint32(16);
  const declaredHeight = view.getUint32(20);
  if (
    declaredWidth === 0
    || declaredHeight === 0
    || declaredWidth * declaredHeight * 4 > MAX_IMAGE_BYTES
  ) {
    throw new Error("Kitty PNG exceeds 32 MiB or has invalid dimensions");
  }
  const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const bitmap = await createImageBitmap(new Blob([source], { type: "image/png" }));
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("PNG canvas is unavailable");
    context.drawImage(bitmap, 0, 0);
    const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
    return {
      width: bitmap.width,
      height: bitmap.height,
      rgba: new Uint8Array(image.data.buffer.slice(0)),
    };
  } finally {
    bitmap.close();
  }
};
