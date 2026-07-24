import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  KittyGraphicsSourceError,
  posixKittyGraphicsReadScript,
  powershellKittyGraphicsReadScript,
  readLocalSource,
} from "../src/server/kitty-graphics-source.js";

test("local Kitty file sources honor byte ranges", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wmux-kitty-"));
  const source = path.join(directory, "image.rgba");
  fs.writeFileSync(source, Buffer.from([0, 1, 2, 3, 4, 5]));
  try {
    assert.deepEqual(
      await readLocalSource({ medium: "f", source, offset: 2, size: 3 }),
      Buffer.from([2, 3, 4]),
    );
    assert.equal(fs.existsSync(source), true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("temporary Kitty sources require the protocol marker and are removed after reading", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tty-graphics-protocol-"));
  const source = path.join(directory, "image.rgba");
  fs.writeFileSync(source, Buffer.from([9, 8, 7]));
  try {
    assert.deepEqual(await readLocalSource({ medium: "t", source }), Buffer.from([9, 8, 7]));
    assert.equal(fs.existsSync(source), false);
    await assert.rejects(
      readLocalSource({ medium: "t", source: path.join(os.tmpdir(), "unmarked.rgba") }),
      (error: unknown) => error instanceof KittyGraphicsSourceError
        && error.code === "kitty_temporary_source_unsafe",
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("POSIX shared-memory Kitty sources are read once and unlinked", async (context) => {
  if (process.platform !== "linux" || !fs.existsSync("/dev/shm")) {
    context.skip("POSIX shared memory is available on Linux");
    return;
  }
  const name = `/wmux-kitty-${process.pid}-${Date.now()}`;
  const source = path.join("/dev/shm", name.slice(1));
  fs.writeFileSync(source, Buffer.from([4, 3, 2, 1]), { flag: "wx" });
  try {
    assert.deepEqual(
      await readLocalSource({ medium: "s", source: name }),
      Buffer.from([4, 3, 2, 1]),
    );
    assert.equal(fs.existsSync(source), false);
  } finally {
    fs.rmSync(source, { force: true });
  }
});

test("local Kitty sources reject directories and oversized ranges", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wmux-kitty-"));
  try {
    await assert.rejects(
      readLocalSource({ medium: "f", source: directory }),
      (error: unknown) => error instanceof KittyGraphicsSourceError
        && error.code === "kitty_source_not_regular",
    );
    await assert.rejects(
      readLocalSource({ medium: "f", source: path.join(directory, "missing"), size: 33 * 1024 * 1024 }),
      (error: unknown) => error instanceof KittyGraphicsSourceError
        && error.code === "kitty_source_too_large",
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Kitty source validation rejects malformed transport values", async () => {
  await assert.rejects(
    readLocalSource({ medium: "f", source: 42 } as unknown as Parameters<typeof readLocalSource>[0]),
    (error: unknown) => error instanceof KittyGraphicsSourceError
      && error.code === "kitty_source_invalid",
  );
  await assert.rejects(
    readLocalSource({
      medium: "f",
      source: "/tmp/example",
      size: "1",
    } as unknown as Parameters<typeof readLocalSource>[0]),
    (error: unknown) => error instanceof KittyGraphicsSourceError
      && error.code === "kitty_source_range_invalid",
  );
});

test("remote source scripts are quoted, bounded, profile-free, and delete only approved temporary files", () => {
  const posix = posixKittyGraphicsReadScript({
    medium: "t",
    source: "/tmp/tty-graphics-protocol/image with ' quote.rgba",
    offset: 4,
    size: 20,
  });
  assert.match(posix, /test ! -L/);
  assert.match(posix, /skip=4 count="\$wmux_count"/);
  assert.match(posix, /rm -f "\$wmux_source"/);

  const powershell = powershellKittyGraphicsReadScript({
    medium: "f",
    source: "C:\\Temp\\tty-graphics-protocol\\image.rgba",
    size: 20,
  });
  assert.match(powershell, /FileMode]::Open/);
  assert.match(powershell, /ReparsePoint/);
  assert.match(powershell, /while \(\$Read -lt \$Buffer\.Length\)/);
  assert.doesNotMatch(powershell, /Remove-Item/);
});
