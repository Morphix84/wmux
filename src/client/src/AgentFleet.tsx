import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import type {
  AgentTimelineEntry,
  BootstrapPayload,
  DelegationAttentionReason,
  DelegationRecord,
  MachineStatus,
} from "./types";
import { workspaceTabPath } from "./route-state";

export interface AgentFleetRow {
  id: string;
  runtime: string;
  title: string;
  workspaceId: string;
  workspaceName: string;
  tabId: string;
  paneId: string;
  machineId: string;
  machineName: string;
  state: DelegationRecord["state"];
  attentionReason?: DelegationAttentionReason;
  updatedAt: string;
  lastEntry?: AgentTimelineEntry;
}

export const buildAgentFleetRows = (
  state: BootstrapPayload,
  machines: MachineStatus[],
): AgentFleetRow[] => {
  const timelines = new Map(
    state.agentTimelines.map((timeline) => [timeline.id, timeline]),
  );
  const machineNames = new Map(
    machines.map((machine) => [machine.id, machine.name]),
  );
  return state.delegations
    .filter(
      (delegation) =>
        delegation.state === "running"
        || delegation.state === "waiting"
        || Boolean(delegation.attentionReason),
    )
    .map((delegation): AgentFleetRow => {
      const workspace = state.workspaces.find(
        (candidate) => candidate.id === delegation.workspaceId,
      );
      const tab = workspace?.tabs.find(
        (candidate) => candidate.id === delegation.tabId,
      );
      const pane = tab?.panes.find(
        (candidate) => candidate.id === delegation.paneId,
      );
      const machineId =
        delegation.machineId
        ?? pane?.machineId
        ?? workspace?.machineId
        ?? "unknown";
      const timeline = timelines.get(delegation.sessionId);
      return {
        id: delegation.runId,
        runtime: delegation.runtime,
        title: delegation.title || delegation.summary || delegation.runtime,
        workspaceId: delegation.workspaceId,
        workspaceName: workspace?.name ?? "workspace removed",
        tabId: delegation.tabId,
        paneId: delegation.paneId,
        machineId,
        machineName: machineNames.get(machineId) ?? machineId,
        state: delegation.state,
        ...(delegation.attentionReason
          ? { attentionReason: delegation.attentionReason }
          : {}),
        updatedAt: delegation.updatedAt,
        lastEntry: timeline?.entries.at(-1),
      };
    })
    .sort((first, second) => {
      const priorityDifference =
        fleetRowPriority(first) - fleetRowPriority(second);
      if (priorityDifference !== 0) return priorityDifference;
      return Date.parse(second.updatedAt) - Date.parse(first.updatedAt);
    });
};

export function AgentFleet({
  state,
  machines,
  onClose,
  onOpenSession,
}: {
  state: BootstrapPayload;
  machines: MachineStatus[];
  onClose: () => void;
  onOpenSession: (row: AgentFleetRow) => void;
}) {
  const rows = useMemo(
    () => buildAgentFleetRows(state, machines),
    [machines, state],
  );
  const attentionCount = rows.filter((row) => row.attentionReason).length;
  const activeCount = rows.filter(
    (row) => row.state === "running" || row.state === "waiting",
  ).length;
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    closeRef.current?.focus();
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => {
      window.clearInterval(timer);
      returnFocusRef.current?.focus();
    };
  }, []);

  return (
    <div
      className="agent-fleet-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        className="agent-fleet"
        role="dialog"
        aria-modal="true"
        aria-label="Agent fleet"
        data-event-revision={state.eventRevision}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          onClose();
        }}
      >
        <header className="agent-fleet-header">
          <div>
            <span>// AGENT FLEET</span>
            <strong>{rows.length} SESSIONS</strong>
          </div>
          <div className="agent-fleet-summary">
            <span>[RUN {activeCount}]</span>
            <span className={attentionCount > 0 ? "attention" : ""}>
              [WAIT {attentionCount}]
            </span>
            <button
              ref={closeRef}
              type="button"
              aria-label="Close agent fleet"
              title="Close agent fleet"
              onClick={onClose}
            >
              <X size={15} />
            </button>
          </div>
        </header>
        <div className="agent-fleet-columns" aria-hidden="true">
          <span>STATE</span>
          <span>RUNTIME / SESSION</span>
          <span>HOST</span>
          <span>IN STATE</span>
        </div>
        <div className="agent-fleet-list" role="list">
          {rows.length > 0 ? rows.map((row) => (
            <a
              key={row.id}
              className={`agent-fleet-row ${row.attentionReason ? "attention" : ""}`}
              href={workspaceTabPath(row.workspaceId, row.tabId)}
              role="listitem"
              data-agent-run-id={row.id}
              data-agent-state={row.state}
              data-agent-machine={row.machineId}
              onClick={(event) => {
                event.preventDefault();
                onOpenSession(row);
              }}
            >
              <span className="agent-fleet-state">
                {fleetStateToken(row)}
              </span>
              <span className="agent-fleet-identity">
                <strong>{row.runtime}</strong>
                <span>{row.title}</span>
                <small>{row.workspaceName}</small>
              </span>
              <span className="agent-fleet-machine">
                {row.machineName}
              </span>
              <span className="agent-fleet-elapsed">
                {formatFleetElapsed(row.updatedAt, nowMs)}
              </span>
              <span className="agent-fleet-entry">
                {compactFleetText(
                  row.lastEntry?.text
                    || (row.attentionReason
                      ? attentionLabel(row.attentionReason)
                      : row.state),
                )}
              </span>
            </a>
          )) : (
            <div className="agent-fleet-empty">
              [IDLE] No agent sessions have reported yet.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

const fleetRowPriority = (row: AgentFleetRow): number => {
  if (row.attentionReason) return 0;
  if (row.state === "waiting") return 1;
  if (row.state === "running") return 2;
  return 3;
};

const fleetStateToken = (row: AgentFleetRow): string => {
  if (row.attentionReason) {
    return `[${row.attentionReason.toUpperCase()}]`;
  }
  return `[${row.state.toUpperCase()}]`;
};

const attentionLabel = (reason: DelegationAttentionReason): string => ({
  approval: "Waiting for approval",
  login: "Waiting for login",
  blocked: "Blocked outcome",
  input: "Waiting for input",
})[reason];

export const formatFleetElapsed = (
  updatedAt: string,
  nowMs = Date.now(),
): string => {
  const elapsedMs = Math.max(0, nowMs - Date.parse(updatedAt));
  const seconds = Math.floor(elapsedMs / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
};

const compactFleetText = (value: string, limit = 240): string => {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, limit - 1).trimEnd()}…`;
};
