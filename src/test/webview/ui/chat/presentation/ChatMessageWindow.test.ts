import * as assert from "node:assert";
import {
  CHAT_MESSAGE_WINDOW,
  CHAT_MESSAGE_WINDOW_PAGE,
  followChatWindowGrowth,
  growChatWindow,
  hiddenChatMessageCount,
  initialChatWindowSize,
  visibleChatMessages,
} from "@/ui/components/chatView/messages/ChatMessageWindow";

suite("chat message render window", () => {
  test("renders the whole transcript while it fits the window", () => {
    const messages = range(10);

    assert.strictEqual(initialChatWindowSize(messages.length), 10);
    assert.strictEqual(hiddenChatMessageCount(messages.length, initialChatWindowSize(messages.length)), 0);
    assert.strictEqual(visibleChatMessages(messages, initialChatWindowSize(messages.length)), messages);
  });

  test("keeps only the newest messages of a long transcript", () => {
    const messages = range(500);
    const windowSize = initialChatWindowSize(messages.length);

    assert.strictEqual(windowSize, CHAT_MESSAGE_WINDOW);
    assert.strictEqual(hiddenChatMessageCount(messages.length, windowSize), 460);
    assert.deepStrictEqual(visibleChatMessages(messages, windowSize), messages.slice(460));
  });

  test("counts messages loaded by history paging as already revealed", () => {
    const total = 200 + 200;

    assert.strictEqual(initialChatWindowSize(total, 200), CHAT_MESSAGE_WINDOW + 200);
    assert.strictEqual(hiddenChatMessageCount(total, initialChatWindowSize(total, 200)), 200 - CHAT_MESSAGE_WINDOW);
    assert.strictEqual(hiddenChatMessageCount(600, initialChatWindowSize(600, 400)), 200 - CHAT_MESSAGE_WINDOW);
  });

  test("reveals one page per request and never overshoots the transcript", () => {
    const total = 90;
    const first = initialChatWindowSize(total);
    const second = growChatWindow(first, total);

    assert.strictEqual(second, CHAT_MESSAGE_WINDOW + CHAT_MESSAGE_WINDOW_PAGE);
    assert.strictEqual(hiddenChatMessageCount(total, second), 90 - CHAT_MESSAGE_WINDOW - CHAT_MESSAGE_WINDOW_PAGE);
    assert.strictEqual(hiddenChatMessageCount(total, growChatWindow(second, total)), 0);
    assert.strictEqual(growChatWindow(999, total), total);
  });

  test("follows a transcript that starts empty and streams the first exchange in", () => {
    const newChat = followChatWindowGrowth(initialChatWindowSize(0), 0);
    const withUserMessage = followChatWindowGrowth(newChat, 1);
    const withReply = followChatWindowGrowth(withUserMessage, 2);

    assert.strictEqual(newChat, 0);
    assert.strictEqual(withUserMessage, 1);
    assert.strictEqual(hiddenChatMessageCount(1, withUserMessage), 0);
    assert.strictEqual(withReply, 2);
    assert.strictEqual(hiddenChatMessageCount(2, withReply), 0);
  });

  test("catches up to a transcript loaded after mount, keeping the tail hidden", () => {
    const total = 500;
    const windowSize = followChatWindowGrowth(0, total);

    assert.strictEqual(windowSize, CHAT_MESSAGE_WINDOW);
    assert.strictEqual(hiddenChatMessageCount(total, windowSize), 460);
  });

  test("never undoes a reveal and clamps back down for a shorter transcript", () => {
    const total = 500;
    const revealed = growChatWindow(initialChatWindowSize(total), total);

    assert.strictEqual(revealed, CHAT_MESSAGE_WINDOW + CHAT_MESSAGE_WINDOW_PAGE);
    assert.strictEqual(followChatWindowGrowth(revealed, total), revealed);
    assert.strictEqual(followChatWindowGrowth(growChatWindow(total, total), total), total);
    assert.strictEqual(followChatWindowGrowth(revealed, 3), 3);
  });

  test("treats an empty or malformed transcript as fully visible", () => {
    assert.strictEqual(initialChatWindowSize(0), 0);
    assert.strictEqual(hiddenChatMessageCount(0, 0), 0);
    assert.strictEqual(hiddenChatMessageCount(5, -3), 5);
    assert.strictEqual(hiddenChatMessageCount(5, Number.NaN), 5);
    assert.deepStrictEqual(visibleChatMessages([], 0), []);
  });
});

function range(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `message-${index}`);
}
