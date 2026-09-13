import { memo, useMemo, useState } from "react";
import type React from "react";
import type { ChatMessage, ToolCallGroup } from "@webview/views/chatView/ChatViewTypes";
import ImageLightbox, { type LightboxImage } from "@webview/components/shared/imageLightbox/ImageLightbox";
import "../../shared/collapsiblePanel/CollapsiblePanel.css";
import "./ChatMessages.css";
import { AssistantActivity } from "./AssistantActivity";
import EditedFilesSummary from "./EditedFilesSummary";
import { PlainText } from "./MarkdownMessage";
import { t } from "@webview/i18n";
import {
  buildMessageToolCallGroups,
  mergeToolCallGroups,
} from "./ToolCallReconciliation";

interface ChatMessagesProps {
  messages: ChatMessage[];
  isProcessing?: boolean;
  renderToolCallGroups?: (groups: ToolCallGroup[]) => React.ReactNode;
  activeToolCallGroups?: ToolCallGroup[];
}

const NO_TOOL_CALL_GROUPS: ToolCallGroup[] = [];

function ChatMessages({
  messages,
  isProcessing = false,
  renderToolCallGroups,
  activeToolCallGroups = NO_TOOL_CALL_GROUPS,
}: ChatMessagesProps) {
  const [enlargedImage, setEnlargedImage] = useState<LightboxImage | null>(null);

  return (
    <>
      {messages.map((message, messageIndex) => {
        const isLastAssistant =
          message.role === "assistant" &&
          messageIndex === messages.length - 1;
        return (
          <MessageRow
            key={message.id}
            message={message}
            isLastAssistant={isLastAssistant}
            isActive={isLastAssistant && isProcessing}
            activeToolCallGroups={isLastAssistant ? activeToolCallGroups : NO_TOOL_CALL_GROUPS}
            renderToolCallGroups={renderToolCallGroups}
            onEnlargeImage={setEnlargedImage}
          />
        );
      })}
      <ImageLightbox image={enlargedImage} onClose={() => setEnlargedImage(null)} />
    </>
  );
}

interface MessageRowProps {
  message: ChatMessage;
  isLastAssistant: boolean;
  isActive: boolean;
  activeToolCallGroups: ToolCallGroup[];
  renderToolCallGroups?: (groups: ToolCallGroup[]) => React.ReactNode;
  onEnlargeImage: (image: LightboxImage) => void;
}

const MessageRow = memo(function MessageRow({
  message,
  isActive,
  activeToolCallGroups,
  renderToolCallGroups,
  onEnlargeImage,
}: MessageRowProps) {
  const toolCallGroups = useMemo(
    () => mergeToolCallGroups(buildMessageToolCallGroups(message), activeToolCallGroups),
    [message, activeToolCallGroups],
  );

  return (
    <div className={`message ${message.role}`}>
      <MessageBody
        message={message}
        isActive={isActive}
        toolCallGroups={toolCallGroups}
        renderToolCallGroups={renderToolCallGroups}
        onEnlargeImage={onEnlargeImage}
      />
    </div>
  );
});

function MessageBody({
  message,
  isActive,
  toolCallGroups,
  renderToolCallGroups,
  onEnlargeImage,
}: {
  message: ChatMessage;
  isActive: boolean;
  toolCallGroups: ToolCallGroup[];
  renderToolCallGroups?: (groups: ToolCallGroup[]) => React.ReactNode;
  onEnlargeImage: (image: LightboxImage) => void;
}) {
  if (message.role === "error") {
    return <div className="errorMessage">{message.content}</div>;
  }
  if (message.role === "context") {
    return <div className="contextCompactionMarker"><span aria-hidden="true">⇄</span> {t("chat.contextAutomaticallyCompacted")}</div>;
  }
  if (message.role === "assistant") {
    return (
      <>
        <AssistantActivity
          timeline={message.timeline ?? []}
          toolCallGroups={toolCallGroups}
          renderToolCallGroups={renderToolCallGroups}
          isActive={isActive}
          generationStatus={message.generationStatus}
          generationStopReason={message.generationStopReason}
        />
        {isActive ? null : <EditedFilesSummary toolCallGroups={toolCallGroups} />}
      </>
    );
  }
  if (message.role === "user") {
    return (
      <div className="messageContent">
        {message.imageAttachments?.length ? (
          <div className="messageImages">
            {message.imageAttachments.map((attachment) => {
              const previewUri = attachment.previewUri;
              return previewUri
                ? (
                  <button
                    key={attachment.id}
                    type="button"
                    className="messageImageButton"
                    title={attachment.name}
                    aria-label={t("chat.enlargeImage", { name: attachment.name })}
                    onClick={() => onEnlargeImage({ id: attachment.id, src: previewUri, name: attachment.name })}
                  >
                    <img src={previewUri} alt={attachment.name} />
                  </button>
                )
                : <span key={attachment.id} className="messageImageFallback"><span className="codicon codicon-file-media" /> {attachment.name}</span>;
            })}
          </div>
        ) : null}
        {message.content ? <PlainText content={message.content} /> : null}
      </div>
    );
  }
  return <PlainText content={message.content} />;
}

export default memo(ChatMessages);
