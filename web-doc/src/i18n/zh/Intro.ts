import type { PageContent } from "../Types";

export const intro: PageContent = {
  navTitle: "介绍",
  title: "介绍",
  seoTitle: "DeepSeek 扩展简介",
  description: "介绍 YCraSy DeepSeek Agent、它发布的版本通道，以及当前预发布版本包含的功能。",
  lead: "YCraSy DeepSeek Agent 设计上仅支持 DeepSeek，在 VS Code 中提供专注的助手体验，不提供供应商切换。",
  sections: [
    {
      title: "发布渠道",
      items: [
        "版本线按 minor 号交替：奇数 minor 线（0.1.x、0.3.x……）是保留 preview: true 画廊标记的预发布版本，偶数 minor 线（0.2.x、0.4.x……）是 preview: false 的稳定版本。本文档描述当前的 0.1.x 预发布线。",
        "0.1.x 线并不稳定。日常使用中发现的问题会修复并以增量补丁版本发布（0.1.14、0.1.15……），只有日常使用不再报告问题时才会升级到 0.2.x。",
        "预发布版本的更新可能更改会话存储格式，并可能导致早期 0.x 版本创建的会话不可用。更新前请复制或导出需要保留的会话。",
      ],
    },
    {
      title: "当前预发布范围",
      items: [
        "侧边栏聊天会以时间顺序流式呈现响应、推理和工具调用。",
        "推理和工具会保持在紧凑的可展开 Activity 组中；文件工具可在原生编辑器中打开受影响文件或该次记录的精确变更。",
        "完成的轮次以已编辑文件摘要收尾，每行可打开对应文件的记录变更；使用费用可在 Settings 中按美元或人民币显示。",
        "list_workspace 一次调用即可将整个项目绘制为缩进树（包含隐藏条目），新会话无需再串联目录列表。",
        "长会话仅渲染最新消息，更早的消息按需显示，使滚动和输入保持流畅。",
        "附件图像会打开放大的查看器，可适配、缩放并拖动平移，同时保持图像宽高比。",
        "Thinking mode 可以开启或关闭，而不会禁用工具。",
        "DeepSeek V4.1 Flash 可直接读取上传的图像，聊天和工具轮次均可。",
        "统一的附件操作同时支持上下文文件和 JPEG、PNG、GIF、WebP 图像，也可使用 Ctrl+V 或 Cmd+V 粘贴图像。",
        "Default 会确认每个工具；auto-approve 自动执行常规操作并确认提权操作；full-access 只确认可能大范围损坏计算机的关键操作。",
        "仅输入 ./ 才会显示安全路径自动补全；自动上下文、Git、指令、终端和工具都使用同一个不可变逻辑工作区快照。",
        "设置和全局历史记录保存在 ~/.deepseek-agent/ 下，支持可配置保留期、原生删除确认和撤销。",
        "显式 Stop 会将已提交提示、部分 timeline 和已完成工具结果保留为 cancelled 轮次。Steering 会安全重启传输，但会按最新指导明确继续原始任务，并隐藏误导性的中断警告。",
        "API 凭据按来源隔离存储在 VS Code Secret Storage 中，绝不会返回给 webview；Settings 只显示遮罩占位符预览。",
      ],
    },
    {
      title: "非官方关系",
      items: [
        "这是一个独立的第三方扩展，不隶属于 DeepSeek，也不由 DeepSeek 认可、赞助或官方维护。",
      ],
    },
  ],
};
