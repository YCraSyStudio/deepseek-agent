import type { AppConfig } from "@/contracts";
import type { ModelProvider, ModelProviderFactory } from "@/application/ports";
import { DeepSeekModelProvider } from "./DeepSeekProvider";

export class DeepSeekModelProviderFactory implements ModelProviderFactory {
  create(config: AppConfig): ModelProvider {
    return new DeepSeekModelProvider(config);
  }
}
