import { createLogger } from "./logger";

const log = createLogger("Shell");

export async function runShell(command: string): Promise<string> {
  const proc = Bun.spawn(["sh", "-c", command], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    log.error(`Command failed (${exitCode}): ${command}\n${stderr}`);
    throw new Error(`Command failed: ${command}: ${stderr.trim()}`);
  }

  return stdout.trim();
}

export async function openrcStart(service: string): Promise<void> {
  await runShell(`/etc/init.d/${service} start`);
}

export async function openrcRestart(service: string): Promise<void> {
  await runShell(`/etc/init.d/${service} restart`);
}
