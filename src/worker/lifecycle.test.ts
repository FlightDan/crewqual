import { describe, expect, it, vi } from "vitest";
import { createShutdownHandler } from "@/worker/lifecycle";

describe("worker shutdown lifecycle", () => {
  it("stops the queue and disconnects the database exactly once", async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    const shutdown = createShutdownHandler({ stop, disconnect, exit });

    await Promise.all([shutdown(), shutdown()]);

    expect(stop).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    expect(stop.mock.invocationCallOrder[0]).toBeLessThan(disconnect.mock.invocationCallOrder[0]!);
  });

  it("still disconnects and exits non-zero when cleanup fails", async () => {
    const error = new Error("queue stop failed");
    const stop = vi.fn().mockRejectedValue(error);
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    const onError = vi.fn();
    const shutdown = createShutdownHandler({ stop, disconnect, exit, onError });

    await shutdown();

    expect(disconnect).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(error);
    expect(exit).toHaveBeenCalledWith(1);
  });
});
