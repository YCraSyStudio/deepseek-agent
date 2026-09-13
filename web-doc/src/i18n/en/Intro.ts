import type { PageContent } from "../Types";

export const intro: PageContent = {
  navTitle: "Intro",
  title: "Introduction",
  seoTitle: "DeepSeek extension: introduction",
  description: "What YCraSy DeepSeek Agent is, which release channel it ships on, and what the current pre-release build includes.",
  lead: "YCraSy DeepSeek Agent is DeepSeek-only by design. It provides a focused assistant inside VS Code without provider switching.",
  sections: [
    {
      title: "Release channels",
      items: [
        "Version lines alternate by minor number: odd minor lines (0.1.x, 0.3.x, ...) are pre-release builds that keep the preview: true gallery flag, and even minor lines (0.2.x, 0.4.x, ...) are stable releases with preview: false. This documentation describes the current 0.1.x pre-release line.",
        "The 0.1.x line is not stable. Bugs found in daily use are fixed and published as incremental patch releases (0.1.14, 0.1.15, ...), and the line is promoted to 0.2.x only once daily use stops reporting errors.",
        "Pre-release updates may change the conversation storage format and can make chats created by earlier 0.x versions unavailable. Copy or export any conversation you need to keep before updating.",
      ],
    },
    {
      title: "Current pre-release scope",
      items: [
        "Sidebar chat with responses, reasoning, and tool calls streamed and rendered in chronological order.",
        "Reasoning and tools stay compact in expandable Activity groups; file tools open the affected file or the exact recorded change in the native editor.",
        "A finished turn ends with an edited-files summary whose rows open the recorded change of each written file, and usage cost can be displayed in US dollars or Chinese yuan from Settings.",
        "list_workspace renders the whole project as one indented tree in a single call, hidden entries included, so a new chat does not have to chain directory listings.",
        "Long conversations render only their newest messages and reveal earlier ones on demand, so scrolling and typing stay responsive.",
        "Attached images open an enlarged viewer that fits, zooms, and can be dragged to pan while keeping the image's aspect ratio.",
        "Thinking mode can be enabled or disabled without disabling tools.",
        "DeepSeek V4.1 Flash reads uploaded images directly, in chat and in tool rounds.",
        "One attachment action accepts context files and JPEG, PNG, GIF, or WebP images, and images can also be pasted with Ctrl+V or Cmd+V.",
        "Default confirms every tool, auto-approve runs routine operations automatically and confirms elevated actions, and full-access confirms only critical actions that could broadly damage the computer.",
        "Safe path autocomplete appears only after typing ./; auto context, Git, instructions, terminal, and tools all use the same immutable logical-workspace snapshot.",
        "Settings and global history are stored under ~/.deepseek-agent/ with configurable retention, native deletion confirmation, and Undo.",
        "Explicit Stop preserves the submitted prompt, partial timeline, and completed tool results as a cancelled turn. Steering safely restarts the transport but explicitly continues the original task under the latest guidance without showing a misleading interruption warning.",
        "API credentials are isolated by origin in VS Code Secret Storage and never returned to the webview; Settings shows only a masked placeholder preview.",
      ],
    },
    {
      title: "Non-affiliation",
      items: [
        "This is an independent third-party extension. It is not affiliated with, endorsed by, sponsored by, or officially maintained by DeepSeek.",
      ],
    },
  ],
};
