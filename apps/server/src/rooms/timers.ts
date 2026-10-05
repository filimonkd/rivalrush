/**
 * Named one-shot timers. Timers only *wake* the RoomManager; the authoritative decision is
 * always made inside the room lock by comparing stored deadlines with the current time.
 */
export class TimerRegistry {
  private timers = new Map<string, { at: number; handle: ReturnType<typeof setTimeout> }>();

  constructor(private readonly now: () => number) {}

  /** Schedules (or reschedules) `key` to fire at `at`. No-op if already set for that time. */
  set(key: string, at: number, fn: () => void): void {
    const existing = this.timers.get(key);
    if (existing && existing.at === at) return;
    if (existing) clearTimeout(existing.handle);
    const delay = Math.max(0, at - this.now());
    // Cap so very long timers don't overflow setTimeout's 32-bit limit.
    const handle = setTimeout(
      () => {
        this.timers.delete(key);
        fn();
      },
      Math.min(delay, 2_147_000_000),
    );
    handle.unref?.();
    this.timers.set(key, { at, handle });
  }

  clear(key: string): void {
    const t = this.timers.get(key);
    if (t) clearTimeout(t.handle);
    this.timers.delete(key);
  }

  clearPrefix(prefix: string): void {
    for (const key of [...this.timers.keys()]) if (key.startsWith(prefix)) this.clear(key);
  }

  clearAll(): void {
    for (const key of [...this.timers.keys()]) this.clear(key);
  }

  has(key: string): boolean {
    return this.timers.has(key);
  }
}
