import type * as vscode from "vscode";
import { getApiOrigin } from "@/shared/security/ApiOrigin";
import { API_CREDENTIALS_SECRET_KEY, API_KEY_SECRET_KEY } from "@/shared/constants";
import { isRecord } from "@/shared/utils/TypeGuards";

import { backendCredential } from "./BackendCredentialImport";

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

  static async migrateInstalledCredentials(context: vscode.ExtensionContext, baseUrl: string): Promise<void> {
    const migration = "backendCredentialMigration.v1";
    if (context.globalState.get<boolean>(migration)) {return;}
    await SecretsManager.migrateLegacyApiKey(context, baseUrl);
    const credentials = await readCredentials(context);
    const results = await Promise.allSettled(Object.keys(credentials.byOrigin).map(origin =>
      SecretsManager.getApiKey(context, origin)));
    if (results.some(result => result.status === "rejected")) {
      throw new Error("The backend could not verify all provider credentials.");
    }
    if (Object.keys((await readCredentials(context)).byOrigin).length === 0) {
      await context.globalState.update(migration, true);
    }
  }

  static async getApiKey(context: vscode.ExtensionContext, baseUrl: string): Promise<string | undefined> {
    await SecretsManager.migrateLegacyApiKey(context, baseUrl);
    const origin = getApiOrigin(baseUrl);
    let key: string | undefined;
    await SecretsManager.enqueueMutation(async () => {
      const credentials = await readCredentials(context);
      const legacy = credentials.byOrigin[origin];
      const marker = "backendCredentialImported:" + origin;
      const managed = context.globalState?.get<boolean>(marker);
      const operation = legacy ? "import" : "get";
      const result = await backendCredential(context, operation, origin, operation === "import" ? legacy : undefined);
      if (!result.available) {
        if (managed) {throw new Error("The credential backend is unavailable.");}
        key = legacy;
        return;
      }
      await context.globalState.update(marker, true);
      if (legacy) {
        delete credentials.byOrigin[origin];
        await context.secrets.store(API_CREDENTIALS_SECRET_KEY, JSON.stringify(credentials));
      }
      key = operation === "import" ? legacy : result.key;
    });
    return key;
  }

  static async setApiKey(context: vscode.ExtensionContext, baseUrl: string, key: string): Promise<void> {
    if (!key) {
      throw new Error("The API key replacement must not be empty.");
    }
    await SecretsManager.enqueueMutation(async () => {
      const credentials = await readCredentials(context);
      const origin = getApiOrigin(baseUrl);
      const result = await backendCredential(context, "put", origin, key);
      if (result.available) {
        await context.globalState.update("backendCredentialImported:" + origin, true);
        delete credentials.byOrigin[origin];
      } else {
        if (context.globalState?.get<boolean>("backendCredentialImported:" + origin)) {throw new Error("The credential backend is unavailable.");}
        credentials.byOrigin[origin] = key;
      }
      await context.secrets.store(API_CREDENTIALS_SECRET_KEY, JSON.stringify(credentials));
    });
  }

  static async deleteApiKey(context: vscode.ExtensionContext, baseUrl: string): Promise<void> {
    await SecretsManager.enqueueMutation(async () => {
      const credentials = await readCredentials(context);
      const origin = getApiOrigin(baseUrl);
      const result = await backendCredential(context, "delete", origin);
      if (!result.available && context.globalState?.get<boolean>("backendCredentialImported:" + origin)) {
        throw new Error("The credential backend is unavailable.");
      }
      delete credentials.byOrigin[origin];
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
