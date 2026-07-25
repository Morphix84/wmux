import assert from "node:assert/strict";
import test from "node:test";
import { TERMINAL_COLOR_SCHEME_IDS } from "../src/shared/protocol.js";
import { colorSchemeById, colorSchemeCssVariables, terminalColorSchemes } from "../src/client/src/color-schemes.js";

const requiredThemeColors = [
  "background", "foreground", "cursor", "cursorAccent", "selectionBackground", "selectionForeground",
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
] as const;

test("color scheme catalog covers every persisted scheme id", () => {
  assert.deepEqual(terminalColorSchemes.map((scheme) => scheme.id), [...TERMINAL_COLOR_SCHEME_IDS]);
  assert.equal(new Set(terminalColorSchemes.map((scheme) => scheme.name)).size, terminalColorSchemes.length);
});

test("color schemes provide complete terminal and chrome palettes", () => {
  for (const scheme of terminalColorSchemes) {
    assert.equal(colorSchemeById(scheme.id), scheme);
    assert.equal(scheme.chrome.black, scheme.terminal.background, `${scheme.id} app and terminal backgrounds`);
    assert.equal(scheme.chrome.text, scheme.terminal.foreground, `${scheme.id} app and terminal foregrounds`);
    const variables = colorSchemeCssVariables(scheme);
    assert.equal(variables["--black"], scheme.terminal.background);
    assert.equal(variables["--gold"], scheme.chrome.gold);
    assert.equal(variables["--selection"], scheme.chrome.selection);
    assert.equal(variables["--selection-text"], scheme.chrome.selectionText);
    assert.equal(variables["--terminal-background"], scheme.terminal.background);
    assert.equal(variables["--terminal-foreground"], scheme.terminal.foreground);
    assert.equal(variables["--wmux-browser-chrome"], scheme.terminal.background);
    for (const key of requiredThemeColors) assert.match(scheme.terminal[key], /^#[0-9a-f]{6}$/i, `${scheme.id}.${key}`);
    for (const [key, value] of Object.entries(scheme.chrome)) assert.match(value, /^#[0-9a-f]{6}$/i, `${scheme.id}.${key}`);
  }
});
