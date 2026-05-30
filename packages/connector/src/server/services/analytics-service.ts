import type { SupabaseClient } from "@supabase/supabase-js";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "fs";
import { dirname } from "path";
import { createLogger } from "../utils/logger";

const log = createLogger("AnalyticsService");

const ANALYTICS_ENABLED_PATH = "/etc/nocturne-connector/analytics-enabled.json";
const ANALYTICS_PENDING_PATH = "/etc/nocturne-connector/analytics-pending.json";
const PENDING_QUEUE_LIMIT = 200;

type PendingAnalyticType = "dailyActive" | "event";

interface PendingAnalytic {
  id: string;
  type: PendingAnalyticType;
  data: Record<string, any>;
  timestamp: number;
}

export interface DailyActiveInput {
  deviceSerial: string;
  userId: string | null;
  appVersion: string;
  firmwareVersion: string;
  phoneVersion?: string;
}

export interface TrackEventInput {
  deviceSerial: string;
  userId: string | null;
  eventType: string;
  eventData?: Record<string, any>;
}

function safeMkdir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch (err) {
      log.warn(`Failed to create dir ${dir}: ${err}`);
    }
  }
}

function atomicWriteFile(path: string, data: string): void {
  safeMkdir(path);
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  try {
    writeFileSync(tmp, data);
    renameSync(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {}
    throw err;
  }
}

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function todayDateString(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export class AnalyticsService {
  private supabase: SupabaseClient;
  private _isEnabled: boolean;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
    this._isEnabled = this.loadEnabledFlag();
  }

  get isEnabled(): boolean {
    return this._isEnabled;
  }

  setEnabled(enabled: boolean): void {
    this._isEnabled = enabled;
    try {
      atomicWriteFile(ANALYTICS_ENABLED_PATH, JSON.stringify({ enabled }));
    } catch (err) {
      log.warn(`Failed to persist analytics flag: ${err}`);
    }
  }

  private loadEnabledFlag(): boolean {
    try {
      if (!existsSync(ANALYTICS_ENABLED_PATH)) return true;
      const raw = readFileSync(ANALYTICS_ENABLED_PATH, "utf-8");
      const parsed = JSON.parse(raw);
      return typeof parsed?.enabled === "boolean" ? parsed.enabled : true;
    } catch {
      return true;
    }
  }

  async recordDailyActive(input: DailyActiveInput): Promise<void> {
    if (!this._isEnabled) return;
    if (!input.userId) {
      log.info("Skipping daily analytics: not authenticated");
      return;
    }

    const payload = {
      device_serial: input.deviceSerial,
      user_id: input.userId,
      last_active_date: todayDateString(),
      app_version: input.appVersion,
      device_firmware_version: input.firmwareVersion,
      phone_version: input.phoneVersion ?? "Connector",
    };

    try {
      const { error } = await this.supabase
        .from("analytics")
        .upsert(payload, { onConflict: "device_serial,last_active_date" });
      if (error) throw new Error(error.message);
      log.info("Recorded daily analytics");
    } catch (err) {
      log.warn(`Daily analytics failed, queueing: ${err}`);
      this.queue({ type: "dailyActive", data: payload });
    }
  }

  async trackEvent(input: TrackEventInput): Promise<void> {
    if (!this._isEnabled) return;
    if (!input.userId) {
      log.info(`Skipping event ${input.eventType}: not authenticated`);
      return;
    }

    const payload: Record<string, any> = {
      device_serial: input.deviceSerial,
      user_id: input.userId,
      event_type: input.eventType,
    };
    if (input.eventData) {
      payload.event_data = input.eventData;
    }

    try {
      const { error } = await this.supabase.from("analytics_events").insert(payload);
      if (error) throw new Error(error.message);
      log.info(`Tracked event: ${input.eventType}`);
    } catch (err) {
      log.warn(`Event ${input.eventType} failed, queueing: ${err}`);
      this.queue({ type: "event", data: payload });
    }
  }

  async syncPendingAnalytics(): Promise<void> {
    if (!this._isEnabled) return;

    const pending = this.loadQueue();
    if (pending.length === 0) return;

    const remaining: PendingAnalytic[] = [];
    let synced = 0;
    let dropped = 0;

    for (const item of pending) {
      const itemUserId = item.data?.user_id;
      if (!itemUserId || typeof itemUserId !== "string") {
        dropped++;
        continue;
      }

      try {
        if (item.type === "dailyActive") {
          const { error } = await this.supabase
            .from("analytics")
            .upsert(item.data, { onConflict: "device_serial,last_active_date" });
          if (error) throw new Error(error.message);
        } else {
          const { error } = await this.supabase.from("analytics_events").insert(item.data);
          if (error) throw new Error(error.message);
        }
        synced++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("unique_device_date") || msg.includes("duplicate key")) {
          synced++;
          continue;
        }
        if (msg.includes("row-level security") || msg.includes("violates row-level")) {
          dropped++;
          continue;
        }
        log.warn(`Sync failed for pending analytic ${item.id}: ${err}`);
        remaining.push(item);
      }
    }

    this.saveQueue(remaining);
    if (synced > 0) {
      log.info(`Synced ${synced} pending analytics`);
    }
    if (dropped > 0) {
      log.info(`Dropped ${dropped} unprocessable pending analytics`);
    }
  }

  private queue(item: { type: PendingAnalyticType; data: Record<string, any> }): void {
    const queue = this.loadQueue();
    queue.push({
      id: randomId(),
      type: item.type,
      data: item.data,
      timestamp: Date.now(),
    });
    if (queue.length > PENDING_QUEUE_LIMIT) {
      queue.splice(0, queue.length - PENDING_QUEUE_LIMIT);
    }
    this.saveQueue(queue);
  }

  private loadQueue(): PendingAnalytic[] {
    try {
      if (!existsSync(ANALYTICS_PENDING_PATH)) return [];
      const raw = readFileSync(ANALYTICS_PENDING_PATH, "utf-8");
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (x): x is PendingAnalytic =>
          x &&
          typeof x === "object" &&
          typeof x.id === "string" &&
          (x.type === "dailyActive" || x.type === "event") &&
          typeof x.data === "object"
      );
    } catch (err) {
      log.warn(`Failed to load pending analytics: ${err}`);
      return [];
    }
  }

  private saveQueue(queue: PendingAnalytic[]): void {
    try {
      if (queue.length === 0) {
        if (existsSync(ANALYTICS_PENDING_PATH)) {
          try {
            unlinkSync(ANALYTICS_PENDING_PATH);
          } catch {}
        }
        return;
      }
      atomicWriteFile(ANALYTICS_PENDING_PATH, JSON.stringify(queue));
    } catch (err) {
      log.warn(`Failed to save pending analytics: ${err}`);
    }
  }
}
