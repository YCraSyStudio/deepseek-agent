import * as assert from "node:assert";
import {
  ToolExecutionPipeline,
  type ToolExecutionStage,
} from "@/application/tools/ToolExecutionPipeline";

suite("ToolExecutionPipeline", () => {
  test("runs policies in architectural order", async () => {
    const visited: string[] = [];
    const stage = (name: ToolExecutionStage<number, string>["name"]): ToolExecutionStage<number, string> => ({
      name,
      async handle(context) {
        visited.push(name);
        return { kind: "continue", context: context + 1 };
      },
    });
    const pipeline = new ToolExecutionPipeline([
      stage("argument_validation"),
      stage("workspace_trust"),
      stage("prepare_remote_review"),
      stage("remote_review"),
      stage("user_confirmation"),
      stage("execution"),
      stage("record_and_publish"),
    ]);

    const decision = await pipeline.execute(0);

    assert.deepStrictEqual(visited, [
      "argument_validation",
      "workspace_trust",
      "prepare_remote_review",
      "remote_review",
      "user_confirmation",
      "execution",
      "record_and_publish",
    ]);
    assert.deepStrictEqual(decision, { kind: "continue", context: 7 });
  });

  test("short-circuits after a resolved policy", async () => {
    const visited: string[] = [];
    const pipeline = new ToolExecutionPipeline<number, string>([
      {
        name: "workspace_trust",
        async handle() {
          visited.push("workspace_trust");
          return { kind: "resolved", result: "rejected" };
        },
      },
      {
        name: "execution",
        async handle(context) {
          visited.push("execution");
          return { kind: "continue", context };
        },
      },
    ]);

    assert.deepStrictEqual(await pipeline.execute(0), { kind: "resolved", result: "rejected" });
    assert.deepStrictEqual(visited, ["workspace_trust"]);
  });

  test("rejects duplicated or inverted stages", () => {
    const stage = (name: ToolExecutionStageName): ToolExecutionStage<unknown, unknown> => ({
      name,
      async handle(context) {return { kind: "continue", context };},
    });
    assert.throws(() => new ToolExecutionPipeline([stage("execution"), stage("workspace_trust")]), /out of order/);
    assert.throws(() => new ToolExecutionPipeline([stage("execution"), stage("execution")]), /more than once/);
  });
});

type ToolExecutionStageName = ToolExecutionStage<unknown, unknown>["name"];
