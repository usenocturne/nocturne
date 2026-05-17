import { createLogger } from "./logger";

const log = createLogger("Readiness");

const POLL_INTERVAL_MS = 2_000;
const PROGRESS_LOG_INTERVAL_MS = 10_000;

async function probeChronycTracking(): Promise<boolean> {
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
    log.debug(`chronyc spawn failed: ${err instanceof Error ? err.message : err}`);
    return false;
  }

  if (exitCode !== 0) {
    log.debug(`chronyc tracking exited ${exitCode}: ${stderr.trim()}`);
    return false;
  }

  const leap = stdout.match(/Leap status\s*:\s*(.+)/i)?.[1]?.trim() ?? "";
  const stratumStr = stdout.match(/Stratum\s*:\s*(\d+)/i)?.[1] ?? "";
  const refId = stdout.match(/Reference ID\s*:\s*([0-9A-Fa-f]+)/)?.[1] ?? "";
  const stratum = Number.parseInt(stratumStr, 10);

  const leapOk =
    leap === "Normal" ||
    leap === "Insert second" ||
    leap === "Delete second";
  const stratumOk = Number.isFinite(stratum) && stratum >= 1 && stratum <= 15;
  const referenceOk = refId.toUpperCase() !== "7F7F0101";

  return leapOk && stratumOk && referenceOk;
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function waitForClockSync(): Promise<void> {
  const start = Date.now();
  let attempt = 0;
  let lastLog = 0;
  let everSeenChronyc = false;

  log.info("Waiting for system clock to be synchronised by chronyd...");

  while (true) {
    attempt++;
    const synced = await probeChronycTracking();
    const now = Date.now();

    if (synced) {
      const elapsed = ((now - start) / 1000).toFixed(1);
      log.info(
        `Clock synced after ${elapsed}s (${attempt} probe${attempt === 1 ? "" : "s"}); current time: ${new Date(now).toISOString()}`
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
        `Clock not yet synced (probe ${attempt}, elapsed ${elapsed}s, local time: ${new Date(now).toISOString()})`
      );
      lastLog = now;
    }

    await sleep(POLL_INTERVAL_MS);
  }
}
