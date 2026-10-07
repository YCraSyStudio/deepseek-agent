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
  onReferenceImage?: (number: number) => void;
}

const NO_TOOL_CALL_GROUPS: ToolCallGroup[] = [];

function ChatMessages({
  messages,
  isProcessing = false,
  renderToolCallGroups,
  activeToolCallGroups = NO_TOOL_CALL_GROUPS,
  onReferenceImage,
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
            onReferenceImage={onReferenceImage}
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
  onReferenceImage?: (number: number) => void;
}

const MessageRow = memo(function MessageRow({
  message,
  isActive,
  activeToolCallGroups,
  renderToolCallGroups,
  onEnlargeImage,
  onReferenceImage,
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
        onReferenceImage={onReferenceImage}
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
  onReferenceImage,
}: {
  message: ChatMessage;
  isActive: boolean;
  toolCallGroups: ToolCallGroup[];
  renderToolCallGroups?: (groups: ToolCallGroup[]) => React.ReactNode;
  onEnlargeImage: (image: LightboxImage) => void;
  onReferenceImage?: (number: number) => void;
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
                  <div key={attachment.id} className="messageImage">
                  <button
                    type="button"
                    className="messageImageButton"
                    title={attachment.imageNumber ? `#${attachment.imageNumber} · ${attachment.name}` : attachment.name}
                    aria-label={t("chat.enlargeImage", { name: attachment.name })}
                    onClick={() => onEnlargeImage({ id: attachment.id, src: previewUri, name: attachment.name })}
                  >
                    <img src={previewUri} alt={attachment.name} />
                  </button>
                  {attachment.imageNumber ? (
                    <button
                      type="button"
                      className="messageImageNumber"
                      title={t("chat.insertImageReference", { number: attachment.imageNumber })}
                      aria-label={t("chat.insertImageReference", { number: attachment.imageNumber })}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => onReferenceImage?.(attachment.imageNumber!)}
                    >#{attachment.imageNumber}</button>
                  ) : null}
                  </div>
                )
                : <span key={attachment.id} className="messageImageFallback"><span className="codicon codicon-file-media" /> {attachment.imageNumber ? `#${attachment.imageNumber} · ` : ""}{attachment.name}</span>;
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
