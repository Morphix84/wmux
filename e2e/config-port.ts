export const defaultE2ePort = 3489;

export function resolveE2ePort(value = process.env.WMUX_E2E_PORT): number {
  const normalized = value?.trim();
  if (!normalized) {
    return defaultE2ePort;
  }

  const port = Number(normalized);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid WMUX_E2E_PORT: ${value}`);
  }
  return port;
}
