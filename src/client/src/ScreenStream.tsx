import { ExternalLink, ScreenShare, X } from "lucide-react";
import { Fragment, useEffect, useMemo } from "react";
import type { MachineStatus, StreamStatus } from "./types";

interface ScreenStreamViewerProps {
  machine: MachineStatus | undefined;
  stream: StreamStatus | undefined;
  onRequest: (machineId: string, requestId: string, ttlMs: number) => void;
  onRelease: (machineId: string, requestId: string) => void;
  onClose: () => void;
}

const STREAM_REQUEST_TTL_MS = 20_000;
const STREAM_REQUEST_HEARTBEAT_MS = 5_000;

// All provider-specific UI in one place; adding a stream provider means adding
// one descriptor here plus a StreamProviderBackend on the server.
interface StreamProviderUi {
  frameUrl: (stream: StreamStatus) => string;
  frameTitle: string;
  openTitle: string;
  stateLabel: (stream: StreamStatus) => string;
  offlineTitle: (stream: StreamStatus) => string;
  offlineHint: (machineName: string) => string;
  hint: (stream: StreamStatus) => Array<{ label: string; value: string }>;
}

const mediaMtxUi: StreamProviderUi = {
  frameUrl: (stream) => `${stream.openUrl}?controls=false&muted=true&autoplay=true&playsInline=true`,
  frameTitle: "WebRTC stream",
  openTitle: "Open MediaMTX stream",
  stateLabel: (stream) => (stream.live ? "live" : stream.requested ? "starting agent" : "requesting stream"),
  offlineTitle: (stream) => (stream.requested ? "Starting pixel stream" : "No active pixel stream"),
  offlineHint: (machineName) =>
    `Keep the native wmux agent running on ${machineName}; capture starts only while this dialog is open.`,
  hint: (stream) =>
    stream.publishRtspUrl && stream.publishWhipUrl
      ? [
          { label: "RTSP publish", value: stream.publishRtspUrl },
          { label: "WHIP publish", value: stream.publishWhipUrl },
        ]
      : [],
};

const moonlightGatewayUi: StreamProviderUi = {
  frameUrl: (stream) => stream.openUrl,
  frameTitle: "Moonlight gateway",
  openTitle: "Open Moonlight gateway",
  stateLabel: (stream) => {
    if (stream.live) return "gateway ready";
    if (stream.reasonKind === "target") return "target offline";
    if (stream.reasonKind === "upstream") return "upstream offline";
    return "gateway offline";
  },
  offlineTitle: (stream) => {
    if (stream.reasonKind === "target") return "Moonlight target unavailable";
    if (stream.reasonKind === "upstream") return "Moonlight Web unavailable";
    return "Moonlight gateway unavailable";
  },
  offlineHint: (machineName) => `Sunshine must be running and reachable on ${machineName}.`,
  hint: (stream) => [
    { label: "gateway", value: stream.gatewayUrl ?? stream.openUrl },
    {
      label: "control",
      value: stream.inputEnabled
        ? "keyboard, pointer, touch, and gamepad flow through the browser gateway"
        : "view only",
    },
  ],
};

const streamProviderUi = (stream: StreamStatus | undefined): StreamProviderUi =>
  stream?.provider === "moonlight-gateway" ? moonlightGatewayUi : mediaMtxUi;

export function ScreenStreamViewer({ machine, stream, onRequest, onRelease, onClose }: ScreenStreamViewerProps) {
  const machineId = machine?.id ?? stream?.machineId ?? "unknown";
  const machineName = machine?.name ?? machineId;
  const requestId = useMemo(() => createRequestId(), []);
  const ui = streamProviderUi(stream);
  const hints = stream ? ui.hint(stream) : [];

  useEffect(() => {
    if (!machineId || machineId === "unknown") return;
    onRequest(machineId, requestId, STREAM_REQUEST_TTL_MS);
    const interval = window.setInterval(() => {
      onRequest(machineId, requestId, STREAM_REQUEST_TTL_MS);
    }, STREAM_REQUEST_HEARTBEAT_MS);
    return () => {
      window.clearInterval(interval);
      onRelease(machineId, requestId);
    };
  }, [machineId, onRelease, onRequest, requestId]);

  return (
    <div className="stream-backdrop" onMouseDown={(event) => event.currentTarget === event.target && onClose()}>
      <section className="stream-panel" role="dialog" aria-modal="true" aria-label={`${machineName} screen stream`}>
        <div className="stream-header">
          <div>
            <h2>{machineName} stream</h2>
            <span className={`stream-status ${stream?.live ? "live" : "waiting"}`}>
              {stream ? ui.stateLabel(stream) : "requesting stream"}
              {stream ? ` / ${stream.viewerCount} viewer${stream.viewerCount === 1 ? "" : "s"}` : ""}
              {stream ? ` / checked ${formatRelativeTime(stream.checkedAt)}` : ""}
            </span>
          </div>
          <div className="stream-actions">
            {stream ? (
              <a className="stream-link" href={stream.openUrl} target="_blank" rel="noreferrer" title={ui.openTitle}>
                <ExternalLink size={15} />
                <span>open</span>
              </a>
            ) : null}
            <button type="button" title="Close stream" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="stream-video-shell">
          {stream?.live ? (
            <iframe
              className="stream-frame"
              src={ui.frameUrl(stream)}
              title={`${machineName} ${ui.frameTitle}`}
              allow="autoplay; fullscreen; picture-in-picture; gamepad; clipboard-read; clipboard-write"
            />
          ) : (
            <div className="stream-empty">
              <ScreenShare size={30} />
              <strong>{stream ? ui.offlineTitle(stream) : "No active pixel stream"}</strong>
              <span>{ui.offlineHint(machineName)}</span>
              {stream?.reason ? <span>{stream.reason}</span> : null}
            </div>
          )}
        </div>
        {hints.length > 0 ? (
          <div className="stream-agent-hint">
            {hints.map((hint) => (
              <Fragment key={hint.label}>
                <span>{hint.label}</span>
                <code>{hint.value}</code>
              </Fragment>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}

const createRequestId = (): string => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `stream-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const formatRelativeTime = (iso: string): string => {
  const elapsedMs = Date.now() - Date.parse(iso);
  if (!Number.isFinite(elapsedMs)) return "unknown";
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ago`;
};
