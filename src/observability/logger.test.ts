import { afterEach, describe, expect, it, vi } from "vitest";

import { createLogger, errorLogContext, resolveLogLevel } from "./logger";

afterEach(() => vi.restoreAllMocks());

describe("resolveLogLevel", () => {
  it("defaults every environment to INFO", () => {
    expect(resolveLogLevel({ APP_ENV: "local" })).toBe("INFO");
    expect(resolveLogLevel({ APP_ENV: "preview" })).toBe("INFO");
    expect(resolveLogLevel({ APP_ENV: "production" })).toBe("INFO");
  });

  it("accepts configured levels without requiring a specific case", () => {
    expect(resolveLogLevel({ APP_ENV: "production", LOG_LEVEL: "debug" })).toBe("DEBUG");
    expect(resolveLogLevel({ APP_ENV: "local", LOG_LEVEL: " ERROR " })).toBe("ERROR");
  });
});

describe("createLogger", () => {
  it("emits every severity at DEBUG", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const logger = createLogger({ LOG_LEVEL: "DEBUG" }, "recipe-agent");

    logger.debug("workflow.progress", { ingestionId: "ing_1", percent: 0.5 });
    logger.info("workflow.complete", { ingestionId: "ing_1" });
    logger.error("workflow.failed", { ingestionId: "ing_1" });

    expect(debug).toHaveBeenCalledWith("[tableplan] DEBUG recipe-agent workflow.progress", { ingestionId: "ing_1", percent: 0.5 });
    expect(info).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledOnce();
  });

  it("filters messages below the configured severity", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const logger = createLogger({ LOG_LEVEL: "ERROR" }, "recipe-agent");

    logger.debug("hidden");
    logger.info("hidden");
    logger.error("visible");

    expect(debug).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith("[tableplan] ERROR recipe-agent visible", {});
  });

  it("keeps informational and error events visible at INFO", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const logger = createLogger({ LOG_LEVEL: "INFO" }, "recipe-agent");

    logger.debug("hidden");
    logger.info("workflow.complete");
    logger.error("workflow.failed");

    expect(debug).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledOnce();
  });
});

describe("errorLogContext", () => {
  it("retains useful error metadata without a stack", () => {
    expect(errorLogContext(new TypeError("Extraction failed"))).toEqual({
      errorName: "TypeError",
      errorMessage: "Extraction failed",
    });
  });
});
