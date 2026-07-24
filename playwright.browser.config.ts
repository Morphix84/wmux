import { defineConfig } from "@playwright/test";
import { browserOnlyE2eSpecs } from "./e2e/test-groups.js";
import baseConfig from "./playwright.config.js";

export default defineConfig({
  ...baseConfig,
  testMatch: browserOnlyE2eSpecs,
});
