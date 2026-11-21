import * as assert from "node:assert";
import { GenerationCoordinator, getGenerationStopReason } from "@/application/chat/GenerationCoordinator";
import { ResourceGovernor } from "@/application/chat/ResourceGovernor";

suite("GenerationCoordinator", () => {
  test("starts eight runs and leaves the ninth queued", async () => {
    const releases: Array<() => void> = [];
    const started: string[] = [];
    const coordinator = new GenerationCoordinator<string>({
      idGenerator: sequentialIds(),
      getLimit: () => 8,
      run: async (_generationId, item) => new Promise<void>((resolve) => {
        started.push(item.payload);
        releases.push(resolve);
      }),
    });
    for (let index = 0; index < 9; index += 1) {
      coordinator.enqueue(task(`conversation-${index}`, `run-${index}`, index));
    }
    await tick();
    assert.strictEqual(started.length, 8);
    releases[0]();
    await tick();
    assert.strictEqual(started.length, 9);
    releases.slice(1).forEach((release) => release());
  });

  test("runs conversations concurrently while serializing each conversation", async () => {
    const releases = new Map<string, () => void>();
    const started: string[] = [];
    const coordinator = new GenerationCoordinator<string>({
      idGenerator: sequentialIds(),
      getLimit: () => 2,
      run: async (_generationId, task) => new Promise<void>((resolve) => {
        started.push(task.payload);
        releases.set(task.payload, resolve);
      }),
    });

    coordinator.enqueue(task("a", "a1", 1));
    coordinator.enqueue(task("a", "a2", 2));
    coordinator.enqueue(task("b", "b1", 3));
    await tick();
    assert.deepStrictEqual(started, ["a1", "b1"]);

    releases.get("a1")?.();
    await tick();
    assert.deepStrictEqual(started, ["a1", "b1", "a2"]);
    releases.get("a2")?.();
    releases.get("b1")?.();
  });

  test("an old completion cannot clear the newer owner", async () => {
    let release: (() => void) | undefined;
    const coordinator = new GenerationCoordinator<string>({
      idGenerator: sequentialIds(),
      getLimit: () => 1,
      run: async () => new Promise<void>((resolve) => { release = resolve; }),
    });
    coordinator.enqueue(task("a", "first", 1));
    await tick();
    const active = coordinator.getActiveForConversation("a");
    assert.ok(active);
    release?.();
    await tick();
    assert.strictEqual(coordinator.getActiveForConversation("a"), undefined);
  });

  test("can interrupt immediately from the generation-started notification", async () => {
    let coordinator!: GenerationCoordinator<string>;
    let observedAbort = false;
    coordinator = new GenerationCoordinator<string>({
      idGenerator: sequentialIds(),
      getLimit: () => 1,
      onStarted: (generationId) => {
        assert.strictEqual(coordinator.interrupt(generationId), true);
      },
      run: async (_generationId, _task, signal) => {
        observedAbort = signal.aborted;
      },
    });

    coordinator.enqueue(task("a", "first", 1));
    await tick();

    assert.strictEqual(observedAbort, true);
    assert.strictEqual(coordinator.getActiveForConversation("a"), undefined);
  });

  test("keeps the first typed interruption reason across repeated cancellation", async () => {
    let observedReason: string | undefined;
    const coordinator = new GenerationCoordinator<string>({
      idGenerator: sequentialIds(),
      getLimit: () => 1,
      run: async (_generationId, _task, signal) => new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => {
          observedReason = getGenerationStopReason(signal);
          resolve();
        }, { once: true });
      }),
    });
    coordinator.enqueue(task("a", "first", 1));
    const active = coordinator.getActiveForConversation("a");
    assert.ok(active);

    assert.strictEqual(coordinator.interrupt(active.generationId, "steered"), true);
    assert.strictEqual(coordinator.interrupt(active.generationId, "user_cancelled"), true);
    await active.completion;

    assert.strictEqual(observedReason, "steered");
  });

  test("rejects queue overflow visibly instead of discarding a message", async () => {
    let release: (() => void) | undefined;
    const coordinator = new GenerationCoordinator<string>({
      idGenerator: sequentialIds(),
      getLimit: () => 1,
      run: async () => new Promise<void>((resolve) => {release = resolve;}),
    });
    coordinator.enqueue(task("a", "active", 0));
    for (let index = 0; index < 32; index += 1) {
      coordinator.enqueue(task("a", `queued-${index}`, index + 1));
    }
    assert.throws(
      () => coordinator.enqueue(task("a", "overflow", 100)),
      /queue resource limit reached/,
    );
    assert.strictEqual(coordinator.getQueue("a").length, 32);
    release?.();
    coordinator.clearQueue("a");
    await tick();
  });

  test("admits work again after a resource reservation is released", () => {
    const governor = new ResourceGovernor(100);
    assert.strictEqual(governor.tryReserve("a", 80), true);
    assert.strictEqual(governor.tryReserve("b", 21), false);
    governor.release("a");
    assert.strictEqual(governor.tryReserve("b", 21), true);
  });
});

function task(conversationId: string, payload: string, queuedAt: number) {
  return { conversationId, clientRequestId: payload, queuedAt, payload };
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function sequentialIds() {
  let next = 0;
  return { next: () => `generation-${++next}` };
}
