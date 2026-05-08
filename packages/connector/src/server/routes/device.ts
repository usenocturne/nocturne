import { Elysia } from "elysia";
import type { NocturneManager } from "../nocturne-manager";

export function createDeviceRoutes(manager: NocturneManager) {
  return new Elysia({ prefix: "/api/device" })
    .get("/status", () => manager.getConnectionStatus())
    .get("/info", () => {
      const status = manager.getConnectionStatus();
      return status.devices[0]?.deviceInfo ?? null;
    });
}
