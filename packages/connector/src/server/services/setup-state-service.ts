import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { SETUP_STATE_PATH } from "../config";
import { createLogger } from "../utils/logger";

const log = createLogger("SetupState");

export class SetupStateService {
  public isComplete(): boolean {
    if (!existsSync(SETUP_STATE_PATH)) return false;
    try {
      const data = JSON.parse(readFileSync(SETUP_STATE_PATH, "utf-8"));
      return data?.complete === true;
    } catch {
      return false;
    }
  }

  public markComplete(): { complete: true; completedAt: string } {
    const completedAt = new Date().toISOString();
    const dir = dirname(SETUP_STATE_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(SETUP_STATE_PATH, JSON.stringify({ complete: true, completedAt }));
    log.info(`Setup marked complete at ${completedAt}`);
    return { complete: true, completedAt };
  }
}
