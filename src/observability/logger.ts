export type LogLevel = "DEBUG" | "INFO" | "ERROR";

export interface LogEnvironment {
  APP_ENV?: string;
  LOG_LEVEL?: string;
}

export type LogContext = Record<string, unknown>;

export interface Logger {
  debug(event: string, context?: LogContext): void;
  info(event: string, context?: LogContext): void;
  error(event: string, context?: LogContext): void;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  ERROR: 30,
};

export function resolveLogLevel(env: LogEnvironment): LogLevel {
  const configured = env.LOG_LEVEL?.trim().toUpperCase();
  if (configured === "DEBUG" || configured === "INFO" || configured === "ERROR") return configured;
  return env.APP_ENV === "local" ? "DEBUG" : "INFO";
}

export function errorLogContext(error: unknown): LogContext {
  if (error instanceof Error) return { errorName: error.name, errorMessage: error.message };
  return { errorMessage: String(error) };
}

function emit(level: LogLevel, component: string, event: string, context: LogContext): void {
  const message = `[tableplan] ${level} ${component} ${event}`;
  try {
    if (level === "DEBUG") console.debug(message, context);
    else if (level === "INFO") console.info(message, context);
    else console.error(message, context);
  } catch {
    // Logging must never interrupt request, Agent, or Workflow processing.
  }
}

export function createLogger(env: LogEnvironment, component: string): Logger {
  const threshold = LEVEL_PRIORITY[resolveLogLevel(env)];
  const write = (level: LogLevel, event: string, context: LogContext = {}) => {
    if (LEVEL_PRIORITY[level] >= threshold) emit(level, component, event, context);
  };
  return {
    debug: (event, context) => write("DEBUG", event, context),
    info: (event, context) => write("INFO", event, context),
    error: (event, context) => write("ERROR", event, context),
  };
}
