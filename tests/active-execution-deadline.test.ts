import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ActiveExecutionDeadline,
  HostCallDeadlineTracker,
} from "../src/runtime/active-execution-deadline.js";

describe("ActiveExecutionDeadline", () => {
  afterEach(() => vi.useRealTimers());

  it("does not charge paused human wait time and resumes the remaining budget", async () => {
    vi.useFakeTimers();
    const expired = vi.fn();
    const deadline = new ActiveExecutionDeadline(100, expired);

    await vi.advanceTimersByTimeAsync(40);
    deadline.pause();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(expired).not.toHaveBeenCalled();

    deadline.resume();
    await vi.advanceTimersByTimeAsync(59);
    expect(expired).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(expired).toHaveBeenCalledOnce();
    deadline.dispose();
  });

  it("extends remaining active time without resetting consumed time", async () => {
    vi.useFakeTimers();
    const expired = vi.fn();
    const deadline = new ActiveExecutionDeadline(100, expired);

    await vi.advanceTimersByTimeAsync(75);
    deadline.pause();
    deadline.extendMinimum(80);
    expect(deadline.timeoutMs).toBe(155);
    await vi.advanceTimersByTimeAsync(5_000);
    deadline.resume();
    await vi.advanceTimersByTimeAsync(79);
    expect(expired).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(expired).toHaveBeenCalledOnce();
    deadline.dispose();
  });
});

describe("HostCallDeadlineTracker", () => {
  afterEach(() => vi.useRealTimers());

  it("pauses only while every outstanding host call is suspending", () => {
    vi.useFakeTimers();
    const deadline = new ActiveExecutionDeadline(100, vi.fn());
    const tracker = new HostCallDeadlineTracker(deadline);

    const endHuman = tracker.begin(true);
    expect(deadline.paused).toBe(true);
    const endActive = tracker.begin(false);
    expect(deadline.paused).toBe(false);
    endActive();
    expect(deadline.paused).toBe(true);
    endHuman();
    expect(deadline.paused).toBe(false);
    deadline.dispose();
  });
});
