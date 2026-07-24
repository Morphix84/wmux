import {
  HttpError,
  type ApiRoute,
  routePolicy,
} from "./route.js";

const staticMachinePath = /^\/api\/machines\/([^/]+)$/;
const registeredMachinePath = /^\/api\/registry\/hosts\/([^/]+)$/;

const refreshCatalogState = async (
  deps: Parameters<ApiRoute["handler"]>[0]["deps"],
): Promise<void> => {
  await Promise.all([
    deps.refreshMachineStatuses(false, true),
    deps.refreshStreamStatuses(false, true),
  ]);
};

export const machineRoutes: readonly ApiRoute[] = [
  {
    id: "machine-management-list",
    method: "GET",
    pattern: "/api/machines/manage",
    policy: routePolicy("machine-management-list", "GET", "/api/machines/manage"),
    handler: async ({ deps, sendJson }) => {
      if (!deps.staticMachines) {
        sendJson(404, { error: "machine_management_disabled" });
        return;
      }
      sendJson(200, {
        staticMachines: deps.staticMachines.publicSnapshot(),
        registeredHosts: deps.hostRegistry?.snapshot() ?? [],
      });
    },
  },
  {
    id: "machine-management-create",
    method: "POST",
    pattern: "/api/machines",
    policy: routePolicy("machine-management-create", "POST", "/api/machines"),
    handler: async ({ deps, readJsonBody, sendJson }) => {
      if (!deps.staticMachines || !deps.hostRegistry) {
        sendJson(404, { error: "machine_management_disabled" });
        return;
      }
      const machine = deps.staticMachines.create(await readJsonBody());
      deps.hostRegistry.updateStaticMachines(deps.staticMachines.snapshot());
      await refreshCatalogState(deps);
      sendJson(201, {
        machine: deps.staticMachines.publicSnapshot().find((entry) => entry.id === machine.id),
        state: deps.currentPayload(),
      });
    },
  },
  {
    id: "machine-management-update",
    method: "PUT",
    pattern: staticMachinePath,
    policy: routePolicy("machine-management-update", "PUT", /^\/api\/machines\/[^/]+$/),
    handler: async ({ deps, match, readJsonBody, sendJson }) => {
      if (!deps.staticMachines || !deps.hostRegistry) {
        sendJson(404, { error: "machine_management_disabled" });
        return;
      }
      if (!match) throw new Error("machine update route matched without captures");
      const id = decodeURIComponent(match[1]);
      const machine = deps.staticMachines.update(id, await readJsonBody());
      deps.hostRegistry.updateStaticMachines(deps.staticMachines.snapshot());
      await refreshCatalogState(deps);
      sendJson(200, {
        machine: deps.staticMachines.publicSnapshot().find((entry) => entry.id === machine.id),
        state: deps.currentPayload(),
      });
    },
  },
  {
    id: "machine-management-delete",
    method: "DELETE",
    pattern: staticMachinePath,
    policy: routePolicy("machine-management-delete", "DELETE", /^\/api\/machines\/[^/]+$/),
    handler: async ({ deps, match, sendJson }) => {
      if (!deps.staticMachines || !deps.hostRegistry) {
        sendJson(404, { error: "machine_management_disabled" });
        return;
      }
      if (!match) throw new Error("machine delete route matched without captures");
      const id = decodeURIComponent(match[1]);
      if (
        deps.state.hasMachineReferences(id)
        || deps.sessions.hasLiveSessionsForMachine(id)
      ) {
        throw new HttpError(409, "machine_in_use");
      }
      const removed = deps.staticMachines.delete(id);
      if (!removed) {
        sendJson(404, { error: "unknown_static_machine" });
        return;
      }
      deps.hostRegistry.updateStaticMachines(deps.staticMachines.snapshot());
      await refreshCatalogState(deps);
      sendJson(200, { removed: true, state: deps.currentPayload() });
    },
  },
  {
    id: "registry-update",
    method: "PUT",
    pattern: registeredMachinePath,
    policy: routePolicy("registry-update", "PUT", /^\/api\/registry\/hosts\/[^/]+$/),
    handler: async ({ deps, match, readJsonBody, sendJson }) => {
      if (!deps.hostRegistry) {
        sendJson(404, { error: "registry_disabled" });
        return;
      }
      if (!match) throw new Error("registry update route matched without captures");
      const body = await readJsonBody();
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new HttpError(400, "invalid_registration_update");
      }
      const record = body as Record<string, unknown>;
      if (Object.keys(record).some((key) => key !== "name" && key !== "disabled")) {
        throw new HttpError(400, "invalid_registration_update");
      }
      const host = deps.hostRegistry.updateRegistration(
        decodeURIComponent(match[1]),
        { name: record.name, disabled: record.disabled },
      );
      await refreshCatalogState(deps);
      sendJson(200, {
        host,
        state: deps.currentPayload(),
      });
    },
  },
];
