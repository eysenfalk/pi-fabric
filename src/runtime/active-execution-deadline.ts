export class ActiveExecutionDeadline {
  readonly #onExpire: () => void;
  #deadlineAt: number;
  #effectiveTimeoutMs: number;
  #pausedRemainingMs: number | undefined;
  #timer: NodeJS.Timeout | undefined;
  #disposed = false;

  constructor(timeoutMs: number, onExpire: () => void, startedAt = Date.now()) {
    this.#effectiveTimeoutMs = timeoutMs;
    this.#deadlineAt = startedAt + timeoutMs;
    this.#onExpire = onExpire;
    this.#schedule();
  }

  get expiresAt(): number {
    return this.#pausedRemainingMs === undefined
      ? this.#deadlineAt
      : Number.POSITIVE_INFINITY;
  }

  get timeoutMs(): number {
    return this.#effectiveTimeoutMs;
  }

  get paused(): boolean {
    return this.#pausedRemainingMs !== undefined;
  }

  extendMinimum(durationMs: number | undefined): void {
    if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) return;
    const requested = Math.max(1, Math.floor(durationMs));
    const now = Date.now();
    const remaining = this.#pausedRemainingMs ?? Math.max(0, this.#deadlineAt - now);
    if (requested <= remaining) return;
    this.#effectiveTimeoutMs += requested - remaining;
    if (this.#pausedRemainingMs !== undefined) this.#pausedRemainingMs = requested;
    else this.#deadlineAt = now + requested;
    this.#schedule();
  }

  pause(): void {
    if (this.#disposed || this.#pausedRemainingMs !== undefined) return;
    this.#pausedRemainingMs = Math.max(0, this.#deadlineAt - Date.now());
    this.#clearTimer();
  }

  resume(): void {
    if (this.#disposed || this.#pausedRemainingMs === undefined) return;
    this.#deadlineAt = Date.now() + this.#pausedRemainingMs;
    this.#pausedRemainingMs = undefined;
    this.#schedule();
  }

  dispose(): void {
    this.#disposed = true;
    this.#clearTimer();
  }

  #clearTimer(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  #schedule(): void {
    this.#clearTimer();
    if (this.#disposed || this.#pausedRemainingMs !== undefined) return;
    const delay = Math.min(2_147_483_647, Math.max(0, this.#deadlineAt - Date.now()));
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      if (this.#disposed || this.#pausedRemainingMs !== undefined) return;
      if (Date.now() < this.#deadlineAt) this.#schedule();
      else this.#onExpire();
    }, delay);
    this.#timer.unref?.();
  }
}

export class HostCallDeadlineTracker {
  readonly #deadline: ActiveExecutionDeadline;
  #activeCalls = 0;
  #suspendingCalls = 0;

  constructor(deadline: ActiveExecutionDeadline) {
    this.#deadline = deadline;
  }

  begin(suspends: boolean, reconcile = true): () => void {
    if (suspends) this.#suspendingCalls++;
    else this.#activeCalls++;
    if (reconcile) this.reconcile();
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      if (suspends) this.#suspendingCalls--;
      else this.#activeCalls--;
      if (reconcile) this.reconcile();
    };
  }

  resumeForGuestWork(): void {
    this.#deadline.resume();
  }

  reconcile(): void {
    if (this.#suspendingCalls > 0 && this.#activeCalls === 0) this.#deadline.pause();
    else this.#deadline.resume();
  }
}
