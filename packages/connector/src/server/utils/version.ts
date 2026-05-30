import { readFileSync } from "fs";

let cachedVersion: string | null = null;

export function getConnectorVersion(): string {
  if (cachedVersion !== null) return cachedVersion;

  try {
    const raw = readFileSync("/etc/nocturne-connector/version", "utf-8").trim();
    if (raw.length > 0) {
      cachedVersion = raw;
      return raw;
    }
  } catch {}

  const fromEnv = process.env.npm_package_version;
  if (typeof fromEnv === "string" && fromEnv.length > 0) {
    cachedVersion = fromEnv;
    return fromEnv;
  }

  const candidates = [
    new URL("../../../package.json", import.meta.url).pathname,
    new URL("../../package.json", import.meta.url).pathname,
  ];

  for (const path of candidates) {
    try {
      const raw = readFileSync(path, "utf-8").trim();
      const parsed = JSON.parse(raw);
      if (typeof parsed?.version === "string" && parsed.version.length > 0) {
        cachedVersion = parsed.version;
        return parsed.version;
      }
    } catch {}
  }

  cachedVersion = "unknown";
  return "unknown";
}
