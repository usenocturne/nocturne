import { Elysia } from "elysia";
import { readFileSync } from "fs";
import { getConnectorVersion } from "../utils/version";

export const infoRoutes = new Elysia({ prefix: "/api" })
  .get("/info", () => {
    let osVersion = "unknown";
    try {
      osVersion = readFileSync("/etc/alpine-release", "utf-8").trim();
    } catch {}
    return { version: getConnectorVersion(), osVersion };
  });
