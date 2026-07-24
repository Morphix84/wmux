// These specs inspect server-side files, execute checkout-relative fixtures,
// or validate rendering against modules served from the fixture checkout.
export const serverCoupledE2eSpecs = [
  "agent-fleet.spec.ts",
  "agent-follow-up.spec.ts",
  "agent-notifications.spec.ts",
  "canvas-chrome.spec.ts",
  "command-palette.spec.ts",
  "direct-links.spec.ts",
  "docs-screenshots.spec.ts",
  "shell-command-tracking.spec.ts",
  "terminal-graphics.spec.ts",
  "terminal-prediction.spec.ts",
];

// These specs use only browser and HTTP/WebSocket contracts, so their
// Playwright driver may run on a different operating system from the server.
export const browserOnlyE2eSpecs = [
  "fonts-and-keybindings.spec.ts",
  "machine-management.spec.ts",
  "smoke.spec.ts",
  "workspace-navigation.spec.ts",
  "workspace-ordering.spec.ts",
];
