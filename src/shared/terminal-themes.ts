import type { TerminalColorSchemeId } from "./protocol.js";

export interface TerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  selectionForeground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export const TERMINAL_THEMES: Record<TerminalColorSchemeId, TerminalTheme> = {
  wmux: {
    background: "#101114", foreground: "#d8dee9", cursor: "#f7c95c", cursorAccent: "#101114",
    selectionBackground: "#31445f", selectionForeground: "#f2eee4",
    black: "#1b1d22", red: "#be3e37", green: "#45b86a", yellow: "#d4b45f", blue: "#5097ff",
    magenta: "#b48ead", cyan: "#65b9c7", white: "#d8dee9", brightBlack: "#5f6673", brightRed: "#e05a50",
    brightGreen: "#62d486", brightYellow: "#f4d35e", brightBlue: "#73adff", brightMagenta: "#c792ea",
    brightCyan: "#88d7e3", brightWhite: "#f2eee4",
  },
  flock: {
    background: "#0c0d0f", foreground: "#d8d9df", cursor: "#5b8cff", cursorAccent: "#0c0d0f",
    selectionBackground: "#263551", selectionForeground: "#f1f2f5",
    black: "#16181d", red: "#d95f76", green: "#77b86a", yellow: "#d4a958", blue: "#5b8cff",
    magenta: "#b899e6", cyan: "#57bbc9", white: "#d8d9df", brightBlack: "#686d78", brightRed: "#ef7188",
    brightGreen: "#8fca7f", brightYellow: "#e6bd69", brightBlue: "#78a1ff", brightMagenta: "#c9acf0",
    brightCyan: "#72ceda", brightWhite: "#f1f2f5",
  },
  "catppuccin-mocha": {
    background: "#1e1e2e", foreground: "#cdd6f4", cursor: "#f5e0dc", cursorAccent: "#1e1e2e",
    selectionBackground: "#45475a", selectionForeground: "#cdd6f4",
    black: "#45475a", red: "#f38ba8", green: "#a6e3a1", yellow: "#f9e2af", blue: "#89b4fa",
    magenta: "#cba6f7", cyan: "#94e2d5", white: "#bac2de", brightBlack: "#585b70", brightRed: "#f38ba8",
    brightGreen: "#a6e3a1", brightYellow: "#f9e2af", brightBlue: "#89b4fa", brightMagenta: "#cba6f7",
    brightCyan: "#94e2d5", brightWhite: "#a6adc8",
  },
  dracula: {
    background: "#282a36", foreground: "#f8f8f2", cursor: "#f8f8f2", cursorAccent: "#282a36",
    selectionBackground: "#44475a", selectionForeground: "#f8f8f2",
    black: "#21222c", red: "#ff5555", green: "#50fa7b", yellow: "#f1fa8c", blue: "#bd93f9",
    magenta: "#ff79c6", cyan: "#8be9fd", white: "#f8f8f2", brightBlack: "#6272a4", brightRed: "#ff6e6e",
    brightGreen: "#69ff94", brightYellow: "#ffffa5", brightBlue: "#d6acff", brightMagenta: "#ff92df",
    brightCyan: "#a4ffff", brightWhite: "#ffffff",
  },
  nord: {
    background: "#2e3440", foreground: "#d8dee9", cursor: "#88c0d0", cursorAccent: "#2e3440",
    selectionBackground: "#434c5e", selectionForeground: "#eceff4",
    black: "#3b4252", red: "#bf616a", green: "#a3be8c", yellow: "#ebcb8b", blue: "#81a1c1",
    magenta: "#b48ead", cyan: "#88c0d0", white: "#e5e9f0", brightBlack: "#4c566a", brightRed: "#bf616a",
    brightGreen: "#a3be8c", brightYellow: "#ebcb8b", brightBlue: "#81a1c1", brightMagenta: "#b48ead",
    brightCyan: "#8fbcbb", brightWhite: "#eceff4",
  },
  "solarized-dark": {
    background: "#002b36", foreground: "#839496", cursor: "#93a1a1", cursorAccent: "#002b36",
    selectionBackground: "#073642", selectionForeground: "#eee8d5",
    black: "#073642", red: "#dc322f", green: "#859900", yellow: "#b58900", blue: "#268bd2",
    magenta: "#d33682", cyan: "#2aa198", white: "#eee8d5", brightBlack: "#002b36", brightRed: "#cb4b16",
    brightGreen: "#586e75", brightYellow: "#657b83", brightBlue: "#839496", brightMagenta: "#6c71c4",
    brightCyan: "#93a1a1", brightWhite: "#fdf6e3",
  },
  "gruvbox-dark": {
    background: "#282828", foreground: "#ebdbb2", cursor: "#fabd2f", cursorAccent: "#282828",
    selectionBackground: "#504945", selectionForeground: "#fbf1c7",
    black: "#282828", red: "#cc241d", green: "#98971a", yellow: "#d79921", blue: "#458588",
    magenta: "#b16286", cyan: "#689d6a", white: "#a89984", brightBlack: "#928374", brightRed: "#fb4934",
    brightGreen: "#b8bb26", brightYellow: "#fabd2f", brightBlue: "#83a598", brightMagenta: "#d3869b",
    brightCyan: "#8ec07c", brightWhite: "#ebdbb2",
  },
  "tokyo-night": {
    background: "#1a1b26", foreground: "#c0caf5", cursor: "#c0caf5", cursorAccent: "#1a1b26",
    selectionBackground: "#33467c", selectionForeground: "#c0caf5",
    black: "#15161e", red: "#f7768e", green: "#9ece6a", yellow: "#e0af68", blue: "#7aa2f7",
    magenta: "#bb9af7", cyan: "#7dcfff", white: "#a9b1d6", brightBlack: "#414868", brightRed: "#f7768e",
    brightGreen: "#9ece6a", brightYellow: "#e0af68", brightBlue: "#7aa2f7", brightMagenta: "#bb9af7",
    brightCyan: "#7dcfff", brightWhite: "#c0caf5",
  },
};

export const terminalThemeById = (id: TerminalColorSchemeId): TerminalTheme => TERMINAL_THEMES[id];

export const TERMINAL_ANSI_COLOR_KEYS = [
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
] as const satisfies readonly (keyof TerminalTheme)[];
