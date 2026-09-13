import DeepSeekLogo from "@/assets/DeepSeekIcon.svg";
import "./ChatEmptyState.css";
import { t } from "@webview/i18n";

function ChatEmptyState() {
  return (
    <div className="emptyState">
      <img src={DeepSeekLogo} alt="DeepSeek" />
      <h2>YCraSy DeepSeek Agent</h2>
      <p>{t("chat.emptyDescription")}</p>
      <div className="emptyHints">
        <kbd>Enter</kbd> {t("chat.send")}
        <span> &middot; </span>
        <kbd>Shift+Enter</kbd> {t("chat.newLine")}
      </div>
    </div>
  );
}

export default ChatEmptyState;
