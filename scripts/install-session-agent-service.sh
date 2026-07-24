#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${HOME}/.wmux"
CONFIG_PATH="${STATE_DIR}/session-agent.json"
BIN_DIR="${HOME}/.local/bin"

if [[ ! -s "${CONFIG_PATH}" ]]; then
  echo "missing ${CONFIG_PATH}; provision the agent config before installation" >&2
  exit 1
fi

mkdir -p "${STATE_DIR}" "${BIN_DIR}"
chmod 700 "${STATE_DIR}"
chmod 600 "${CONFIG_PATH}"
ln -sfn "${ROOT_DIR}/scripts/wmux-session-agent" "${BIN_DIR}/wmux-session-agent"
ln -sfn "${ROOT_DIR}/scripts/wmux-windows-agent" "${BIN_DIR}/wmux-windows-agent"

case "$(uname -s)" in
  Linux)
    UNIT_DIR="${HOME}/.config/systemd/user"
    mkdir -p "${UNIT_DIR}"
    cp "${ROOT_DIR}/deploy/wmux-session-agent.service.example" "${UNIT_DIR}/wmux-session-agent.service"
    systemctl --user disable --now wmux-heartbeat.timer wmux-heartbeat.service >/dev/null 2>&1 || true
    systemctl --user daemon-reload
    systemctl --user enable --now wmux-session-agent.service
    echo "wmux-session-agent.service installed"
    ;;
  Darwin)
    PLIST_DIR="${HOME}/Library/LaunchAgents"
    PLIST_PATH="${PLIST_DIR}/io.wmux.session-agent.plist"
    mkdir -p "${PLIST_DIR}"
    sed "s|__HOME__|${HOME//&/\\&}|g" \
      "${ROOT_DIR}/deploy/io.wmux.session-agent.plist.example" > "${PLIST_PATH}"
    chmod 600 "${PLIST_PATH}"
    launchctl bootout "gui/$(id -u)/io.wmux.session-agent" >/dev/null 2>&1 || true
    launchctl bootstrap "gui/$(id -u)" "${PLIST_PATH}"
    launchctl enable "gui/$(id -u)/io.wmux.session-agent"
    echo "io.wmux.session-agent installed"
    ;;
  *)
    echo "wmux POSIX session agent supervision supports Linux and macOS" >&2
    exit 1
    ;;
esac
