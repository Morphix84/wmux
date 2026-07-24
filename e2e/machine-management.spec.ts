import { expect, test } from "./fixtures";

test("adds a machine, creates a workspace on it, and removes it without shell access", async ({
  page,
  request,
}, testInfo) => {
  const machineId = `managed-e2e-${testInfo.project.name}`;
  const machineName = `Managed E2E ${testInfo.project.name}`;

  if (testInfo.project.name.startsWith("mobile-")) {
    await page.getByRole("banner", { name: "Mobile session controls" })
      .getByRole("button", { name: "Open terminal" })
      .click();
  }

  await page.keyboard.press("Control+K");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByPlaceholder("Search commands, workspaces, tabs, hosts").fill("Manage machines");
  await palette.getByPlaceholder("Search commands, workspaces, tabs, hosts").press("Enter");

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

  await page.keyboard.press("Control+K");
  await palette.getByPlaceholder("Search commands, workspaces, tabs, hosts")
    .fill(`New workspace on ${machineName}`);
  await palette.getByPlaceholder("Search commands, workspaces, tabs, hosts").press("Enter");

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

  await page.keyboard.press("Control+K");
  await palette.getByPlaceholder("Search commands, workspaces, tabs, hosts").fill("Manage machines");
  await palette.getByPlaceholder("Search commands, workspaces, tabs, hosts").press("Enter");
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
