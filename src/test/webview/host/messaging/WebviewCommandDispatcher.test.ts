import * as assert from "node:assert";
import { WebviewCommandDispatcher } from "@/vscode/webviews/WebviewCommandDispatcher";

suite("WebviewCommandDispatcher", () => {
  test("routes a typed command once and reports unknown commands", () => {
    const dispatcher = new WebviewCommandDispatcher();
    const handled: string[] = [];
    dispatcher.register("getConfig", (message) => handled.push(message.type));

    assert.strictEqual(dispatcher.dispatch({
      type: "getConfig",
    }, {} as never), true);
    assert.deepStrictEqual(handled, ["getConfig"]);
    assert.strictEqual(dispatcher.dispatch({
      type: "getHistory",
    }, {} as never), false);
  });

  test("rejects duplicate handler registration", () => {
    const dispatcher = new WebviewCommandDispatcher();
    dispatcher.register("getConfig", () => undefined);
    assert.throws(() => dispatcher.register("getConfig", () => undefined), /already registered/);
  });
});
