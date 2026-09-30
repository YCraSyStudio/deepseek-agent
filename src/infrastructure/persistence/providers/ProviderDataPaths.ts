import * as os from "node:os";
import * as path from "node:path";
import { getUserDataDirectory } from "../UserDataPaths";

export interface ProviderDataPaths { directory: string; settingsFile: string }
export function getProviderDataPaths(provider: string): ProviderDataPaths {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(provider)) {throw new Error("Invalid provider namespace");}
  const testRoot = process.env.NODE_ENV === "test" ? process.env.YCRASY_AGENT_PROVIDER_DATA_DIR : undefined;
  const root = process.env.NODE_ENV === "test" ? testRoot ?? path.join(getUserDataDirectory(), "providers") : path.join(os.homedir(), ".ycrasy-agent");
  const directory = path.resolve(root, provider);
  return { directory, settingsFile: path.join(directory, "settings.json") };
}
