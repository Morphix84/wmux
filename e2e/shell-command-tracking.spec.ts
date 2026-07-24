import path from "node:path";
import { expect, test } from "./fixtures";

test("a plain managed-shell command appears in activity with its exit status", async ({
  createReadyWorkspace,
  page,
  request,
  waitForTerminalOutput,
}, testInfo) => {
  test.setTimeout(60_000);
  test.skip(testInfo.project.name !== "chromium", "desktop activity acceptance runs once");
  const machineId = "tracked-shell-chromium";
  const machine = await request.post("/api/machines", {
    data: {
      id: machineId,
      name: "Tracked shell",
      kind: "local",
      shell: "/bin/bash",
      cwd: path.resolve("e2e", "fixtures", "shell-tracking"),
      sessionBackend: "pty",
    },
  });
  expect(machine.ok()).toBeTruthy();

  const workspace = await createReadyWorkspace({ machineId });
  const paneId = workspace.tabs[0]!.panes[0]!.id;
  try {
    const warmup = await request.post(`/api/panes/${paneId}/input`, {
      data: { data: "printf '__WMUX_TRACKING_READY__\\n'\r", cols: 100, rows: 32 },
    });
    expect(warmup.ok()).toBeTruthy();
    await waitForTerminalOutput(paneId, "__WMUX_TRACKING_READY__");

    const input = await request.post(`/api/panes/${paneId}/input`, {
      data: { data: "make test\r", cols: 100, rows: 32 },
    });
    expect(input.ok()).toBeTruthy();

    await expect.poll(async () => {
      const response = await request.get("/api/bootstrap");
      const bootstrap = await response.json() as {
        runs: Array<{
          paneId: string;
          command: string;
          status: string;
          exitCode: number | null;
        }>;
      };
      return bootstrap.runs;
    }).toContainEqual(expect.objectContaining({
      paneId,
      command: "make test",
      status: "failed",
      exitCode: 2,
    }));

    await page.keyboard.press("Control+K");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    const search = palette.getByPlaceholder("Search commands, workspaces, tabs, hosts");
    await search.fill("Open activity");
    await search.press("Enter");

    const activity = page.getByRole("complementary", { name: "Activity" });
    await expect(activity).toBeVisible();
    await expect(activity.getByRole("listitem", {
      name: /run: make test; exit 2/,
    })).toHaveCount(1);
  } finally {
    const removedWorkspace = await request.delete(`/api/workspaces/${workspace.id}`);
    expect(removedWorkspace.ok()).toBeTruthy();
    const removedMachine = await request.delete(`/api/machines/${machineId}`);
    expect(removedMachine.ok()).toBeTruthy();
  }
});
