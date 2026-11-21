import { createHash } from "node:crypto";


export interface DecisionKeyInput {
  conversationId?: string;
  workspaceId?: string;
  permissionFingerprint?: string;
  toolName: string;
  subject: string;
  contentHash?: string;
  effectProfile?: string;
}

export interface DecisionScope {
  conversationId?: string;
  workspaceId?: string;
  permissionFingerprint?: string;
}

export function isCacheableScope(scope: DecisionScope): boolean {
  return Boolean(scope.conversationId && scope.workspaceId && scope.permissionFingerprint);
}

export function createDecisionKey(input: DecisionKeyInput): string {
  return createHash("sha256")
    .update(JSON.stringify([
      input.conversationId ?? "",
      input.workspaceId ?? "",
      input.permissionFingerprint ?? "",
      input.toolName,
      input.subject,
      input.contentHash ?? "",
      input.effectProfile ?? "",
    ]))
    .digest("hex");
}

export class PositiveDecisionCache {
  private readonly keys: string[] = [];
  private readonly entries = new Set<string>();

  constructor(private readonly maxEntries = 64) {}

  public has(key: string): boolean {
    return this.entries.has(key);
  }

  public remember(key: string): void {
    if (this.entries.has(key)) {
      return;
    }
    this.entries.add(key);
    this.keys.push(key);
    while (this.keys.length > this.maxEntries) {
      const oldest = this.keys.shift();
      if (oldest !== undefined) {
        this.entries.delete(oldest);
      }
    }
  }

  public clear(): void {
    this.keys.length = 0;
    this.entries.clear();
  }

  public get size(): number {
    return this.entries.size;
  }
}

export const positiveDecisionCache = new PositiveDecisionCache();
