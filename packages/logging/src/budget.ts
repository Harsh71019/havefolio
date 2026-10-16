/** Browser-safe, continuously refilled budget; no timers, queues or caller waits. */
export class TelemetryBudget {
  private remaining: number;
  private updatedAt: number;

  constructor(
    private readonly capacity: number,
    private readonly perMinute: number,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.remaining = capacity;
    this.updatedAt = now();
  }

  take(amount = 1): boolean {
    const time = this.now();
    const elapsed = Math.max(0, time - this.updatedAt);
    this.updatedAt = Math.max(this.updatedAt, time);
    this.remaining = Math.min(this.capacity, this.remaining + (elapsed * this.perMinute) / 60000);
    if (!Number.isFinite(amount) || amount <= 0 || amount > this.remaining) return false;
    this.remaining -= amount;
    return true;
  }
}
