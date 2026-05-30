import { Elysia } from "elysia";
import { runShell } from "../utils/shell";

export const powerRoutes = new Elysia({ prefix: "/api/power" })
  .post("/reboot", () => {
    setTimeout(() => {
      runShell("reboot").catch(() => {});
    }, 1000);
    return { status: "success" };
  });
