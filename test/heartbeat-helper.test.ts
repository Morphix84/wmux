import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (filePath: string): string => fs.readFileSync(filePath, "utf8");

test("POSIX heartbeat keeps its token out of argv and propagates once failures", () => {
  const script = read("scripts/wmux-heartbeat");
  assert.match(script, /header_file=.*mktemp/);
  assert.match(script, /-H "@\$\{header_file\}"/);
  assert.doesNotMatch(script, /-H "Authorization: Bearer/);
  assert.match(script, /exit "\$\{failed\}"/);
});

test("heartbeat service installer locks down registration files", () => {
  const installer = read("scripts/install-heartbeat-service.sh");
  assert.match(installer, /chmod 600 .*heartbeat\.json.*registration-token.*url/);
  assert.ok(fs.existsSync("deploy/wmux-heartbeat.service.example"));
  assert.ok(fs.existsSync("deploy/wmux-heartbeat.timer.example"));
});

test("POSIX session agent installer supervises both platforms and retires standalone heartbeat", () => {
  const installer = read("scripts/install-session-agent-service.sh");
  assert.match(installer, /chmod 600 "\$\{CONFIG_PATH\}"/);
  assert.match(installer, /systemctl --user disable --now wmux-heartbeat\.timer wmux-heartbeat\.service/);
  assert.match(installer, /systemctl --user enable --now wmux-session-agent\.service/);
  assert.match(installer, /launchctl bootstrap/);
  assert.ok(fs.existsSync("deploy/wmux-session-agent.service.example"));
  assert.ok(fs.existsSync("deploy/io.wmux.session-agent.plist.example"));
});

test("Windows heartbeat diagnostic is one-shot and fails when its registration POST fails", () => {
  const script = read("scripts/windows/wmux-heartbeat.ps1");
  assert.match(script, /if \(\$Failed\) \{ exit 1 \}/);
  assert.match(script, /registration token must not contain a newline/);
  assert.doesNotMatch(script, /while \(\$true\)/);
  assert.doesNotMatch(script, /Start-Sleep/);
});
