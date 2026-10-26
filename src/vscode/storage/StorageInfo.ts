import type { StorageInfo } from "@/contracts/Storage";
import { getDefaultUserDataDirectory, getUserDataDirectory } from "@/infrastructure/persistence/UserDataPaths";

export function getStorageInfo(configuredDirectory = getUserDataDirectory()): StorageInfo {
  return {
    directory: getUserDataDirectory(),
    defaultDirectory: getDefaultUserDataDirectory(),
    configuredDirectory,
  };
}
