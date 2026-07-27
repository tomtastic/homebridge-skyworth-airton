import type { Logging } from 'homebridge';

import { SkyworthClient } from './client.js';
import type { AcState } from './protocol.js';

export type StateMutation = (state: AcState) => readonly [
  data1: number,
  data2: number,
  data3: number,
  data4: number,
];

export class SkyworthController {
  private state?: AcState;
  private pollTimer?: NodeJS.Timeout;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly client: SkyworthClient,
    private readonly pollIntervalMs: number,
    private readonly log: Logging,
    private readonly onState: (state: AcState) => void,
  ) {}

  public async start(): Promise<void> {
    await this.refresh();
    this.pollTimer = setInterval(() => {
      void this.refresh().catch((error: unknown) => {
        this.log.warn('Unable to refresh air-conditioner state:', this.errorMessage(error));
      });
    }, this.pollIntervalMs);
  }

  public stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  public async currentState(): Promise<AcState> {
    return this.state ?? this.refresh();
  }

  public refresh(): Promise<AcState> {
    return this.enqueue(async () => {
      const state = await this.client.getStatus();
      this.publish(state);
      return state;
    });
  }

  public mutate(mutation: StateMutation): Promise<AcState> {
    return this.enqueue(async () => {
      const current = await this.client.getStatus();
      const [data1, data2, data3, data4] = mutation(current);
      await this.client.setState(data1, data2, data3, data4);
      const confirmed = await this.client.getStatus();
      this.publish(confirmed);
      return confirmed;
    });
  }

  private publish(state: AcState): void {
    this.state = state;
    this.onState(state);
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
