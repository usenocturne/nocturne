import { Elysia } from "elysia";
import type { BluetoothService } from "../services/bluetooth-service";

export function createBluetoothRoutes(bt: BluetoothService) {
  return new Elysia({ prefix: "/api/bluetooth" })
    .get("/status", async () => bt.getStatus())
    .post("/power", async ({ body }) => {
      const { on } = body as { on: boolean };
      if (on) await bt.powerOn();
      else await bt.powerOff();
      return { success: true };
    })
    .get("/devices", async () => {
      const devices = await bt.getDevices();
      return { devices };
    })
    .post("/scan", async () => {
      await bt.startScan();
      return { success: true };
    })
    .post("/stop-scan", async () => {
      await bt.stopScan();
      return { success: true };
    })
    .post("/pair/:address", async ({ params }) => {
      await bt.pair(params.address);
      return { success: true };
    })
    .post("/connect/:address", async ({ params, query }) => {
      const channel = query?.channel ? Number(query.channel) : undefined;
      await bt.connect(params.address, channel);
      return { success: true };
    })
    .post("/unpair/:address", async ({ params }) => {
      await bt.unpair(params.address);
      return { success: true };
    })
    .post("/trust/:address", async ({ params }) => {
      await bt.trust(params.address);
      return { success: true };
    })
    .get("/pairing-request", () => {
      const pin = bt.pendingPairingPin;
      return { pending: !!pin, request: pin };
    })
    .post("/pairing-confirm", () => {
      bt.confirmPairing();
      return { success: true };
    })
    .post("/pairing-reject", () => {
      bt.rejectPairing();
      return { success: true };
    })
    .get("/connections", () => {
      const conns = bt.getConnections();
      return {
        connections: Array.from(conns.entries()).map(([path, conn]) => ({
          devicePath: path,
          address: conn.address,
        })),
      };
    });
}
