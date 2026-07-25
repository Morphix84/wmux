import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

async function openCommandPalette(
  page: Page,
  mobile: boolean,
) {
  if (mobile) {
    await page.getByRole("banner", { name: "Mobile session controls" })
      .getByRole("button", { name: "Open actions" })
      .click();
    return;
  }
  await page.keyboard.press("Control+K");
}

async function runPaletteCommand(
  page: Page,
  mobile: boolean,
  title: string,
) {
  await openCommandPalette(page, mobile);
  const palette = page.getByRole("dialog", { name: "Command palette" });
  const search = palette.getByPlaceholder(
    "Search commands, workspaces, tabs, hosts",
  );
  await search.pressSequentially(title);
  if (mobile) {
    await expect(palette.locator(".command-item.selected .command-title"))
      .toHaveText(title);
  }
  await search.press("Enter");
}

test("adds a machine, creates a workspace on it, and removes it without shell access", async ({
  page,
  request,
}, testInfo) => {
  const machineId = `managed-e2e-${testInfo.project.name}`;
  const machineName = `Managed E2E ${testInfo.project.name}`;
  const mobile = testInfo.project.name.startsWith("mobile-");

  await runPaletteCommand(page, mobile, "Manage machines");

  const manager = page.getByRole("dialog", { name: "Machine management" });
  await expect(manager).toBeVisible();
  const idInput = manager.getByRole("textbox", { name: "ID", exact: true });
  await idInput.fill(machineId);
  await expect(idInput).toHaveValue(machineId);
  await manager.getByRole("textbox", { name: "Name", exact: true }).fill(machineName);
  await expect(idInput).toHaveValue(machineId);
  await manager.getByRole("combobox", { name: "Kind", exact: true }).selectOption("local");
  await expect(idInput).toHaveValue(machineId);
  await manager.getByRole("button", { name: "Add machine" }).click();
  await expect(manager.getByText(machineName, { exact: true })).toBeVisible();
  await manager.getByRole("button", { name: "Close", exact: true }).click();

  if (testInfo.project.name === "chromium") {
    const agents = page.getByRole("tree", { name: "Agents" });
    const existingAgent = agents.getByRole("treeitem").first();
    await expect(existingAgent).toBeVisible();
    const space = page.getByRole("navigation", { name: "Spaces" })
      .getByRole("button", { name: new RegExp(`^${machineName},`) });
    await space.focus();
    await page.keyboard.press("Enter");
    await expect(space).toHaveAttribute("aria-current", "true");
    await expect(agents).toHaveAttribute("data-grouping", "space");
    await expect(agents).toHaveAttribute("data-target-space-id", machineId);
    await expect(existingAgent).toBeVisible();
  }

  await runPaletteCommand(page, mobile, `New workspace on ${machineName}`);

  let workspaceId = "";
  await expect.poll(async () => {
    const response = await request.get("/api/bootstrap");
    const payload = await response.json() as {
      workspaces: Array<{
        id: string;
        tabs: Array<{ panes: Array<{ machineId: string }> }>;
      }>;
    };
    const workspace = payload.workspaces.find((candidate) =>
      candidate.tabs.some((tab) =>
        tab.panes.some((pane) => pane.machineId === machineId)));
    workspaceId = workspace?.id ?? "";
    return workspaceId;
  }).not.toBe("");

  const close = await request.delete(`/api/workspaces/${workspaceId}`);
  expect(close.ok()).toBeTruthy();
  await expect.poll(async () => {
    const response = await request.get("/api/bootstrap");
    const payload = await response.json() as { workspaces: Array<{ id: string }> };
    return payload.workspaces.some((workspace) => workspace.id === workspaceId);
  }).toBe(false);

  if (mobile) {
    await expect(page.locator("main.app-shell"))
      .not.toHaveClass(/mobile-keyboard-open/);
    await expect(page.getByRole("banner", { name: "Mobile session controls" }))
      .toBeVisible();
  }

  await runPaletteCommand(page, mobile, "Manage machines");
  await expect(manager).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await manager.getByTitle(`Remove ${machineName}`).click();
  await expect.poll(async () => {
    const response = await request.get("/api/machines/manage");
    const payload = await response.json() as {
      staticMachines: Array<{ id: string }>;
    };
    return payload.staticMachines.some((machine) => machine.id === machineId);
  }).toBe(false);
});
