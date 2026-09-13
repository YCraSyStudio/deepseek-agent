import type * as vscode from "vscode";
import { getApiOrigin } from "@/shared/security/ApiOrigin";
import { API_CREDENTIALS_SECRET_KEY, API_KEY_SECRET_KEY } from "@/shared/constants";
import { isRecord } from "@/shared/utils/TypeGuards";

interface StoredApiCredentials {
  version: 2;
  byOrigin: Record<string, string>;
}

export class SecretsManager {
  private static mutationQueue: Promise<void> = Promise.resolve();

  static async migrateLegacyApiKey(context: vscode.ExtensionContext, baseUrl: string): Promise<void> {
    await SecretsManager.enqueueMutation(async () => {
      const legacyKey = await context.secrets.get(API_KEY_SECRET_KEY);
      if (!legacyKey) {
        return;
      }
      const credentials = await readCredentials(context);
      const origin = getApiOrigin(baseUrl);
      if (!credentials.byOrigin[origin]) {
        credentials.byOrigin[origin] = legacyKey;
        await context.secrets.store(API_CREDENTIALS_SECRET_KEY, JSON.stringify(credentials));
      }
      await context.secrets.delete(API_KEY_SECRET_KEY);
    });
  }

  static async getApiKey(context: vscode.ExtensionContext, baseUrl: string): Promise<string | undefined> {
    await SecretsManager.migrateLegacyApiKey(context, baseUrl);
    const credentials = await readCredentials(context);
    return credentials.byOrigin[getApiOrigin(baseUrl)];
  }

  static async setApiKey(context: vscode.ExtensionContext, baseUrl: string, key: string): Promise<void> {
    if (!key) {
      throw new Error("The API key replacement must not be empty.");
    }
    await SecretsManager.enqueueMutation(async () => {
      const credentials = await readCredentials(context);
      credentials.byOrigin[getApiOrigin(baseUrl)] = key;
      await context.secrets.store(API_CREDENTIALS_SECRET_KEY, JSON.stringify(credentials));
    });
  }

  static async deleteApiKey(context: vscode.ExtensionContext, baseUrl: string): Promise<void> {
    await SecretsManager.enqueueMutation(async () => {
      const credentials = await readCredentials(context);
      delete credentials.byOrigin[getApiOrigin(baseUrl)];
      await context.secrets.store(API_CREDENTIALS_SECRET_KEY, JSON.stringify(credentials));
    });
  }

  private static enqueueMutation(operation: () => Promise<void>): Promise<void> {
    const next = SecretsManager.mutationQueue.then(operation, operation);
    SecretsManager.mutationQueue = next.catch(() => undefined);
    return next;
  }
}

async function readCredentials(context: vscode.ExtensionContext): Promise<StoredApiCredentials> {
  const stored = await context.secrets.get(API_CREDENTIALS_SECRET_KEY);
  if (!stored) {
    return { version: 2, byOrigin: {} };
  }
  try {
    const value = JSON.parse(stored) as unknown;
    if (!isRecord(value) || value.version !== 2 || !isRecord(value.byOrigin)) {
      return { version: 2, byOrigin: {} };
    }
    const byOrigin = Object.fromEntries(
      Object.entries(value.byOrigin).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0),
    );
    return { version: 2, byOrigin };
  } catch {
    return { version: 2, byOrigin: {} };
  }
}
