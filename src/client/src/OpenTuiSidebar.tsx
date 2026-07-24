import { useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import {
  createGrid,
  createGridPainter,
  fillCells,
  fitText,
  observeCanvasViewport,
  syncPainterViewport,
  writeText,
  type CellGrid,
  type CellMetrics,
  type RGBA,
} from "./opentui-grid";
import { WMUX_MONO_FONT_FAMILY } from "./fonts";
import { compactMiddlePath } from "./path-display";
import { workspaceTabPath } from "./route-state";
import { formatSessionReference } from "./session-reference";
import type { MachineVersionStatus, Workspace, WorkspaceReorderPosition } from "./types";
import { useOpenTuiTheme, type OpenTuiTheme } from "./color-scheme-context";
import { WorkspaceMoveDialog } from "./WorkspaceMoveDialog";
import { remainingWorkspaceRowCount, workspacePointerMovePosition, type WorkspaceAgentStatus, type WorkspaceMoveIntent } from "./workspace-tree";

export interface OpenTuiSidebarWorkspace {
  id: string;
  tabId: string;
  title: string;
  descriptor: string;
  machineId: string;
  host: string;
  cwd?: string;
  reachable: boolean;
  active: boolean;
  unreadCount: number;
  agentCreated?: boolean;
  agentName?: string;
  agentStatus?: "running" | "waiting" | "completed" | "failed" | "updated";
  sessionId?: string;
  versionStatus?: MachineVersionStatus;
  versionLabel?: string;
  versionDetail?: string;
  bell?: boolean;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  hiddenUnreadCount: number;
  hiddenBell: boolean;
  hiddenAgentStatus?: WorkspaceAgentStatus;
  canOutdent: boolean;
}

export interface OpenTuiSidebarMachine {
  id: string;
  name: string;
  version?: string;
  reachable: boolean;
  detail: string;
  workspaceCount: number;
  activeAgentCount: number;
}

interface OpenTuiSidebarProps {
  targetMachineId: string;
  targetMachineName: string;
  targetMachineReachable: boolean;
  workspaces: OpenTuiSidebarWorkspace[];
  machines: OpenTuiSidebarMachine[];
  onTargetMachineChange: (machineId: string) => void;
  onCreateWorkspace: () => void;
  onActivateWorkspace: (workspaceId: string, tabId: string) => void;
  onReorderWorkspace: (
    workspaceId: string,
    targetWorkspaceId: string | undefined,
    position: WorkspaceReorderPosition,
  ) => void | Promise<void>;
  onToggleWorkspace: (workspaceId: string) => void | Promise<void>;
  movesDisabled: boolean;
  allWorkspaces: Workspace[];
}

type HitAction =
  | { type: "create-workspace" }
  | { type: "select-space"; machineId: string }
  | { type: "workspace"; workspaceId: string; tabId: string }
  | { type: "toggle-workspace"; workspaceId: string }
  | { type: "outdent-workspace"; workspaceId: string };

interface HitZone {
  row: number;
  col: number;
  width: number;
  action: HitAction;
  title: string;
}

const runningFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const statusBullet = "●";

interface SidebarRenderModel {
  targetMachineId: string;
  targetMachineName: string;
  targetMachineReachable: boolean;
  animationTick: number;
  workspaces: OpenTuiSidebarWorkspace[];
  machines: OpenTuiSidebarMachine[];
  workspaceDropPreview: WorkspaceDropPreview | null;
  workspaceScrollOffset: number;
  movesDisabled: boolean;
}

interface WorkspaceDropPreview {
  workspaceId: string;
  targetWorkspaceId: string;
  position: WorkspaceReorderPosition;
}

interface WorkspacePointerDrag {
  pointerId: number;
  workspaceId: string;
  startX: number;
  startY: number;
  dragging: boolean;
  targetWorkspaceId?: string;
  position?: WorkspaceReorderPosition;
}

interface SemanticWorkspaceRow {
  workspace: OpenTuiSidebarWorkspace;
  row: number;
  rowCount: number;
}

interface SemanticSpaceRow {
  machine: OpenTuiSidebarMachine;
  row: number;
  rowCount: number;
}

export function OpenTuiSidebar({
  targetMachineId,
  targetMachineName,
  targetMachineReachable,
  workspaces,
  machines,
  onTargetMachineChange,
  onCreateWorkspace,
  onActivateWorkspace,
  onReorderWorkspace,
  onToggleWorkspace,
  movesDisabled,
  allWorkspaces,
}: OpenTuiSidebarProps) {
  const theme = useOpenTuiTheme();
  const [animationTick, setAnimationTick] = useState(0);
  const [workspaceDropPreview, setWorkspaceDropPreview] = useState<WorkspaceDropPreview | null>(null);
  const [workspaceScrollOffset, setWorkspaceScrollOffset] = useState(0);
  const [moveWorkspace, setMoveWorkspace] = useState<{ workspaceId: string; returnFocus: HTMLElement | null } | null>(null);
  const [semanticRows, setSemanticRows] = useState<SemanticWorkspaceRow[]>([]);
  const [semanticSpaces, setSemanticSpaces] = useState<SemanticSpaceRow[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hitsRef = useRef<HitZone[]>([]);
  const metricsRef = useRef<CellMetrics>({ width: 8, height: 16, cols: 1, rows: 1 });
  const paintRef = useRef<(() => void) | null>(null);
  const workspaceDragRef = useRef<WorkspacePointerDrag | null>(null);
  const suppressClickRef = useRef(false);
  const hasRunningWorkspace = workspaces.some((workspace) => workspace.agentStatus === "running");

  useEffect(() => {
    setWorkspaceScrollOffset((value) => Math.min(value, Math.max(0, workspaces.length - 1)));
  }, [workspaces.length]);

  useEffect(() => {
    if (!hasRunningWorkspace) return;
    const timer = window.setInterval(() => setAnimationTick((value) => (value + 1) % runningFrames.length), 280);
    return () => window.clearInterval(timer);
  }, [hasRunningWorkspace]);

  const renderModel = useMemo<SidebarRenderModel>(
    () => ({
      targetMachineId,
      targetMachineName,
      targetMachineReachable,
      animationTick,
      workspaces,
      machines,
      workspaceDropPreview,
      workspaceScrollOffset,
      movesDisabled,
    }),
    [animationTick, machines, movesDisabled, targetMachineId, targetMachineName, targetMachineReachable, workspaceDropPreview, workspaceScrollOffset, workspaces],
  );
  const renderModelRef = useRef(renderModel);

  useEffect(() => {
    renderModelRef.current = renderModel;
    paintRef.current?.();
  }, [renderModel]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const painter = createGridPainter(canvas, {
      fontSize: 12,
      fontFamily: WMUX_MONO_FONT_FAMILY,
      cellVAlign: "middle",
      clearColor: theme.colors.black,
    });

    const paint = (entry?: ResizeObserverEntry) => {
      const metrics = syncPainterViewport(painter, canvas, entry);
      metricsRef.current = metrics;
      const result = drawSidebarGrid(metricsRef.current, renderModelRef.current, hitsRef, theme);
      painter.paint(result.grid);
      setSemanticRows((current) => sameSemanticRows(current, result.semanticRows) ? current : result.semanticRows);
      setSemanticSpaces((current) => sameSemanticSpaces(current, result.semanticSpaces) ? current : result.semanticSpaces);
    };

    paintRef.current = () => paint();
    paint();
    const observer = observeCanvasViewport(canvas, paint);
    return () => {
      paintRef.current = null;
      observer.disconnect();
      painter.dispose();
    };
  }, [theme]);

  const hitAt = (clientX: number, clientY: number): HitZone | undefined => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const rect = canvas.getBoundingClientRect();
    const row = Math.floor((clientY - rect.top) / metricsRef.current.height);
    const col = Math.floor((clientX - rect.left) / metricsRef.current.width);
    return hitsRef.current.find((candidate) => candidate.row === row && col >= candidate.col && col < candidate.col + candidate.width);
  };

  const onClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    const hit = hitAt(event.clientX, event.clientY);
    if (!hit) return;
    if (hit.action.type === "create-workspace") onCreateWorkspace();
    if (hit.action.type === "select-space") {
      onTargetMachineChange(hit.action.machineId);
    }
    if (hit.action.type === "workspace") onActivateWorkspace(hit.action.workspaceId, hit.action.tabId);
    if (hit.action.type === "toggle-workspace") void onToggleWorkspace(hit.action.workspaceId);
    if (hit.action.type === "outdent-workspace" && !movesDisabled) void onReorderWorkspace(hit.action.workspaceId, undefined, "out-of");
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 || movesDisabled) return;
    const hit = hitAt(event.clientX, event.clientY);
    if (hit?.action.type !== "workspace") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    workspaceDragRef.current = {
      pointerId: event.pointerId,
      workspaceId: hit.action.workspaceId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const drag = workspaceDragRef.current;
    if (drag?.pointerId === event.pointerId) {
      if (!drag.dragging && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 5) {
        drag.dragging = true;
        suppressClickRef.current = true;
      }
      if (drag.dragging) {
        event.preventDefault();
        const hit = hitAt(event.clientX, event.clientY);
        if (hit?.action.type === "workspace" && hit.action.workspaceId !== drag.workspaceId) {
          const targetWorkspaceId = hit.action.workspaceId;
          const targetRows = hitsRef.current
            .filter((candidate) => candidate.action.type === "workspace" && candidate.action.workspaceId === targetWorkspaceId)
            .map((candidate) => candidate.row);
          const firstRow = Math.min(...targetRows);
          const lastRow = Math.max(...targetRows);
          const relativeRow = (hit.row - firstRow + 0.5) / Math.max(1, lastRow - firstRow + 1);
          const position = workspacePointerMovePosition(relativeRow);
          drag.targetWorkspaceId = targetWorkspaceId;
          drag.position = position;
          const nextPreview = {
            workspaceId: drag.workspaceId,
            targetWorkspaceId,
            position,
          };
          setWorkspaceDropPreview((current) =>
            current?.workspaceId === nextPreview.workspaceId &&
            current.targetWorkspaceId === nextPreview.targetWorkspaceId &&
            current.position === nextPreview.position
              ? current
              : nextPreview,
          );
        } else {
          drag.targetWorkspaceId = undefined;
          drag.position = undefined;
          setWorkspaceDropPreview(null);
        }
        canvas.style.cursor = "grabbing";
        canvas.title = "Reorder workspace";
        return;
      }
    }
    const hit = hitAt(event.clientX, event.clientY);
    canvas.style.cursor = hit ? "pointer" : "default";
    canvas.title = hit?.action.type === "workspace" ? `${hit.title} / drag to reorder` : hit?.title ?? "";
  };

  const finishWorkspaceDrag = (event: React.PointerEvent<HTMLCanvasElement>, cancelled = false) => {
    const drag = workspaceDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    workspaceDragRef.current = null;
    setWorkspaceDropPreview(null);
    event.currentTarget.style.cursor = "default";
    event.currentTarget.title = "";
    if (drag.dragging) window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
    if (!cancelled && drag.dragging && drag.targetWorkspaceId && drag.position) {
      void onReorderWorkspace(drag.workspaceId, drag.targetWorkspaceId, drag.position);
    }
  };

  return (
    <aside id="wmux-sidebar" className="sidebar open-tui-sidebar" aria-label="Workspace navigation">
      <canvas
        ref={canvasRef}
        className="open-tui-canvas"
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishWorkspaceDrag}
        onPointerCancel={(event) => finishWorkspaceDrag(event, true)}
        onWheel={(event) => {
          if (event.deltaY === 0 || workspaces.length === 0) return;
          event.preventDefault();
          setWorkspaceScrollOffset((value) => Math.max(0, Math.min(workspaces.length - 1, value + (event.deltaY > 0 ? 1 : -1))));
        }}
      />
      <div className="open-tui-sidebar-semantics">
        <nav aria-label="Spaces">
          {semanticSpaces.map(({ machine, row, rowCount }) => (
            <button
              key={machine.id}
              type="button"
              className="open-tui-space-semantic"
              style={{ top: row * metricsRef.current.height, height: rowCount * metricsRef.current.height }}
              aria-current={machine.id === targetMachineId ? "true" : undefined}
              aria-label={`${machine.name}, ${machine.reachable ? "online" : "offline"}, ${machine.workspaceCount} ${machine.workspaceCount === 1 ? "agent session" : "agent sessions"}`}
              onClick={() => onTargetMachineChange(machine.id)}
            />
          ))}
        </nav>
        <div
          role="tree"
          aria-label="Agents"
          data-grouping="space"
          data-target-space-id={targetMachineId}
        >
        {semanticRows.map(({ workspace, row, rowCount }) => (
          <div
            key={workspace.id}
            className="open-tui-semantic-row"
            style={{ top: row * metricsRef.current.height, height: rowCount * metricsRef.current.height }}
          >
            <a
              href={workspaceTabPath(workspace.id, workspace.tabId)}
              role="treeitem"
              aria-level={workspace.depth + 1}
              aria-current={workspace.active ? "page" : undefined}
              aria-expanded={workspace.hasChildren ? workspace.expanded : undefined}
              aria-label={`${workspace.title}${workspace.agentCreated ? `, created by ${workspace.agentName ?? "an agent"}` : ""}${workspace.hiddenUnreadCount ? `, ${workspace.hiddenUnreadCount} hidden unread` : ""}${workspace.hiddenAgentStatus ? `, hidden descendant agent status ${workspace.hiddenAgentStatus}` : ""}`}
              data-agent-created={workspace.agentCreated ? "true" : undefined}
              onClick={(event) => {
                if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                onActivateWorkspace(workspace.id, workspace.tabId);
              }}
            />
            {workspace.hasChildren ? (
              <button className="semantic-disclosure" type="button" aria-label={`${workspace.expanded ? "Collapse" : "Expand"} ${workspace.title}`} onClick={() => void onToggleWorkspace(workspace.id)} />
            ) : null}
            {!movesDisabled ? <button className="semantic-move" type="button" aria-label={`Move ${workspace.title}`} onClick={(event) => setMoveWorkspace({ workspaceId: workspace.id, returnFocus: event.currentTarget })} /> : null}
          </div>
        ))}
        </div>
      </div>
      {moveWorkspace ? (
        <WorkspaceMoveDialog
          workspaceId={moveWorkspace.workspaceId}
          workspaces={allWorkspaces}
          returnFocus={moveWorkspace.returnFocus}
          onClose={() => setMoveWorkspace(null)}
          onMove={(intent: WorkspaceMoveIntent) => onReorderWorkspace(intent.workspaceId, intent.targetWorkspaceId, intent.position)}
        />
      ) : null}
    </aside>
  );
}

const drawSidebarGrid = (
  metrics: CellMetrics,
  model: SidebarRenderModel,
  hitsRef: MutableRefObject<HitZone[]>,
  theme: OpenTuiTheme,
): { grid: CellGrid; semanticRows: SemanticWorkspaceRow[]; semanticSpaces: SemanticSpaceRow[] } => {
  const { rgba } = theme;
  const agentStatusColors = {
    completed: rgba.green,
    failed: rgba.red,
    running: rgba.blue,
    updated: rgba.gold,
    waiting: rgba.gold,
  };
  const inactiveAgentBackgrounds = {
    completed: rgba.black,
    failed: rgba.failedSoft,
    running: rgba.runningSoft,
    updated: rgba.black,
    waiting: rgba.activeSoft,
  };
  const reachColor = (reachable: boolean): RGBA => reachable ? rgba.green : rgba.red;
  const { cols, rows } = metrics;
  const grid = createGrid(cols, rows, rgba.black, rgba.text);
  const hits: HitZone[] = [];
  const semanticRows: SemanticWorkspaceRow[] = [];
  const semanticSpaces: SemanticSpaceRow[] = [];
  hitsRef.current = hits;

  const fillRow = (row: number, color: RGBA) => {
    if (row < 0 || row >= rows) return;
    fillCells(grid, row, 0, cols, color);
  };
  const write = (row: number, col: number, text: string, color: RGBA, weight: 400 | 600 | 700 = 600) => {
    if (row < 0 || row >= rows || col >= cols) return;
    writeText(grid, row, col, fitText(text, Math.max(0, cols - col - 1)), color, weight >= 700 ? 1 : 0);
  };
  const writeWithin = (
    row: number,
    col: number,
    text: string,
    maxCells: number,
    color: RGBA,
    weight: 400 | 600 | 700 = 600,
  ) => {
    if (row < 0 || row >= rows || col >= cols || maxCells <= 0) return;
    writeText(grid, row, col, fitText(text, maxCells), color, weight >= 700 ? 1 : 0);
  };
  const writeCompactPath = (row: number, col: number, pathValue: string) => {
    const maxPathCells = Math.max(0, cols - col - 1);
    const compact = compactMiddlePath(pathValue, maxPathCells);
    let cursor = col;
    if (!compact.compacted) {
      write(row, cursor, compact.text, rgba.muted, 700);
      return;
    }
    write(row, cursor, compact.prefix, rgba.muted, 700);
    cursor += compact.prefix.length;
    write(row, cursor, compact.marker, rgba.faint, 600);
    cursor += compact.marker.length;
    write(row, cursor, compact.suffix, rgba.muted, 700);
  };
  const section = (row: number, label: string) => {
    write(row, 1, label.toUpperCase(), rgba.goldDim, 700);
  };
  const actionCells = (row: number, col: number, width: number, title: string, action: HitAction) => {
    if (row >= 0 && row < rows && width > 0) hits.push({ row, col, width, title, action });
  };
  const actionRows = (startRow: number, count: number, title: string, action: HitAction) => {
    for (let offset = 0; offset < count; offset += 1) {
      actionCells(startRow + offset, 0, cols, title, action);
    }
  };

  let row = 1;
  write(row, 1, "WMUX", rgba.gold, 700);
  row += 2;

  section(row, "spaces");
  const spaceCount = String(model.machines.length);
  write(row, Math.max(10, cols - spaceCount.length - 1), spaceCount, rgba.faint, 700);
  if (model.targetMachineReachable) {
    const newLabel = "[+]";
    const newCol = Math.max(10, cols - spaceCount.length - newLabel.length - 3);
    write(row, newCol, newLabel, rgba.gold, 700);
    actionCells(row, newCol, newLabel.length, `New agent session on ${model.targetMachineName}`, { type: "create-workspace" });
  }
  row++;
  const maxVisibleSpaces = Math.max(1, Math.floor((rows - row - 12) / 2));
  const visibleSpaces = model.machines.slice(0, maxVisibleSpaces);
  for (const machine of visibleSpaces) {
    const itemStart = row;
    const activeTarget = machine.id === model.targetMachineId;
    for (let offset = 0; offset < 2; offset += 1) {
      fillRow(row + offset, activeTarget ? (offset === 0 ? rgba.active : rgba.activeSoft) : rgba.black);
      if (activeTarget) write(row + offset, 0, "▌", rgba.gold, 700);
    }
    write(row, 2, activeTarget ? ">" : " ", activeTarget ? rgba.gold : rgba.faint, 700);
    write(row, 4, statusBullet, reachColor(machine.reachable), 700);
    const countLabel = machine.activeAgentCount > 0
      ? `${machine.workspaceCount}/${machine.activeAgentCount}`
      : String(machine.workspaceCount);
    const countCol = Math.max(8, cols - countLabel.length - 1);
    write(row, countCol, countLabel, machine.activeAgentCount > 0 ? rgba.goldDim : rgba.faint, 700);
    writeWithin(
      row,
      6,
      machine.name,
      Math.max(0, countCol - 7),
      machine.reachable ? rgba.text : rgba.muted,
      activeTarget ? 700 : 600,
    );
    row++;
    const versionLabel = machine.version ?? (machine.reachable ? "online" : "offline");
    const spaceContext = activeTarget ? `target · ${versionLabel}` : versionLabel;
    write(row, 6, spaceContext, activeTarget ? rgba.goldDim : rgba.faint, 700);
    if (machine.detail && cols > 28) {
      const detailCol = 6 + spaceContext.length + 3;
      write(row, 6 + spaceContext.length, " · ", rgba.faint);
      write(row, detailCol, machine.detail, machine.reachable ? rgba.faint : rgba.red);
    }
    actionRows(itemStart, 2, `Select ${machine.name} space`, { type: "select-space", machineId: machine.id });
    semanticSpaces.push({ machine, row: itemStart, rowCount: 2 });
    row++;
  }
  const hiddenSpaceCount = model.machines.length - visibleSpaces.length;
  if (hiddenSpaceCount > 0) {
    write(row, 6, `+${hiddenSpaceCount} more spaces`, rgba.faint);
    row++;
  }

  write(row, 0, "─".repeat(cols), rgba.panel);
  row++;
  section(row, "agents");
  const activeAgentCount = model.workspaces.filter((workspace) =>
    workspace.agentStatus === "running" || workspace.agentStatus === "waiting").length;
  const workspaceCountLabel = activeAgentCount > 0
    ? `${model.workspaces.length} / ${activeAgentCount} ACTIVE`
    : `${model.workspaces.length}`;
  write(
    row,
    Math.max(13, cols - workspaceCountLabel.length - 1),
    workspaceCountLabel,
    activeAgentCount > 0 ? rgba.goldDim : rgba.faint,
    700,
  );
  row++;
  write(row, 3, "all sessions", rgba.faint, 700);
  write(row, Math.max(13, cols - 8), "GROUPED", rgba.faint, 700);
  row += 2;
  const workspaceEndRow = rows - 1;
  let visibleWorkspaceCount = 0;
  if (model.workspaces.length === 0) {
    write(row, 3, "NO AGENT SESSIONS", rgba.faint, 700);
    row += 2;
  } else {
    const remainingWorkspaces = model.workspaces.slice(model.workspaceScrollOffset);
    const groupedWorkspaces = new Map<string, OpenTuiSidebarWorkspace[]>();
    for (const workspace of remainingWorkspaces) {
      const group = groupedWorkspaces.get(workspace.machineId) ?? [];
      group.push(workspace);
      groupedWorkspaces.set(workspace.machineId, group);
    }
    const orderedMachineIds = [
      ...model.machines.map((machine) => machine.id),
      ...groupedWorkspaces.keys(),
    ].filter((machineId, index, machineIds) =>
      groupedWorkspaces.has(machineId) && machineIds.indexOf(machineId) === index);

    groupLoop:
    for (const machineId of orderedMachineIds) {
      const machineWorkspaces = groupedWorkspaces.get(machineId) ?? [];
      if (row + 3 >= workspaceEndRow) break;
      const machine = model.machines.find((candidate) => candidate.id === machineId);
      const groupActiveCount = machineWorkspaces.filter((workspace) =>
        workspace.agentStatus === "running" || workspace.agentStatus === "waiting").length;
      const groupCountLabel = groupActiveCount > 0
        ? `${machineWorkspaces.length}/${groupActiveCount}`
        : String(machineWorkspaces.length);
      write(row, 2, machineId === model.targetMachineId ? ">" : " ", machineId === model.targetMachineId ? rgba.gold : rgba.faint, 700);
      write(row, 4, (machine?.name ?? machineWorkspaces[0]?.host ?? machineId).toUpperCase(), machineId === model.targetMachineId ? rgba.goldDim : rgba.faint, 700);
      write(row, Math.max(10, cols - groupCountLabel.length - 1), groupCountLabel, groupActiveCount > 0 ? rgba.goldDim : rgba.faint, 700);
      row++;

      for (const workspace of machineWorkspaces) {
        const statusContext = [
          workspace.agentStatus ? sidebarAgentStatusLabel[workspace.agentStatus] : "",
          workspace.agentName,
        ].filter(Boolean);
        const statusContextLine = statusContext.join(" · ");
        const cwd = workspace.cwd?.trim() ?? "";
        const itemRows = 3;
        if (row + itemRows >= workspaceEndRow) break groupLoop;
        const itemStart = row;
        const statusColor = workspace.agentStatus
          ? agentStatusColors[workspace.agentStatus]
          : reachColor(workspace.reachable);
        const statusMarker = workspace.agentStatus === "running"
          ? runningFrames[model.animationTick]
          : workspace.agentStatus === "waiting"
            ? "?"
            : workspace.agentStatus === "completed"
              ? "✓"
              : workspace.agentStatus === "failed"
                ? "×"
                : workspace.reachable
                  ? statusBullet
                  : "○";
        const inactiveBackground = workspace.agentStatus
          ? inactiveAgentBackgrounds[workspace.agentStatus]
          : rgba.black;
        for (let offset = 0; offset < itemRows; offset += 1) {
          fillRow(row + offset, workspace.active ? (offset === 0 ? rgba.active : rgba.activeSoft) : inactiveBackground);
          if (workspace.active) write(row + offset, 0, "▌", rgba.gold, 700);
        }
        const indent = Math.min(workspace.depth, 3) * 2;
        write(row, 1, workspace.active ? ">" : " ", workspace.active ? rgba.gold : rgba.faint, 700);
        if (workspace.hasChildren) {
          write(row, 3 + indent, workspace.expanded ? "v" : ">", rgba.goldDim, 700);
          actionCells(row, 3 + indent, 1, workspace.expanded ? `Collapse ${workspace.title}` : `Expand ${workspace.title}`, { type: "toggle-workspace", workspaceId: workspace.id });
        }
        write(row, 5 + indent, statusMarker, statusColor, 700);
        const titleCol = workspace.agentCreated ? 10 + indent : 7 + indent;
        if (workspace.agentCreated) write(row, 7 + indent, "AI", rgba.agent, 700);
        const aggregateUnread = workspace.unreadCount + workspace.hiddenUnreadCount;
        const unreadText = aggregateUnread > 0 ? `(${aggregateUnread}${workspace.hiddenUnreadCount ? "*" : ""})` : "";
        const versionText = workspace.versionStatus === "outdated" && workspace.versionLabel
          ? `[${workspace.versionLabel}]`
          : "";
        const hiddenStatusText = workspace.hiddenAgentStatus ? `↳${agentStatusAbbreviation[workspace.hiddenAgentStatus]}` : "";
        let suffixCol = cols - 1;
        if (unreadText) {
          suffixCol -= unreadText.length;
          write(row, suffixCol, unreadText, rgba.gold, 700);
        }
        if (versionText) {
          if (unreadText) suffixCol--;
          suffixCol -= versionText.length;
          const versionColor = workspace.versionStatus === "current"
            ? rgba.green
            : workspace.versionStatus === "outdated"
              ? rgba.gold
              : rgba.muted;
          write(row, suffixCol, versionText, versionColor, 700);
        }
        if (hiddenStatusText) {
          if (unreadText || versionText) suffixCol--;
          suffixCol -= hiddenStatusText.length;
          write(row, suffixCol, hiddenStatusText, agentStatusColors[workspace.hiddenAgentStatus!], 700);
        }
        writeWithin(
          row,
          titleCol,
          workspace.title,
          Math.max(0, suffixCol - titleCol - 1),
          workspace.reachable ? rgba.text : rgba.muted,
          700,
        );
        if (workspace.canOutdent && !model.movesDisabled) {
          write(row, Math.max(titleCol, suffixCol - 2), "<", rgba.goldDim, 700);
          actionCells(row, Math.max(titleCol, suffixCol - 2), 1, `Move ${workspace.title} out one level`, { type: "outdent-workspace", workspaceId: workspace.id });
        }
        row++;
        if (workspace.bell || workspace.hiddenBell) {
          write(row, 5 + indent, workspace.hiddenBell ? "!*" : "!", rgba.gold, 700);
        }
        const detailCol = 7 + indent;
        if (statusContextLine) {
          write(row, detailCol, statusContextLine, statusColor);
        }
        if (workspace.descriptor) {
          const descriptorCol = detailCol + (statusContextLine ? statusContextLine.length + 3 : 0);
          if (statusContextLine) write(row, detailCol + statusContextLine.length, " · ", rgba.faint);
          write(row, descriptorCol, workspace.descriptor, rgba.muted);
        } else if (!statusContextLine) {
          write(row, detailCol, "shell", rgba.muted);
        }
        row++;
        if (cwd) {
          writeCompactPath(row, detailCol, cwd);
        } else {
          write(row, detailCol, "cwd unavailable", rgba.faint);
        }
        row++;
        actionRows(
          itemStart,
          itemRows,
          [
            workspace.agentCreated ? `${workspace.title} (agent-created)` : workspace.title,
            workspace.versionDetail,
            formatSessionReference(workspace.sessionId),
          ].filter(Boolean).join(" / "),
          { type: "workspace", workspaceId: workspace.id, tabId: workspace.tabId },
        );
        semanticRows.push({ workspace, row: itemStart, rowCount: itemRows });
        if (model.workspaceDropPreview?.targetWorkspaceId === workspace.id) {
          const previewPosition = model.workspaceDropPreview.position;
          const indicatorRow = previewPosition === "before" ? itemStart : previewPosition === "into" ? itemStart + Math.floor(itemRows / 2) : row - 1;
          write(indicatorRow, Math.max(0, cols - 4), previewPosition === "before" ? "^^" : previewPosition === "into" ? "[+]" : "vv", rgba.gold, 700);
        }
        visibleWorkspaceCount++;
      }
    }
  }

  const remainingWorkspaceCount = remainingWorkspaceRowCount(model.workspaces.length, model.workspaceScrollOffset, visibleWorkspaceCount);
  if (remainingWorkspaceCount > 0) {
    write(row, 3, `+${remainingWorkspaceCount} more`, rgba.faint);
    row += 2;
  }

  return { grid, semanticRows, semanticSpaces };
};

const agentStatusAbbreviation: Record<WorkspaceAgentStatus, string> = {
  running: "R",
  waiting: "W",
  completed: "C",
  failed: "F",
  updated: "U",
};

const sidebarAgentStatusLabel: Record<NonNullable<OpenTuiSidebarWorkspace["agentStatus"]>, string> = {
  running: "working",
  waiting: "waiting",
  completed: "done",
  failed: "failed",
  updated: "updated",
};

const sameSemanticRows = (left: SemanticWorkspaceRow[], right: SemanticWorkspaceRow[]): boolean =>
  left.length === right.length && left.every((row, index) => {
    const candidate = right[index];
    return candidate && row.workspace === candidate.workspace && row.row === candidate.row && row.rowCount === candidate.rowCount;
  });

const sameSemanticSpaces = (left: SemanticSpaceRow[], right: SemanticSpaceRow[]): boolean =>
  left.length === right.length && left.every((row, index) => {
    const candidate = right[index];
    return candidate && row.machine === candidate.machine && row.row === candidate.row && row.rowCount === candidate.rowCount;
  });
