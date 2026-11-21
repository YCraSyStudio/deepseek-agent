import type { QueuedGenerationMessage } from "@/contracts";
import type { GenerationCoordinator } from "@/application/chat/GenerationCoordinator";
import type { SettingsRepository } from "@/application/ports";
import type { GenerationCheckpointStore, HistoryManager } from "@/vscode/storage";
import type { SendMessagePayload } from "../Types";
import type { GenerationRunRecord } from "../generation/GenerationRun";
import {
  checkpointGeneration,
  checkpointQueuedGeneration,
  scheduleGenerationCheckpoint,
} from "../generation/GenerationCheckpointing";

interface ChatCheckpointCoordinatorDependencies {
  checkpointStore: GenerationCheckpointStore;
  coordinator: GenerationCoordinator<SendMessagePayload>;
  historyManager: HistoryManager;
  isIncognito: () => boolean;
  recoveredDrafts: ReadonlyMap<string, QueuedGenerationMessage[]>;
  runs: ReadonlyMap<string, GenerationRunRecord>;
  settings: SettingsRepository;
}

export class ChatCheckpointCoordinator {
  constructor(
    private readonly dependencies: ChatCheckpointCoordinatorDependencies,
  ) {}

  schedule(record: GenerationRunRecord): void {
    if (!this.dependencies.settings.load().historyEnabled || record.state.isIncognito()) {
      return;
    }
    scheduleGenerationCheckpoint(record, (target, immediate) => this.checkpoint(target, immediate));
  }

  async checkpoint(record: GenerationRunRecord, immediate: boolean): Promise<void> {
    await checkpointGeneration(record, immediate, this.checkpointDependencies());
  }

  async checkpointQueuedConversation(conversationId: string): Promise<void> {
    if (this.dependencies.isIncognito()) {
      return;
    }
    await checkpointQueuedGeneration(
      conversationId,
      this.dependencies.runs,
      this.dependencies.recoveredDrafts,
      this.checkpointDependencies(),
    );
  }

  private checkpointDependencies() {
    const { checkpointStore, coordinator, historyManager, settings } = this.dependencies;
    return { checkpointStore, coordinator, historyManager, settings };
  }
}
