import { pino, type Logger } from "pino";

export type { Logger };

export function createLogger(level: string = process.env["LOG_LEVEL"] ?? "info"): Logger {
  return pino({
    level,
    redact: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.passwordHash"]
  });
}

export function createSilentLogger(): Logger {
  return pino({ level: "silent" });
}
