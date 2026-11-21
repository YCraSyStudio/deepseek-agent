import "./Header.css";
import "@vscode/codicons/dist/codicon.css";
import Deepseek from "@/assets/DeepSeekIcon.svg";
import { t } from "@webview/i18n";

type ViewType = "chat" | "settings" | "history";

type HeaderProps = {
  currentView: ViewType;
  ViewChangeHandler: (view: ViewType) => void;
  onNewConversation: () => void;
  incognitoEnabled: boolean;
  incognitoUpdatePending: boolean;
  onIncognitoToggle: (enabled: boolean) => void;
};

function Header({ currentView, ViewChangeHandler, onNewConversation, incognitoEnabled, incognitoUpdatePending, onIncognitoToggle }: HeaderProps) {
  const handleLeftButton = () => {
    switch (currentView) {
      case "chat":
        return (
          <>
            <button type="button" className="historyBtn" onClick={() => ViewChangeHandler("history")} aria-label={t("navigation.history")} data-tooltip={t("navigation.history")} data-tooltip-position="bottom" data-tooltip-align="start">
              <span className="codicon codicon-history" />
            </button>
            <button
              type="button"
              className={`incognitoBtn${incognitoEnabled ? " active" : ""}`}
              aria-pressed={incognitoEnabled}
              aria-label={t(incognitoEnabled ? "navigation.disableIncognito" : "navigation.enableIncognito")}
              data-tooltip={t(incognitoEnabled ? "navigation.disableIncognito" : "navigation.enableIncognito")}
              data-tooltip-position="bottom"
              data-tooltip-align="start"
              disabled={incognitoUpdatePending}
              onClick={() => onIncognitoToggle(!incognitoEnabled)}
            >
              <span className="codicon codicon-eye-closed" />
            </button>
          </>
        );
      default:
        return (
          <button type="button" className="backBtn" onClick={() => ViewChangeHandler("chat")} aria-label={t("navigation.back")} data-tooltip={t("navigation.back")} data-tooltip-position="bottom" data-tooltip-align="start">
            <span className="codicon codicon-arrow-left" />
          </button>
        );
    }
  };

  return (
    <header className="header">
      <div className="leftTooling">{handleLeftButton()}</div>
      <div className="center">
        <img src={Deepseek} alt="deepseek" className="logoImg" />
      </div>
      <div className="rightTooling">
        {currentView === "chat" ? (
          <>
            <button type="button" className="newChatBtn" onClick={onNewConversation} aria-label={t("navigation.newChat")} data-tooltip={t("navigation.newChat")} data-tooltip-position="bottom" data-tooltip-align="end">
              <span className="codicon codicon-add" />
            </button>
          </>
        ) : null}

        <button
          type="button"
          className={currentView === "settings" ? "settingsBtn hidden" : "settingsBtn"}
          onClick={() => ViewChangeHandler("settings")}
          aria-label={t("navigation.settings")}
          data-tooltip={t("navigation.settings")}
          data-tooltip-position="bottom"
          data-tooltip-align="end"
        >
          <span className="codicon codicon-gear" />
        </button>
      </div>
    </header>
  );
}

export default Header;
