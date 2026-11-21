import type { TranslationCatalog } from "../Types";

export const tools = {
  tools: {
    permissionMode: "权限模式",
    defaultDescription: "每次工具调用都需要确认。",
    fullAccessDescription: "常规和提权操作可在任何位置自动执行。只有可能导致计算机无法使用或造成大范围不可逆损失的关键操作才需要确认。",
    default: "默认",
    fullAccess: "完全访问",
    autoApprove: "自动批准",
    autoApproveModeDescription: "常规操作可在工作区内外自动执行。提权或关键操作仍需确认。",
    fullAccessWarning: "启用完全访问？常规和提权操作可在任何位置执行。可能导致计算机无法使用或造成大范围不可逆损失的关键操作仍需确认。",
    toolCalls: "工具调用",
    toolCall: "工具调用",
    pending: "待处理",
    awaitingConfirmation: "等待确认",
    running: "运行中",
    completed: "已完成",
    error: "错误",
    rejected: "已拒绝",
    cancelled: "已取消",
    openFile: "打开文件",
    reviewTurn: "查看更改",
    revertTurn: "撤销本轮",
    turnReverted: "本轮已撤销",
    viewChange: "查看更改",
    editedFilesOne: "已编辑 1 个文件",
    editedFilesMany: "已编辑 {count} 个文件",
    showMoreFiles: "再显示 {count} 个文件",
    hideExtraFiles: "收起文件",
    copy: "复制",
    insert: "插入",
  }
} satisfies TranslationCatalog;
