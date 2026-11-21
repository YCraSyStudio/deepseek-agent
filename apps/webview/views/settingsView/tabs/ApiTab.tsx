import BetaSection from "../sections/BetaSection";
import { AdvancedSection, ApiSection } from "../sections";
import type { ApiCredentialState, SaveOnBlurFn, SettingsConfig, UpdateConfigFn } from "../model";
import type { TranslationKey } from "@webview/i18n/I18n";

interface ApiTabProps {
  config: SettingsConfig;
  apiKeyDraft: string;
  credential: ApiCredentialState | null;
  updateConfig: UpdateConfigFn;
  saveOnBlur: SaveOnBlurFn;
  onApiKeyChange: (value: string) => void;
  onApiKeyBlur: (value: string) => void;
  modelOptions: Array<{ value: string; label: string }>;
  reasoningEffortOptions: ReadonlyArray<{ value: NonNullable<SettingsConfig["reasoningEffort"]>; label: TranslationKey }>;
}

function ApiTab(props: ApiTabProps) {
  return (
    <ApiSection {...props}>
      <BetaSection config={props.config} updateConfig={props.updateConfig} saveOnBlur={props.saveOnBlur} />
      <AdvancedSection config={props.config} updateConfig={props.updateConfig} saveOnBlur={props.saveOnBlur} />
    </ApiSection>
  );
}

export default ApiTab;
