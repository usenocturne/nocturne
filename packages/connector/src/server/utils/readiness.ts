import { createLogger } from "./logger";

const log = createLogger("Readiness");

const POLL_INTERVAL_MS = 2_000;
const PROGRESS_LOG_INTERVAL_MS = 10_000;

type ProbeSource = "chrony" | "timedatectl";
type ProbeResult =
  | { status: "synced"; source: ProbeSource }
  | { status: "unsynced"; source: ProbeSource }
  | { status: "unavailable"; source: ProbeSource };

async function probeChronycTracking(): Promise<ProbeResult> {
  let stdout = "";
  let stderr = "";
  let exitCode: number;
  try {
    const proc = Bun.spawn(["chronyc", "-n", "tracking"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    stdout = await new Response(proc.stdout).text();
    stderr = await new Response(proc.stderr).text();
    exitCode = await proc.exited;
  } catch (err) {
    log.debug(
      `chronyc spawn failed: ${err instanceof Error ? err.message : err}`,
    );
    return { status: "unavailable", source: "chrony" };
  }

  if (exitCode !== 0) {
    log.debug(`chronyc tracking exited ${exitCode}: ${stderr.trim()}`);
    return { status: "unavailable", source: "chrony" };
  }

  const leap = stdout.match(/Leap status\s*:\s*(.+)/i)?.[1]?.trim() ?? "";
  const stratumStr = stdout.match(/Stratum\s*:\s*(\d+)/i)?.[1] ?? "";
  const refId = stdout.match(/Reference ID\s*:\s*([0-9A-Fa-f]+)/)?.[1] ?? "";
  const stratum = Number.parseInt(stratumStr, 10);

  const leapOk =
    leap === "Normal" || leap === "Insert second" || leap === "Delete second";
  const stratumOk = Number.isFinite(stratum) && stratum >= 1 && stratum <= 15;
  const referenceOk = refId.toUpperCase() !== "7F7F0101";

  const ok = leapOk && stratumOk && referenceOk;
  return { status: ok ? "synced" : "unsynced", source: "chrony" };
}

async function probeTimedatectlNtpSync(): Promise<ProbeResult> {
  let stdout = "";
  let stderr = "";
  let exitCode: number;
  try {
    const proc = Bun.spawn(
      ["timedatectl", "show", "-p", "NTPSynchronized", "--value"],
      { stdout: "pipe", stderr: "pipe" },
    );
    stdout = await new Response(proc.stdout).text();
    stderr = await new Response(proc.stderr).text();
    exitCode = await proc.exited;
  } catch (err) {
    log.debug(
      `timedatectl spawn failed: ${err instanceof Error ? err.message : err}`,
    );
    return { status: "unavailable", source: "timedatectl" };
  }

  if (exitCode !== 0) {
    log.debug(`timedatectl exited ${exitCode}: ${stderr.trim()}`);
    return { status: "unavailable", source: "timedatectl" };
  }

  const value = stdout.trim().toLowerCase();
  if (value === "yes") return { status: "synced", source: "timedatectl" };
  if (value === "no") return { status: "unsynced", source: "timedatectl" };

  // Unexpected output; treat as unavailable
  log.debug(
    `timedatectl returned unexpected NTPSynchronized value: ${stdout.trim()}`,
  );
  return { status: "unavailable", source: "timedatectl" };
}

async function probeClockSync(): Promise<{ synced: boolean; source?: string }> {
  const chrony = await probeChronycTracking();
  if (chrony.status === "synced")
    return { synced: true, source: chrony.source };
  if (chrony.status === "unsynced")
    return { synced: false, source: chrony.source };

  const tdc = await probeTimedatectlNtpSync();
  if (tdc.status === "synced") return { synced: true, source: tdc.source };
  if (tdc.status === "unsynced") return { synced: false, source: tdc.source };

  return { synced: false };
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function waitForClockSync(): Promise<void> {
  const start = Date.now();
  let attempt = 0;
  let lastLog = 0;
  let everSeenChronyc = false;

  log.info("Waiting for system clock to be synchronised...");

  while (true) {
    attempt++;
    const { synced, source } = await probeClockSync();
    const now = Date.now();

    if (synced) {
      const elapsed = ((now - start) / 1000).toFixed(1);
      log.info(
        `Clock synced after ${elapsed}s (${attempt} probe${attempt === 1 ? "" : "s"}${
          source ? ` via ${source}` : ""
        }); current time: ${new Date(now).toISOString()}`,
      );
      return;
    }

    if (!everSeenChronyc) {
      // First negative probe — emit a single info line so it's obvious in logs.
      everSeenChronyc = true;
    }

    const sinceLastLog = now - lastLog;
    if (sinceLastLog >= PROGRESS_LOG_INTERVAL_MS || attempt <= 3) {
      const elapsed = ((now - start) / 1000).toFixed(0);
      log.info(
        `Clock not yet synced (probe ${attempt}${source ? ` via ${source}` : ""}, elapsed ${elapsed}s, local time: ${new Date(now).toISOString()})`,
      );
      lastLog = now;
    }

    await sleep(POLL_INTERVAL_MS);
  }
}
