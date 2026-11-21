import * as os from "node:os";
import * as path from "node:path";

const USER_DATA_DIRECTORY_NAME = ".ycrasy-agent";

let configuredDirectory: string | undefined;

export function getDefaultUserDataDirectory(): string {
  return path.join(os.homedir(), USER_DATA_DIRECTORY_NAME);
}

export function resolveUserDataDirectory(value: string): string {
  const trimmed = value.trim();
  const expanded = trimmed === "~" ? os.homedir()
    : trimmed.startsWith("~/") || trimmed.startsWith("~\\") ? path.join(os.homedir(), trimmed.slice(2)) : trimmed;
  if (!expanded || expanded.includes("\0") || !path.isAbsolute(expanded)) {
    throw new Error("Enter an absolute directory path.");
  }
  return path.normalize(expanded);
}

/** Fixed for the lifetime of the host; changing it requires reloading all storage clients. */
export function configureUserDataDirectory(directory: string | undefined): void {
  configuredDirectory = directory === undefined ? undefined : resolveUserDataDirectory(directory);
}

export function getUserDataDirectory(): string {
  const testOverride = process.env.NODE_ENV === "test" ? process.env.DEEPSEEK_AGENT_USER_DATA_DIR : undefined;
  if (testOverride) {
    return path.resolve(testOverride);
  }
  return configuredDirectory ?? getDefaultUserDataDirectory();
}

export function getSettingsFilePath(): string {
  return path.join(getUserDataDirectory(), "settings.json");
}

export function getHistoryDirectory(): string {
  return path.join(getUserDataDirectory(), "history");
}

export function getLegacyGenerationCheckpointDirectory(): string {
  return path.join(getUserDataDirectory(), "generation-checkpoints");
}

export function getGenerationCheckpointPath(conversationId: string): string {
  if (!conversationId || conversationId.length > 512 || [".", "..", "new-chat-draft"].includes(conversationId)) {
    throw new Error("Invalid checkpoint conversation ID");
  }
  return path.join(getHistoryDirectory(), encodeURIComponent(conversationId), "checkpoint.json");
}
