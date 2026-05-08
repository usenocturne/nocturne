const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type LogLevel = keyof typeof LOG_LEVELS;

const currentLevel: LogLevel =
  (process.env.LOG_LEVEL as LogLevel) || "info";

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function timestamp(): string {
  return new Date().toISOString();
}

export function createLogger(category: string) {
  return {
    debug(msg: string, ...args: unknown[]) {
      if (shouldLog("debug"))
        console.debug(`[${timestamp()}] [DEBUG] [${category}] ${msg}`, ...args);
    },
    info(msg: string, ...args: unknown[]) {
      if (shouldLog("info"))
        console.info(`[${timestamp()}] [INFO] [${category}] ${msg}`, ...args);
    },
    warn(msg: string, ...args: unknown[]) {
      if (shouldLog("warn"))
        console.warn(`[${timestamp()}] [WARN] [${category}] ${msg}`, ...args);
    },
    error(msg: string, ...args: unknown[]) {
      if (shouldLog("error"))
        console.error(`[${timestamp()}] [ERROR] [${category}] ${msg}`, ...args);
    },
  };
}
