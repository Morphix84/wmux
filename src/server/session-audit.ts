import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DurableSessionAudit, DurableSessionAuditRow } from "../shared/protocol.js";
import { runCommand } from "./child-process.js";
import {
  disposeDurableSession,
  durableSessionName,
  listDurableSessionsOnMachine,
  type DurableSessionObservationResult,
} from "./durable-session.js";
import {
  durableEndpointKey,
  DurableEndpointStore,
  type DurableEndpointRecord,
} from "./durable-endpoint-store.js";
import {
  deleteWindowsAgentSession,
  listSessionAgentSessions,
  type SessionAgentObservationResult,
  windowsAgentUrl,
} from "./windows-agent.js";

export type { DurableSessionAudit, DurableSessionAuditRow } from "../shared/protocol.js";

const defaultStatePath = (): string => path.join(os.homedir(), ".wmux", "state.json");

const commandOutput = async (command: string, args: string[]): Promise<string> => {
  const result = await runCommand(command, args, { timeoutMs: 2000 });
  return result.status === 0 ? result.stdout : "";
};

export interface DurableSessionAuditOptions {
  endpointPath?: string;
  commandOutput?: (command: string, args: string[]) => Promise<string>;
  remoteLister?: (machine: DurableEndpointRecord["machine"]) => Promise<DurableSessionObservationResult>;
  remoteDisposer?: (
    machine: DurableEndpointRecord["machine"],
    paneId: string,
  ) => Promise<boolean>;
  agentLister?: (
    machine: DurableEndpointRecord["machine"],
  ) => Promise<SessionAgentObservationResult>;
  agentDisposer?: (
    machine: DurableEndpointRecord["machine"],
    paneId: string,
  ) => Promise<boolean>;
}

interface AuditMachine {
  id?: string;
  kind?: string;
  sessionBackend?: string;
  command?: unknown[];
}

interface AuditPane {
  id?: string;
  machineId?: string;
  status?: string;
}

interface AuditState {
  machines?: AuditMachine[];
  workspaces?: Array<{ tabs?: Array<{ panes?: AuditPane[] }> }>;
}

const loadState = (statePath: string): AuditState => {
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf8")) as AuditState;
  } catch {
    return { workspaces: [] };
  }
};

const endpointStorePath = (statePath: string): string =>
  process.env.WMUX_SESSION_ENDPOINT_PATH
    ?? path.join(path.dirname(statePath), "session-endpoints.json");

const paneIdFromSession = (sessionName: string): string => (sessionName.startsWith("wmux_") ? sessionName.slice("wmux_".length) : "");

export const expectedLocalDurablePaneIds = (state: AuditState): Set<string> => {
  const machines = new Map((state.machines ?? []).map((machine) => [machine.id, machine]));
  const paneIds = (state.workspaces ?? []).flatMap((workspace) =>
    (workspace.tabs ?? []).flatMap((tab) =>
      (tab.panes ?? []).flatMap((pane) => {
        if (!pane.id || pane.status === "exited") return [];
        const machineId = pane.machineId ?? "local";
        const machine = machines.get(machineId);
        if (machineId !== "local" || (machine && machine.kind !== "local")) return [];
        if (machine?.command?.length) return [];
        const backend = machine?.sessionBackend ?? "auto";
        return backend === "auto" || backend === "tmux" || backend === "screen" ? [pane.id] : [];
      }),
    ),
  );
  return new Set(paneIds);
};

const listTmux = async (
  output: DurableSessionAuditOptions["commandOutput"] = commandOutput,
): Promise<Array<Omit<DurableSessionAuditRow, "activePane" | "status" | "cleanupAllowed">>> =>
  (await output("tmux", ["list-sessions", "-F", "#{session_name}\t#{session_attached}\t#{session_windows}"]))
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, attached, windows] = line.split("\t");
      return {
        backend: "tmux" as const,
        name,
        paneId: paneIdFromSession(name),
        attached: Number(attached) > 0,
        detail: `${attached || 0} attached, ${windows || 0} windows`,
      };
    })
    .filter((session) => session.name.startsWith("wmux_"));

const listScreen = async (
  output: DurableSessionAuditOptions["commandOutput"] = commandOutput,
): Promise<Array<Omit<DurableSessionAuditRow, "activePane" | "status" | "cleanupAllowed">>> =>
  (await output("screen", ["-ls"]))
    .split("\n")
    .map((line) => line.trim())
    .flatMap((line) => {
      const match = line.match(/^(?:\d+\.)?(wmux_[^\s]+)\s+\([^)]+\)\s+\(([^)]+)\)/);
      if (!match) return [];
      return [
        {
          backend: "screen" as const,
          name: match[1],
          paneId: paneIdFromSession(match[1]),
          attached: /attached/i.test(match[2]),
          detail: match[2],
        },
      ];
    });

export const auditDurableSessions = async (
  statePath = process.env.WMUX_STATE_PATH ?? defaultStatePath(),
  options: DurableSessionAuditOptions = {},
): Promise<DurableSessionAudit> => {
  const state = loadState(statePath);
  const active = expectedLocalDurablePaneIds(state);
  const endpointStore = new DurableEndpointStore(
    options.endpointPath ?? endpointStorePath(statePath),
  );
  const remoteRecords = endpointStore.snapshot()
    .filter((record) => record.backend === "durable-multiplexer");
  const agentRecords = endpointStore.snapshot()
    .filter((record) => record.backend === "windows-agent");
  const [tmuxSessions, screenSessions, remote, remoteAgents] = await Promise.all([
    listTmux(options.commandOutput),
    listScreen(options.commandOutput),
    auditRemoteDurableSessions(
      remoteRecords,
      options.remoteLister ?? listDurableSessionsOnMachine,
    ),
    auditRemoteAgentSessions(
      agentRecords,
      options.agentLister ?? listSessionAgentSessions,
    ),
  ]);
  const sessions = [...tmuxSessions, ...screenSessions];
  const byName = new Map<string, typeof sessions>();
  for (const session of sessions) {
    if (!byName.has(session.name)) byName.set(session.name, []);
    byName.get(session.name)?.push(session);
  }

  const localRows: DurableSessionAuditRow[] = sessions.map((session) => {
    const siblings = byName.get(session.name) ?? [];
    const activePane = active.has(session.paneId);
    const duplicate = activePane && siblings.length > 1;
    const status = !activePane ? "orphan" : duplicate && session.backend !== "tmux" ? "duplicate" : "active";
    return {
      ...session,
      activePane,
      status,
      cleanupAllowed: status === "orphan" || status === "duplicate",
    };
  });
  const rows = [...localRows, ...remote.rows, ...remoteAgents.rows];

  const missing = [
    ...[...active]
    .map((paneId) => ({ paneId, name: durableSessionName(paneId) }))
    .filter((pane) => !byName.has(pane.name)),
    ...remote.missing,
    ...remoteAgents.missing,
  ];
  const activeRemotePanes = new Set(
    [...remoteRecords, ...agentRecords]
      .filter((record) => record.status === "active")
      .map((record) => record.paneId),
  );

  return {
    summary: {
      statePath,
      activePaneCount: active.size + activeRemotePanes.size,
      sessionCount: rows.length,
      orphanCount: rows.filter((row) => row.status === "orphan").length,
      duplicateCount: rows.filter((row) => row.status === "duplicate").length,
      missingCount: missing.length,
      unreachableCount: rows.filter((row) => row.status === "unreachable").length,
    },
    sessions: rows,
    missing,
  };
};

export const formatDurableSessionAudit = (audit: DurableSessionAudit): string => {
  const lines = [
    `wmux session audit (${audit.summary.statePath})`,
    `active panes: ${audit.summary.activePaneCount}, sessions: ${audit.summary.sessionCount}, orphans: ${audit.summary.orphanCount}, duplicates: ${audit.summary.duplicateCount}, missing: ${audit.summary.missingCount}, unreachable: ${audit.summary.unreachableCount ?? 0}`,
  ];
  if (audit.sessions.length) {
    lines.push("");
    for (const row of audit.sessions) {
      const target = row.remote ? ` ${row.endpoint ?? row.machineId ?? "remote"}` : "";
      lines.push(`${row.status.padEnd(11)} ${row.backend.padEnd(6)} ${row.name.padEnd(24)} ${row.detail}${target}`);
    }
  }
  if (audit.missing.length) {
    lines.push("");
    for (const row of audit.missing) lines.push(`missing   ${row.name}`);
  }
  return lines.join("\n");
};

export const hasDurableSessionAuditIssues = (audit: DurableSessionAudit): boolean =>
  Boolean(
    audit.summary.orphanCount
    || audit.summary.duplicateCount
    || audit.summary.missingCount
    || audit.summary.unreachableCount,
  );

export const cleanupDurableSession = (
  backend: "tmux" | "screen" | "agent",
  name: string,
  statePath = process.env.WMUX_STATE_PATH ?? defaultStatePath(),
  cleanupKey?: string,
  options: DurableSessionAuditOptions = {},
): Promise<DurableSessionAudit> => {
  if (!name.startsWith("wmux_")) {
    throw new Error("refusing to clean up a non-wmux session");
  }

  return cleanupKey
    ? cleanupRemoteDurableSession(backend, name, cleanupKey, statePath, options)
    : cleanupDurableSessionAsync(backend, name, statePath, options);
};

const cleanupDurableSessionAsync = async (
  backend: "tmux" | "screen" | "agent",
  name: string,
  statePath: string,
  options: DurableSessionAuditOptions,
): Promise<DurableSessionAudit> => {
  if (backend === "agent") {
    throw new Error("session-agent cleanup requires a persisted endpoint target");
  }
  const audit = await auditDurableSessions(statePath, options);
  const row = audit.sessions.find((candidate) => candidate.backend === backend && candidate.name === name);
  if (!row) return auditDurableSessions(statePath, options);
  if (!row.cleanupAllowed) {
    throw new Error("refusing to clean up an active wmux session");
  }

  const result = await (
    backend === "tmux"
      ? runCommand("tmux", ["kill-session", "-t", name], { timeoutMs: 3000 })
      : runCommand("screen", ["-S", name, "-X", "quit"], { timeoutMs: 3000 })
  );
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `${backend} exited with ${result.status}`;
    throw new Error(detail);
  }

  return auditDurableSessions(statePath, options);
};

const auditRemoteDurableSessions = async (
  records: DurableEndpointRecord[],
  remoteLister: NonNullable<DurableSessionAuditOptions["remoteLister"]>,
): Promise<{
  rows: DurableSessionAuditRow[];
  missing: Array<{ paneId: string; name: string }>;
}> => {
  const groups = new Map<string, DurableEndpointRecord[]>();
  for (const record of records) {
    const key = durableEndpointKey(record.machine);
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }
  const auditGroup = async (group: DurableEndpointRecord[]) => {
    const representative = group[0];
    const endpoint = displayEndpoint(representative);
    let observed: DurableSessionObservationResult;
    try {
      observed = await remoteLister(representative.machine);
    } catch (error) {
      observed = {
        reachable: false,
        detail: error instanceof Error ? error.message : String(error),
        sessions: [],
      };
    }
    if (!observed.reachable) {
      return {
        rows: group.map((record): DurableSessionAuditRow => ({
          backend: backendForRecord(record),
          name: durableSessionName(record.paneId),
          paneId: record.paneId,
          attached: false,
          detail: observed.detail || "endpoint unreachable",
          activePane: record.status === "active",
          status: "unreachable",
          cleanupAllowed: false,
          remote: true,
          machineId: record.machine.id,
          machineName: record.machine.name,
          endpoint,
          cleanupKey: record.id,
        })),
        missing: [],
      };
    }

    const observationsByName = new Map<string, typeof observed.sessions>();
    for (const session of observed.sessions) {
      const siblings = observationsByName.get(session.name) ?? [];
      siblings.push(session);
      observationsByName.set(session.name, siblings);
    }
    const rows = observed.sessions.map((session): DurableSessionAuditRow => {
      const matching = group.filter((record) => durableSessionName(record.paneId) === session.name);
      const activeRecord = matching.find((record) => record.status === "active");
      const siblings = observationsByName.get(session.name) ?? [];
      const preferredBackend = activeRecord?.machine.sessionBackend === "screen"
        ? "screen"
        : activeRecord?.machine.sessionBackend === "tmux"
          ? "tmux"
          : siblings.some((candidate) => candidate.backend === "tmux")
            ? "tmux"
            : siblings[0]?.backend;
      const duplicate = Boolean(activeRecord)
        && siblings.length > 1
        && session.backend !== preferredBackend;
      const cleanupRecord = matching.find((record) => record.status === "stranded")
        ?? (duplicate ? activeRecord : undefined)
        ?? (!activeRecord ? representative : undefined);
      return {
        ...session,
        activePane: Boolean(activeRecord),
        status: activeRecord ? (duplicate ? "duplicate" : "active") : "orphan",
        cleanupAllowed: !activeRecord || duplicate,
        remote: true,
        machineId: representative.machine.id,
        machineName: representative.machine.name,
        endpoint,
        cleanupKey: cleanupRecord?.id,
      };
    });
    const observedNames = new Set(observed.sessions.map((session) => session.name));
    const missing: Array<{ paneId: string; name: string }> = [];
    for (const record of group) {
      const name = durableSessionName(record.paneId);
      if (observedNames.has(name)) continue;
      if (record.status === "active") {
        missing.push({ paneId: record.paneId, name });
        continue;
      }
      rows.push({
        backend: backendForRecord(record),
        name,
        paneId: record.paneId,
        attached: false,
        detail: `recorded stranded endpoint; session not found at ${endpoint}`,
        activePane: false,
        status: "orphan",
        cleanupAllowed: true,
        remote: true,
        machineId: record.machine.id,
        machineName: record.machine.name,
        endpoint,
        cleanupKey: record.id,
      });
    }
    return { rows, missing };
  };
  const endpointGroups = [...groups.values()];
  const results = new Array<Awaited<ReturnType<typeof auditGroup>>>(endpointGroups.length);
  let nextGroup = 0;
  const workers = Array.from(
    { length: Math.min(4, endpointGroups.length) },
    async () => {
      while (nextGroup < endpointGroups.length) {
        const index = nextGroup;
        nextGroup += 1;
        results[index] = await auditGroup(endpointGroups[index]);
      }
    },
  );
  await Promise.all(workers);
  return {
    rows: results.flatMap((result) => result.rows),
    missing: results.flatMap((result) => result.missing),
  };
};

const auditRemoteAgentSessions = async (
  records: DurableEndpointRecord[],
  agentLister: NonNullable<DurableSessionAuditOptions["agentLister"]>,
): Promise<{
  rows: DurableSessionAuditRow[];
  missing: Array<{ paneId: string; name: string }>;
}> => {
  const groups = new Map<string, DurableEndpointRecord[]>();
  for (const record of records) {
    const key = durableEndpointKey(record.machine);
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }
  const auditGroup = async (group: DurableEndpointRecord[]) => {
    const representative = group[0];
    const endpoint = displayEndpoint(representative);
    let observed: SessionAgentObservationResult;
    try {
      observed = await agentLister(representative.machine);
    } catch (error) {
      observed = {
        reachable: false,
        detail: error instanceof Error ? error.message : String(error),
        sessions: [],
      };
    }
    if (!observed.reachable) {
      return {
        rows: group.map((record): DurableSessionAuditRow => ({
          backend: "agent",
          name: durableSessionName(record.paneId),
          paneId: record.paneId,
          attached: false,
          detail: observed.detail || "endpoint unreachable",
          activePane: record.status === "active",
          status: "unreachable",
          cleanupAllowed: false,
          remote: true,
          machineId: record.machine.id,
          machineName: record.machine.name,
          endpoint,
          cleanupKey: record.id,
        })),
        missing: [],
      };
    }

    const sessions = new Map(
      observed.sessions.map((session) => [session.paneId, session]),
    );
    const rows: DurableSessionAuditRow[] = [];
    const missing: Array<{ paneId: string; name: string }> = [];
    for (const record of group) {
      const name = durableSessionName(record.paneId);
      const session = sessions.get(record.paneId);
      if (session) {
        rows.push({
          backend: "agent",
          name,
          paneId: record.paneId,
          attached: record.status === "active",
          detail: session.detail,
          activePane: record.status === "active",
          status: record.status === "active" ? "active" : "orphan",
          cleanupAllowed: record.status === "stranded",
          remote: true,
          machineId: record.machine.id,
          machineName: record.machine.name,
          endpoint,
          cleanupKey: record.id,
        });
      } else if (record.status === "active") {
        missing.push({ paneId: record.paneId, name });
      } else {
        rows.push({
          backend: "agent",
          name,
          paneId: record.paneId,
          attached: false,
          detail: `recorded stranded endpoint; session not found at ${endpoint}`,
          activePane: false,
          status: "orphan",
          cleanupAllowed: true,
          remote: true,
          machineId: record.machine.id,
          machineName: record.machine.name,
          endpoint,
          cleanupKey: record.id,
        });
      }
    }
    return { rows, missing };
  };
  const endpointGroups = [...groups.values()];
  const results = new Array<Awaited<ReturnType<typeof auditGroup>>>(endpointGroups.length);
  let nextGroup = 0;
  const workers = Array.from(
    { length: Math.min(4, endpointGroups.length) },
    async () => {
      while (nextGroup < endpointGroups.length) {
        const index = nextGroup;
        nextGroup += 1;
        results[index] = await auditGroup(endpointGroups[index]);
      }
    },
  );
  await Promise.all(workers);
  return {
    rows: results.flatMap((result) => result.rows),
    missing: results.flatMap((result) => result.missing),
  };
};

const cleanupRemoteDurableSession = async (
  backend: "tmux" | "screen" | "agent",
  name: string,
  cleanupKey: string,
  statePath: string,
  options: DurableSessionAuditOptions,
): Promise<DurableSessionAudit> => {
  const audit = await auditDurableSessions(statePath, options);
  const row = audit.sessions.find((candidate) =>
    candidate.backend === backend
    && candidate.name === name
    && candidate.cleanupKey === cleanupKey);
  if (!row) throw new Error("unknown durable endpoint cleanup target");
  if (!row.cleanupAllowed) {
    throw new Error("refusing to clean up an active remote wmux session");
  }
  const store = new DurableEndpointStore(
    options.endpointPath ?? endpointStorePath(statePath),
  );
  const record = store.find(cleanupKey);
  if (
    !record
    || (backend === "agent"
      ? record.backend !== "windows-agent"
      : record.backend !== "durable-multiplexer")
  ) {
    throw new Error("unknown durable endpoint cleanup target");
  }
  const recordName = durableSessionName(record.paneId);
  const paneId = paneIdFromSession(name);
  if (!paneId) throw new Error("invalid wmux session name");
  const cleaned = backend === "agent"
    ? await (options.agentDisposer ?? deleteWindowsAgentSession)(
      record.machine,
      paneId,
    )
    : await (options.remoteDisposer ?? disposeDurableSession)(
      { ...record.machine, sessionBackend: backend },
      paneId,
    );
  if (!cleaned) throw new Error("remote durable session cleanup failed");
  if (record.status === "stranded" && recordName === name) store.delete(record.id);
  return auditDurableSessions(statePath, options);
};

const backendForRecord = (
  record: DurableEndpointRecord,
): "tmux" | "screen" =>
  record.machine.sessionBackend === "screen" ? "screen" : "tmux";

const displayEndpoint = (record: DurableEndpointRecord): string => {
  const machine = record.machine;
  if (record.backend === "windows-agent") {
    const agentUrl = windowsAgentUrl(machine);
    if (!agentUrl) return machine.id;
    try {
      const parsed = new URL(agentUrl);
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      return machine.id;
    }
  }
  const host = machine.host ?? machine.id;
  const target = machine.user ? `${machine.user}@${host}` : host;
  return machine.port ? `${target}:${machine.port}` : target;
};
