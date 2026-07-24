import assert from "node:assert/strict";
import test from "node:test";
import { init, Terminal } from "ghostty-web/headless";
import {
  TerminalGraphicsParser,
  encodeKittyDirect,
  normalizeKittyTransfer,
} from "../src/client/src/kitty-graphics.js";

test("supported direct Kitty controls pass through byte-for-byte", () => {
  const parser = new TerminalGraphicsParser();
  const sequence = "\x1b_Ga=T,f=32,s=1,v=1,i=7,p=8,z=-2;AQIDBA==\x1b\\";
  assert.deepEqual(parser.push(`before${sequence}after`), [
    { kind: "text", text: "before" },
    { kind: "text", text: sequence },
    { kind: "text", text: "after" },
  ]);
});

test("Kitty PNG and source transfers assemble across stream boundaries", () => {
  const parser = new TerminalGraphicsParser();
  assert.deepEqual(parser.push("\x1b"), []);
  assert.deepEqual(parser.push("_Ga=T,f=100,t=f,i=9,z=-4,m=1;L3Rt"), []);
  assert.deepEqual(parser.push("cC90dHktZ3JhcGhpY3MtcHJvdG9jb2wvaW1nLnBuZw==\x1b\\"), []);
  assert.deepEqual(parser.push("\x1b_Gm=0;\x1b\\"), [{
    kind: "kitty",
    transfer: {
      control: { a: "T", f: "100", t: "f", i: "9", z: "-4" },
      payloadBase64: "L3RtcC90dHktZ3JhcGhpY3MtcHJvdG9jb2wvaW1nLnBuZw==",
    },
  }]);
});

test("source transfers become bounded direct transfers while preserving placement controls", async () => {
  const normalized = await normalizeKittyTransfer(
    {
      control: { a: "T", f: "32", t: "s", i: "41", p: "5", z: "-7", U: "1", c: "2", r: "3", S: "4", O: "1" },
      payloadBase64: btoa("/wmux-test"),
    },
    async (request) => {
      assert.deepEqual(request, {
        medium: "s",
        source: "/wmux-test",
        size: 4,
        offset: 1,
      });
      return Uint8Array.from([1, 2, 3, 4]);
    },
  );
  assert.match(normalized, /^\x1b_Ga=T,f=32,i=41,p=5,z=-7,U=1,c=2,r=3,t=d;AQIDBA==\x1b\\$/);
});

test("PNG transfers normalize to RGBA and retain signed z-index", async () => {
  const normalized = await normalizeKittyTransfer(
    {
      control: { a: "T", f: "100", i: "12", z: "-2147483648" },
      payloadBase64: "iVBORw==",
    },
    async () => {
      throw new Error("direct transfer must not read a source");
    },
    async () => ({
      width: 1,
      height: 1,
      rgba: Uint8Array.from([255, 0, 128, 255]),
    }),
  );
  assert.equal(
    normalized,
    "\x1b_Ga=T,f=32,i=12,z=-2147483648,s=1,v=1,t=d;/wCA/w==\x1b\\",
  );
});

test("large direct transfers use Kitty-compliant chunks", () => {
  const encoded = encodeKittyDirect({ a: "T", f: "32", i: "3" }, new Uint8Array(8_000));
  const sequences = encoded.match(/\x1b_G.*?\x1b\\/g) ?? [];
  assert.ok(sequences.length > 1);
  assert.match(sequences[0], /^.?\x1b_Ga=T,f=32,i=3,t=d,m=1;/);
  assert.match(sequences.at(-1) ?? "", /^\x1b_Gm=0;/);
  for (const sequence of sequences) {
    const payload = sequence.slice(sequence.indexOf(";") + 1, -2);
    assert.ok(payload.length <= 4096);
    assert.equal(payload.length % 4, 0);
  }
});

test("Sixel and iTerm2 images produce visible diagnostic events instead of terminal noise", () => {
  const parser = new TerminalGraphicsParser();
  assert.deepEqual(parser.push("a\x1bPq~\x1b\\b\x1b]1337;File=name=x:aGVsbG8=\x07c"), [
    { kind: "text", text: "a" },
    {
      kind: "diagnostic",
      diagnostic: {
        protocol: "sixel",
        message: "Sixel graphics are unsupported. Use Kitty graphics or wmux-media.",
      },
    },
    { kind: "text", text: "b" },
    {
      kind: "diagnostic",
      diagnostic: {
        protocol: "iterm2",
        message: "iTerm2 inline images are unsupported. Use Kitty graphics or wmux-media.",
      },
    },
    { kind: "text", text: "c" },
  ]);
});

test("tmux passthrough is unwrapped before terminal graphics detection", () => {
  const parser = new TerminalGraphicsParser();
  const wrappedSixel = "\x1bPtmux;\x1b\x1bPq~\x1b\x1b\\\x1b\\";
  assert.deepEqual(parser.push(wrappedSixel), [{
    kind: "diagnostic",
    diagnostic: {
      protocol: "sixel",
      message: "Sixel graphics are unsupported. Use Kitty graphics or wmux-media.",
    },
  }]);

  const direct = "\x1b_Ga=T,f=32,s=1,v=1;AQIDBA==\x1b\\";
  const wrappedKitty = `\x1bPtmux;${direct.replaceAll("\x1b", "\x1b\x1b")}\x1b\\`;
  assert.deepEqual(parser.push(wrappedKitty), [{ kind: "text", text: direct }]);
});

test("Ghostty retains Kitty placements across scrollback with native virtual placement metadata", async () => {
  Object.assign(globalThis, { self: globalThis });
  await init();
  const terminal = new Terminal({ cols: 8, rows: 3, scrollback: 20 });
  try {
    terminal.write(encodeKittyDirect(
      { a: "T", f: "32", s: "1", v: "1", i: "77", p: "2", c: "1", r: "1", z: "-3" },
      Uint8Array.from([255, 0, 0, 255]),
    ));
    terminal.write("\r\none\r\ntwo\r\nthree\r\nfour");
    const graphics = terminal.wasmTerm?.getKittyGraphics();
    assert.ok(graphics);
    const placements = [...(terminal.wasmTerm?.iterPlacements(graphics, false) ?? [])];
    assert.equal(placements.length, 1);
    assert.equal(placements[0].imageId, 77);
    assert.equal(placements[0].gridCols, 1);
    assert.equal(placements[0].gridRows, 1);
    assert.equal(placements[0].viewportVisible, false);
    const pixels = terminal.wasmTerm?.getKittyImagePixels(graphics, 77);
    assert.deepEqual(Array.from(pixels?.data ?? []), [255, 0, 0, 255]);

    terminal.write(encodeKittyDirect(
      { a: "T", f: "32", s: "1", v: "1", i: "78", p: "3", U: "1", c: "1", r: "1", z: "4" },
      Uint8Array.from([0, 255, 0, 255]),
    ));
    const virtual = [...(terminal.wasmTerm?.iterPlacements(graphics, false) ?? [])]
      .find((placement) => placement.imageId === 78);
    assert.equal(virtual?.isVirtual, true);
  } finally {
    terminal.dispose();
  }
});
