import * as os from "node:os";
import * as path from "node:path";

const USER_DATA_DIRECTORY_NAME = ".deepseek-agent";

export function getUserDataDirectory(): string {
  const testOverride = process.env.NODE_ENV === "test" ? process.env.DEEPSEEK_AGENT_USER_DATA_DIR : undefined;
  if (testOverride) {
    return path.resolve(testOverride);
  }
  return path.join(os.homedir(), USER_DATA_DIRECTORY_NAME);
}

export function getSettingsFilePath(): string {
  return path.join(getUserDataDirectory(), "settings.json");
}

export function getHistoryDirectory(): string {
  return path.join(getUserDataDirectory(), "history");
}

export function getGenerationCheckpointDirectory(): string {
  return path.join(getUserDataDirectory(), "generation-checkpoints");
}
