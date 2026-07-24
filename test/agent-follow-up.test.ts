import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  AgentFollowUpError,
  AgentFollowUpService,
  agentRuntimeEnvironment,
  type HeadlessProcessRunner,
} from "../src/server/agent-follow-up.js";
import { AgentSessionService } from "../src/server/agent-sessions.js";
import type { RepositoryReviewService } from "../src/server/repository-review.js";
import { StateStore } from "../src/server/state.js";
import type {
  MachineConfig,
  WorkingTreeSnapshot,
} from "../src/server/types.js";

const machines: MachineConfig[] = [
  { id: "local", name: "Local", kind: "local" },
];

const snapshot: WorkingTreeSnapshot = {
  kind: "working-tree",
  contentRevision: "sha256:review",
  headRevision: "abc",
  consistency: "verified",
  ignoredFilesExcluded: true,
  complete: true,
  filesTruncated: false,
  observedFileCount: 1,
  files: [{
    path: "src/review.ts",
    pathEncoding: "utf8",
    indexStatus: "unmodified",
    workingTreeStatus: "modified",
    tracked: true,
    binary: "no",
    submodule: false,
    modeOnly: false,
  }],
  stagedPatch: {
    text: "",
    capturedBytes: 0,
    hunkCount: 0,
    lineCount: 0,
    truncated: false,
    truncationReasons: [],
  },
  workingTreePatch: {
    text: "diff --git a/src/review.ts b/src/review.ts\n+review me\n",
    capturedBytes: 58,
    hunkCount: 1,
    lineCount: 2,
    truncated: false,
    truncationReasons: [],
  },
  limits: {
    timeoutMs: 10_000,
    totalGitOutputBytes: 1024,
    patchBytes: 1024,
    fileCount: 10,
    hunkCount: 10,
    lineCount: 100,
    pathBytes: 4096,
    longLineBytes: 16_384,
    untrackedFileBytes: 1024,
    totalUntrackedBytes: 4096,
  },
};

test("follow-up turns preserve session context and separate safety grants", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wmux-follow-up-"));
  try {
    const state = new StateStore(machines, path.join(directory, "state.json"));
    const paneId = state.snapshot().workspaces[0].tabs[0].panes[0].id;
    const agents = new AgentSessionService(state);
    agents.recordAgentEvent({
      paneId,
      runId: "initial-run",
      sessionId: "durable-session",
      agent: "codex",
      status: "completed",
      prompt: "Implement the first pass.",
      message: "First pass complete.",
    });
    const launches: Array<{
      args: string[];
      prompt: string;
      environment: NodeJS.ProcessEnv;
    }> = [];
    const runner: HeadlessProcessRunner = async (spec, prompt, options) => {
      launches.push({ args: spec.args, prompt, environment: options.environment });
      return {
        status: 0,
        stdout: `${JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: "Revision complete." },
        })}\n`,
        stderr: "",
        timedOut: false,
        cancelled: false,
        outputLimited: false,
      };
    };
    const reviews = {
      localRepositoryRoot: async () => directory,
      workingTreeSnapshot: async () => snapshot,
      workingTreeSnapshotTarget: async () => ({
        repositoryRoot: directory,
        snapshot,
      }),
    } as unknown as RepositoryReviewService;
    const service = new AgentFollowUpService(
      state,
      agents,
      reviews,
      {
        runner,
        environment: {
          PATH: "/test/bin",
          OPENAI_API_KEY: "provider-key",
          WMUX_HELPER_TOKEN: "wmux-secret",
        },
      },
    );

    const result = await service.run("durable-session", {
      action: "continue",
      prompt: "Revise the implementation.",
      writeAccess: true,
      unattended: false,
    });

    assert.equal(result.sessionId, "durable-session");
    assert.equal(result.delegation.state, "completed");
    assert.equal(result.delegation.result, "Revision complete.");
    assert.ok(launches[0].args.includes("workspace-write"));
    assert.equal(launches[0].args.includes("never"), false);
    assert.match(launches[0].prompt, /Implement the first pass/u);
    assert.match(launches[0].prompt, /First pass complete/u);
    assert.match(launches[0].prompt, /Revise the implementation/u);
    assert.equal(launches[0].environment.OPENAI_API_KEY, "provider-key");
    assert.equal(launches[0].environment.WMUX_HELPER_TOKEN, undefined);
    assert.deepEqual(
      result.timeline.entries
        .filter((entry) => entry.runId === result.runId)
        .map((entry) => [entry.kind, entry.state]),
      [
        ["prompt", undefined],
        ["status", "running"],
        ["outcome", "completed"],
      ],
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("review turns are read-only and archive the exact snapshot", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wmux-review-turn-"));
  try {
    const state = new StateStore(machines, path.join(directory, "state.json"));
    const paneId = state.snapshot().workspaces[0].tabs[0].panes[0].id;
    const agents = new AgentSessionService(state);
    agents.recordAgentEvent({
      paneId,
      runId: "initial-run",
      sessionId: "review-session",
      agent: "codex",
      status: "completed",
      message: "Implementation complete.",
    });
    let launchArgs: string[] = [];
    let launchPrompt = "";
    const service = new AgentFollowUpService(
      state,
      agents,
      {
        localRepositoryRoot: async () => directory,
        workingTreeSnapshot: async () => snapshot,
        workingTreeSnapshotTarget: async () => ({
          repositoryRoot: directory,
          snapshot,
        }),
      } as unknown as RepositoryReviewService,
      {
        runner: async (spec, prompt) => {
          launchArgs = spec.args;
          launchPrompt = prompt;
          return {
            status: 0,
            stdout: `${JSON.stringify({
              type: "item.completed",
              item: {
                type: "agent_message",
                text: "Found one correctness risk.",
              },
            })}\n`,
            stderr: "",
            timedOut: false,
            cancelled: false,
            outputLimited: false,
          };
        },
      },
    );

    const result = await service.run("review-session", { action: "review" });
    assert.ok(launchArgs.includes("read-only"));
    assert.equal(launchArgs.includes("never"), false);
    assert.match(launchPrompt, /Read-only review/u);
    assert.match(launchPrompt, /src\/review\.ts/u);
    assert.match(launchPrompt, /\+review me/u);
    assert.deepEqual(result.snapshot?.filesTouched, ["src/review.ts"]);
    assert.equal(
      result.timeline.entries.some(
        (entry) =>
          entry.kind === "snapshot"
          && entry.runId === result.runId,
      ),
      true,
    );

    await assert.rejects(
      service.run("review-session", {
        action: "review",
        writeAccess: true,
      }),
      (error: unknown) =>
        error instanceof AgentFollowUpError
        && error.code === "agent_review_must_be_read_only",
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("agent runtime environment removes wmux credentials only", () => {
  assert.deepEqual(
    agentRuntimeEnvironment({
      PATH: "/bin",
      ANTHROPIC_API_KEY: "provider",
      WMUX_AUTOMATION_TOKEN: "automation",
      WMUX_LOGIN_PASSWORD: "password",
      WMUX_COLOR_MODE: "dark",
    }),
    {
      PATH: "/bin",
      ANTHROPIC_API_KEY: "provider",
      WMUX_COLOR_MODE: "dark",
    },
  );
});
