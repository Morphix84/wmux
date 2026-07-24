import { expect, test } from "./fixtures";

test("unsupported terminal image protocols show a visible diagnostic", async ({
  createReadyWorkspace,
  page,
  request,
}, testInfo) => {
  test.setTimeout(60_000);
  test.skip(testInfo.project.name !== "chromium", "terminal graphics acceptance runs once");
  const machineId = "terminal-graphics-chromium";
  const machine = await request.post("/api/machines", {
    data: {
      id: machineId,
      name: "Terminal graphics",
      kind: "local",
      shell: "/bin/sh",
      sessionBackend: "pty",
    },
  });
  expect(machine.ok()).toBeTruthy();
  const workspace = await createReadyWorkspace({ machineId });
  try {
    const terminalInput = page.locator(".terminal-pane.active .terminal-host textarea");
    await terminalInput.evaluate((element: HTMLTextAreaElement) => element.focus());
    await page.keyboard.type("printf '\\033Pq~\\033\\\\'");
    await page.keyboard.press("Enter");
    const diagnostic = page.locator(".terminal-pane.active .terminal-graphics-diagnostic");
    await expect(diagnostic).toContainText("[GRAPHICS WARN] SIXEL", { timeout: 15_000 });
    await expect(diagnostic).toContainText("Use Kitty graphics or wmux-media");
    await diagnostic.getByRole("button", { name: "Dismiss graphics warning" }).click();
    await expect(diagnostic).toBeHidden();

    await page.keyboard.type("printf '\\033]1337;File=name=test.png:aGVsbG8=\\a'");
    await page.keyboard.press("Enter");
    await expect(diagnostic).toContainText("[GRAPHICS WARN] ITERM2", { timeout: 15_000 });
  } finally {
    const removed = await request.delete(`/api/workspaces/${workspace.id}`);
    expect(removed.ok()).toBeTruthy();
    const removedMachine = await request.delete(`/api/machines/${machineId}`);
    expect(removedMachine.ok()).toBeTruthy();
  }
});
