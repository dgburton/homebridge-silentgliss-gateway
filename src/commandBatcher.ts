export interface MoveRequest {
  motorId: string;
  targetPosition: number;
  requiresMove: boolean;
}

export interface CommandBatcherOptions {
  debounceMs: number;
  maxWaitMs: number;
  retryDelayMs: number;
  maxRetries: number;
  onError?: (error: unknown, requests: MoveRequest[]) => void;
}

const DEFAULT_OPTIONS: CommandBatcherOptions = {
  debounceMs: 500,
  maxWaitMs: 1500,
  retryDelayMs: 1000,
  maxRetries: 1,
};

export class CommandBatcher {
  private readonly pending = new Map<string, MoveRequest>();
  private readonly options: CommandBatcherOptions;
  private flushTimer?: NodeJS.Timeout;
  private firstQueuedAt?: number;
  private flushPromise?: Promise<void>;

  constructor(
    private readonly sender: (requests: MoveRequest[]) => Promise<void>,
    options: Partial<CommandBatcherOptions> = {},
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  queue(request: MoveRequest): void {
    this.pending.set(request.motorId, request);
    this.firstQueuedAt ??= Date.now();
    this.scheduleFlush();
  }

  async flushNow(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }

    if (this.flushPromise) {
      await this.flushPromise;
    }

    if (this.pending.size === 0) {
      return;
    }

    const requests = Array.from(this.pending.values());
    this.pending.clear();
    this.firstQueuedAt = undefined;

    this.flushPromise = this.sendWithRetry(requests);
    try {
      await this.flushPromise;
    } finally {
      this.flushPromise = undefined;
      if (this.pending.size > 0) {
        this.scheduleFlush();
      }
    }
  }

  dispose(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    this.pending.clear();
    this.firstQueuedAt = undefined;
  }

  private scheduleFlush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }

    const elapsedMs = this.firstQueuedAt === undefined ? 0 : Date.now() - this.firstQueuedAt;
    const remainingMaxWaitMs = Math.max(0, this.options.maxWaitMs - elapsedMs);
    const delayMs = Math.min(this.options.debounceMs, remainingMaxWaitMs);

    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      void this.flushNow();
    }, delayMs);
  }

  private async sendWithRetry(requests: MoveRequest[]): Promise<void> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
      try {
        await this.sender(requests);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < this.options.maxRetries) {
          await new Promise(resolve => setTimeout(resolve, this.options.retryDelayMs));
        }
      }
    }

    this.options.onError?.(lastError, requests);
  }
}
