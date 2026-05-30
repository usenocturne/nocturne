import { createHash } from "crypto";
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from "fs";
import { OTA_SERVER_URL } from "../config";
import { createLogger } from "../utils/logger";

const log = createLogger("OTAService");

export interface UpdateCheckResponse {
  updateAvailable: boolean;
  version: string | null;
  channel: string | null;
  metadata: { auto_updateable: boolean; critical: boolean } | null;
}

export class OTAService {
  async checkForUpdates(currentVersion: string, channel: string): Promise<UpdateCheckResponse> {
    const res = await fetch(`${OTA_SERVER_URL}/check-update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentVersion, channel }),
    });

    if (!res.ok) throw new Error(`OTA server returned ${res.status}`);
    const data = await res.json();

    if (data.updateAvailable) {
      log.info(`Update available: ${data.version}`);
    } else {
      log.info("No updates available");
    }

    return data;
  }

  async downloadUpdate(currentVersion: string, targetVersion: string): Promise<string> {
    log.info(`Downloading update: ${currentVersion} -> ${targetVersion}`);

    const res = await fetch(`${OTA_SERVER_URL}/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentVersion, targetVersion }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) throw new Error(`Download failed: ${res.status}`);

    const buf = await res.arrayBuffer();
    const dir = "/tmp/nocturne-ota";
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const filePath = `${dir}/nocturne-update.swu`;
    writeFileSync(filePath, Buffer.from(buf));
    log.info(`Downloaded ${buf.byteLength} bytes to ${filePath}`);

    return filePath;
  }

  readChunk(filePath: string, offset: number, size: number): Buffer {
    if (!existsSync(filePath)) throw new Error("Update file not found");

    const stat = statSync(filePath);
    if (offset < 0 || offset >= stat.size) throw new Error(`Invalid offset: ${offset}`);

    const fd = require("fs").openSync(filePath, "r");
    const bytesToRead = Math.min(size, stat.size - offset);
    const buf = Buffer.alloc(bytesToRead);
    require("fs").readSync(fd, buf, 0, bytesToRead, offset);
    require("fs").closeSync(fd);

    return buf;
  }

  calculateMD5(filePath: string): string {
    if (!existsSync(filePath)) throw new Error("Update file not found");
    const data = readFileSync(filePath);
    return createHash("md5").update(data).digest("hex");
  }
}
