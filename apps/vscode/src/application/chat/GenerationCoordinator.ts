import type { IdGenerator } from "@/application/ports";
import type { ResourceGovernor } from "./ResourceGovernor";

const MAX_QUEUED_PER_CONVERSATION = 32;
const MAX_QUEUED_GLOBAL = 128;
const MAX_QUEUED_BYTES_PER_CONVERSATION = 32 * 1024 * 1024;
const MAX_QUEUED_BYTES_GLOBAL = 64 * 1024 * 1024;
const ACTIVE_GENERATION_OVERHEAD_BYTES = 16 * 1024 * 1024;

export type GenerationStopReason =
  | "user_cancelled"
  | "steered"
  | "workspace_changed"
  | "shutdown"
  | "deleted"
  | "history_transition";

interface GenerationAbortReason {
  kind: "generation_abort";
  reason: GenerationStopReason;
}

export interface GenerationTask<T> {
  conversationId: string;
  clientRequestId: string;
  queuedAt: number;
  payload: T;
}

export interface ActiveGeneration<T> {
  generationId: string;
  task: GenerationTask<T>;
  controller: AbortController;
  completion: Promise<void>;
  stopReason?: GenerationStopReason;
}

export interface GenerationCoordinatorOptions<T> {
  idGenerator: IdGenerator;
  getLimit: () => number;
  run: (generationId: string, task: GenerationTask<T>, signal: AbortSignal) => Promise<void>;
  onStarted?: (generationId: string, task: GenerationTask<T>) => void;
  onQueued?: (task: GenerationTask<T>, position: number) => void;
  onSettled?: (generationId: string, task: GenerationTask<T>) => void;
  estimateTaskBytes?: (task: GenerationTask<T>) => number;
  resourceGovernor?: ResourceGovernor;
}

export class GenerationCoordinator<T> {
  private readonly queues = new Map<string, GenerationTask<T>[]>();
  private readonly activeById = new Map<string, ActiveGeneration<T>>();
  private readonly activeByConversation = new Map<string, string>();
  private shuttingDown = false;

  constructor(private readonly options: GenerationCoordinatorOptions<T>) {}

  enqueue(task: GenerationTask<T>, front = false): void {
    if (this.shuttingDown) {
      throw new Error("Generation coordinator is shutting down");
    }
    const queue = this.queues.get(task.conversationId) ?? [];
    const taskBytes = this.getTaskBytes(task);
    const conversationBytes = queue.reduce((total, queued) => total + this.getTaskBytes(queued), 0);
    const globalCount = [...this.queues.values()].reduce((total, queued) => total + queued.length, 0);
    const globalBytes = [...this.queues.values()].flat().reduce((total, queued) => total + this.getTaskBytes(queued), 0);
    if (
      queue.length >= MAX_QUEUED_PER_CONVERSATION ||
      globalCount >= MAX_QUEUED_GLOBAL ||
      conversationBytes + taskBytes > MAX_QUEUED_BYTES_PER_CONVERSATION ||
      globalBytes + taskBytes > MAX_QUEUED_BYTES_GLOBAL
    ) {
      throw new Error("Generation queue resource limit reached. Wait for pending messages to finish before adding another one.");
    }
    if (front) {
      queue.unshift(task);
    } else {
      queue.push(task);
    }
    this.queues.set(task.conversationId, queue);
    this.options.onQueued?.(task, queue.indexOf(task) + 1);
    this.schedule();
  }

  interrupt(generationId: string, reason: GenerationStopReason = "user_cancelled"): boolean {
    const active = this.activeById.get(generationId);
    if (!active) {
      return false;
    }
    active.stopReason ??= reason;
    active.controller.abort({ kind: "generation_abort", reason: active.stopReason } satisfies GenerationAbortReason);
    return true;
  }

  getActive(generationId: string): ActiveGeneration<T> | undefined {
    return this.activeById.get(generationId);
  }

  getActiveForConversation(conversationId: string): ActiveGeneration<T> | undefined {
    const generationId = this.activeByConversation.get(conversationId);
    return generationId ? this.activeById.get(generationId) : undefined;
  }

  getQueue(conversationId: string): readonly GenerationTask<T>[] {
    return this.queues.get(conversationId) ?? [];
  }

  getQueuedConversationIds(): readonly string[] {
    return [...this.queues.keys()];
  }

  clearQueue(conversationId: string): readonly GenerationTask<T>[] {
    const queued = this.queues.get(conversationId) ?? [];
    this.queues.delete(conversationId);
    return queued;
  }

  getActiveGenerations(): readonly ActiveGeneration<T>[] {
    return [...this.activeById.values()];
  }

  async shutdown(timeoutMs = 1500): Promise<void> {
    this.shuttingDown = true;
    for (const active of this.activeById.values()) {
      active.stopReason ??= "shutdown";
      active.controller.abort({ kind: "generation_abort", reason: active.stopReason } satisfies GenerationAbortReason);
    }
    const completions = Promise.allSettled([...this.activeById.values()].map((active) => active.completion));
    await Promise.race([completions, new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
  }

  private schedule(): void {
    if (this.shuttingDown) {
      return;
    }
    const limit = Math.min(16, Math.max(1, this.options.getLimit()));
    while (this.activeById.size < limit) {
      const task = this.nextTask();
      if (!task) {
        return;
      }
      if (!this.start(task)) {
        const queue = this.queues.get(task.conversationId) ?? [];
        queue.unshift(task);
        this.queues.set(task.conversationId, queue);
        return;
      }
    }
  }

  private nextTask(): GenerationTask<T> | undefined {
    let selected: GenerationTask<T> | undefined;
    for (const [conversationId, queue] of this.queues) {
      if (queue.length === 0 || this.activeByConversation.has(conversationId)) {
        continue;
      }
      if (!selected || queue[0].queuedAt < selected.queuedAt) {
        selected = queue[0];
      }
    }
    if (!selected) {
      return undefined;
    }
    const queue = this.queues.get(selected.conversationId)!;
    queue.shift();
    if (queue.length === 0) {
      this.queues.delete(selected.conversationId);
    }
    return selected;
  }

  private start(task: GenerationTask<T>): boolean {
    const generationId = this.options.idGenerator.next();
    if (this.options.resourceGovernor && !this.options.resourceGovernor.tryReserve(
      generationId,
      this.getTaskBytes(task) + ACTIVE_GENERATION_OVERHEAD_BYTES,
    )) {
      return false;
    }
    const controller = new AbortController();
    const active: ActiveGeneration<T> = {
      generationId,
      task,
      controller,
      completion: Promise.resolve(),
    };
    this.activeById.set(generationId, active);
    this.activeByConversation.set(task.conversationId, generationId);
    this.options.onStarted?.(generationId, task);
    active.completion = this.options.run(generationId, task, controller.signal)
      .catch(() => undefined)
      .finally(() => {
        if (this.activeByConversation.get(task.conversationId) === generationId) {
          this.activeByConversation.delete(task.conversationId);
        }
        this.activeById.delete(generationId);
        this.options.resourceGovernor?.release(generationId);
        this.options.onSettled?.(generationId, task);
        this.schedule();
      });
    return true;
  }

  private getTaskBytes(task: GenerationTask<T>): number {
    if (this.options.estimateTaskBytes) {return Math.max(0, this.options.estimateTaskBytes(task));}
    return Buffer.byteLength(JSON.stringify(task.payload), "utf8");
  }
}

export function getGenerationStopReason(signal: AbortSignal): GenerationStopReason | undefined {
  const value = signal.reason as Partial<GenerationAbortReason> | undefined;
  return value?.kind === "generation_abort" ? value.reason : undefined;
}
