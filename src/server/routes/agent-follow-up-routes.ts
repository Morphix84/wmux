import type { AgentFollowUpRequest } from "../../shared/protocol.js";
import {
  HttpError,
  type ApiRoute,
  routePolicy,
} from "./route.js";

const FOLLOW_UP_KEYS = new Set([
  "action",
  "prompt",
  "model",
  "writeAccess",
  "unattended",
]);

export const agentFollowUpRoutes: readonly ApiRoute[] = [
  {
    id: "agent-session-follow-up",
    method: "POST",
    pattern: /^\/api\/agent-sessions\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})\/turns$/,
    policy: routePolicy(
      "agent-session-follow-up",
      "POST",
      /^\/api\/agent-sessions\/[^/]+\/turns$/,
    ),
    handler: async ({
      deps,
      match,
      readJsonBody,
      request,
      response,
      sendJson,
    }) => {
      if (!match) {
        throw new Error("agent follow-up route matched without captures");
      }
      const input = await readJsonBody();
      if (
        !input
        || typeof input !== "object"
        || Array.isArray(input)
        || Object.keys(input).some((key) => !FOLLOW_UP_KEYS.has(key))
      ) {
        throw new HttpError(400, "invalid_agent_follow_up_request");
      }
      const body = input as Record<string, unknown>;
      if (body.action !== "continue" && body.action !== "review") {
        throw new HttpError(400, "invalid_agent_follow_up_action");
      }
      for (const key of ["prompt", "model"] as const) {
        if (
          body[key] !== undefined
          && (
            typeof body[key] !== "string"
            || body[key].length > (key === "prompt" ? 128 * 1024 : 512)
          )
        ) {
          throw new HttpError(400, `invalid_agent_follow_up_${key}`);
        }
      }
      for (const key of ["writeAccess", "unattended"] as const) {
        if (body[key] !== undefined && typeof body[key] !== "boolean") {
          throw new HttpError(400, `invalid_agent_follow_up_${key}`);
        }
      }
      const abortController = new AbortController();
      const abort = (): void => abortController.abort();
      const abortOnClose = (): void => {
        if (!response.writableEnded) abort();
      };
      request.once("aborted", abort);
      response.once("close", abortOnClose);
      try {
        const result = await deps.agentFollowUps.run(
          match[1],
          body as unknown as AgentFollowUpRequest,
          abortController.signal,
        );
        sendJson(
          201,
          { ...result, state: deps.currentPayload() },
          { "cache-control": "no-store" },
        );
      } finally {
        request.removeListener("aborted", abort);
        response.removeListener("close", abortOnClose);
      }
    },
  },
];
