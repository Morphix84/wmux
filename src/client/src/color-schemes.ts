import type { ITheme } from "ghostty-web";
import type { TerminalColorSchemeId } from "./types";
import { terminalThemeById } from "../../shared/terminal-themes";

export interface WmuxChromeColors {
  black: string;
  panel: string;
  panel2: string;
  panel3: string;
  active: string;
  activeSoft: string;
  selection: string;
  selectionText: string;
  line: string;
  lineBright: string;
  gold: string;
  goldDim: string;
  text: string;
  muted: string;
  faint: string;
  red: string;
  green: string;
  blue: string;
  agent: string;
  runningSoft: string;
  failedSoft: string;
}

export interface TerminalColorScheme {
  id: TerminalColorSchemeId;
  name: string;
  terminal: Required<ITheme>;
  chrome: WmuxChromeColors;
}

type SchemeInput = {
  id: TerminalColorSchemeId;
  name: string;
  accent: string;
  terminal: Required<ITheme>;
};

const scheme = ({ id, name, accent, terminal }: SchemeInput): TerminalColorScheme => ({
  id,
  name,
  terminal,
  chrome: {
    black: terminal.background,
    panel: mix(terminal.background, terminal.foreground, 0.035),
    panel2: mix(terminal.background, terminal.foreground, 0.065),
    panel3: mix(terminal.background, terminal.foreground, 0.1),
    active: mix(terminal.background, accent, 0.14),
    activeSoft: mix(terminal.background, accent, 0.075),
    selection: accent,
    selectionText: terminal.background,
    line: mix(terminal.background, terminal.foreground, 0.18),
    lineBright: mix(terminal.background, accent, 0.72),
    gold: accent,
    goldDim: mix(terminal.background, accent, 0.68),
    text: terminal.foreground,
    muted: mix(terminal.background, terminal.foreground, 0.62),
    faint: mix(terminal.background, terminal.foreground, 0.4),
    red: terminal.brightRed,
    green: terminal.brightGreen,
    blue: terminal.brightBlue,
    agent: terminal.brightMagenta,
    runningSoft: mix(terminal.background, terminal.brightBlue, 0.09),
    failedSoft: mix(terminal.background, terminal.brightRed, 0.1),
  },
});

export const terminalColorSchemes: readonly TerminalColorScheme[] = [
  scheme({
    id: "wmux",
    name: "wmux",
    accent: "#f4d35e",
    terminal: terminalThemeById("wmux"),
  }),
  scheme({
    id: "flock",
    name: "Flock",
    accent: "#5b8cff",
    terminal: terminalThemeById("flock"),
  }),
  scheme({
    id: "catppuccin-mocha",
    name: "Catppuccin Mocha",
    accent: "#f9e2af",
    terminal: terminalThemeById("catppuccin-mocha"),
  }),
  scheme({
    id: "dracula",
    name: "Dracula",
    accent: "#f1fa8c",
    terminal: terminalThemeById("dracula"),
  }),
  scheme({
    id: "nord",
    name: "Nord",
    accent: "#88c0d0",
    terminal: terminalThemeById("nord"),
  }),
  scheme({
    id: "solarized-dark",
    name: "Solarized Dark",
    accent: "#b58900",
    terminal: terminalThemeById("solarized-dark"),
  }),
  scheme({
    id: "gruvbox-dark",
    name: "Gruvbox Dark",
    accent: "#fabd2f",
    terminal: terminalThemeById("gruvbox-dark"),
  }),
  scheme({
    id: "tokyo-night",
    name: "Tokyo Night",
    accent: "#e0af68",
    terminal: terminalThemeById("tokyo-night"),
  }),
];

const schemesById = new Map(terminalColorSchemes.map((candidate) => [candidate.id, candidate]));

export const colorSchemeById = (id: TerminalColorSchemeId): TerminalColorScheme =>
  schemesById.get(id) ?? terminalColorSchemes[0];

export const colorSchemeCssVariables = (value: TerminalColorScheme): Record<string, string> => ({
  "--black": value.chrome.black,
  "--panel": value.chrome.panel,
  "--panel-2": value.chrome.panel2,
  "--panel-3": value.chrome.panel3,
  "--line": value.chrome.line,
  "--line-bright": value.chrome.lineBright,
  "--selection": value.chrome.selection,
  "--selection-text": value.chrome.selectionText,
  "--gold": value.chrome.gold,
  "--gold-dim": value.chrome.goldDim,
  "--gold-hot": value.chrome.gold,
  "--text": value.chrome.text,
  "--ivory": value.chrome.text,
  "--muted": value.chrome.muted,
  "--faint": value.chrome.faint,
  "--red": value.chrome.red,
  "--green": value.chrome.green,
  "--blue": value.chrome.blue,
  "--running-soft": value.chrome.runningSoft,
  "--failed-soft": value.chrome.failedSoft,
  "--terminal-background": value.terminal.background,
  "--terminal-foreground": value.terminal.foreground,
  "--wmux-browser-chrome": value.terminal.background,
});

function mix(from: string, to: string, amount: number): string {
  const left = parseHex(from);
  const right = parseHex(to);
  const channel = (index: number) => Math.round(left[index] + (right[index] - left[index]) * amount);
  return `#${[channel(0), channel(1), channel(2)].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function parseHex(value: string): [number, number, number] {
  const normalized = value.replace(/^#/, "");
  return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16)) as [number, number, number];
}
