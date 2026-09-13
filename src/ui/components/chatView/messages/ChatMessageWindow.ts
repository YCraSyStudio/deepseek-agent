
export const CHAT_MESSAGE_WINDOW = 40;
export const CHAT_MESSAGE_WINDOW_PAGE = 40;

export function initialChatWindowSize(totalMessages: number, earlierMessagesLoaded = 0): number {
  return clampWindowSize(CHAT_MESSAGE_WINDOW + Math.max(0, earlierMessagesLoaded), totalMessages);
}

export function growChatWindow(currentSize: number, totalMessages: number): number {
  return clampWindowSize(currentSize + CHAT_MESSAGE_WINDOW_PAGE, totalMessages);
}

export function followChatWindowGrowth(
  currentSize: number,
  totalMessages: number,
  earlierMessagesLoaded = 0,
): number {
  return Math.max(
    clampWindowSize(currentSize, totalMessages),
    initialChatWindowSize(totalMessages, earlierMessagesLoaded),
  );
}

export function hiddenChatMessageCount(totalMessages: number, windowSize: number): number {
  return Math.max(0, Math.floor(totalMessages) - clampWindowSize(windowSize, totalMessages));
}

export function visibleChatMessages<T>(messages: T[], windowSize: number): T[] {
  const hidden = hiddenChatMessageCount(messages.length, windowSize);
  return hidden === 0 ? messages : messages.slice(hidden);
}

function clampWindowSize(size: number, totalMessages: number): number {
  const total = Number.isFinite(totalMessages) ? Math.max(0, Math.floor(totalMessages)) : 0;
  if (!Number.isFinite(size) || size <= 0) {
    return 0;
  }
  return Math.min(Math.floor(size), total);
}
