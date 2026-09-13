import type { PageContent } from "../Types";

export const technicalDecisions: PageContent = {
  navTitle: "技术决策",
  title: "技术决策",
  seoTitle: "架构与技术决策",
  description: "扩展的分层方式、生成任务的归属与恢复机制，以及流式传输、工具和持久化的设计。",
  lead: "扩展将领域状态、DeepSeek 传输、VS Code 能力和 React 渲染分离，使安全规则在扩展宿主中保持权威。",
  sections: [
    {
      title: "分层边界",
      items: [
        "contracts 负责可序列化的 DeepSeek、配置和 webview 协议 v5 模型，不依赖 UI、VS Code、文件系统或 HTTP。",
        "application 通过显式端口负责与提供商无关的会话、上下文、生成任务和工具规则。",
        "infrastructure 负责 DeepSeek chat、SSE、Files API、SearXNG 搜索与页面提取、变更审查和具体内置工具。",
        "platform/vscode 负责密钥、工作区、存储、进程、确认、附件上传与缓存、宿主路由和原生 diff。",
        "ui 负责 React webview，只有收到宿主消息后才会更改权威工具状态。Chat 和 Settings 按功能分组，并使用明确的内部导入。",
      ],
    },
    {
      title: "按时间排序的事件模型",
      items: [
        "助手输出以类型化的推理、内容和工具组事件持久化，而不是将控制标记嵌入文本。",
        "实时流和恢复的历史记录使用同一 timeline 契约，保留 think -> tool -> think -> response 顺序。",
        "文本增量按动画帧分组，并在工具组、完成、取消或持久化之前刷新。",
        "消息、事件、会话和备用工具调用 ID 使用 crypto.randomUUID()。",
        "相邻的推理和工具事件在展示层中分组为默认折叠的 Activity 块，同时保持持久化时间顺序不变。",
      ],
    },
    {
      title: "生成任务归属与恢复",
      items: [
        "协调器保证每个会话最多运行一个生成任务，同时允许不同会话进行有界并发。并发上限默认为 8，并限制在 1 到 16 之间。",
        "客户端请求 ID、生成 ID 和会话 ID 将队列、流、工具批准、取消和快照绑定到正确的任务。",
        "Interrupt and guide 会先将新指导加入队首，安全中止当前传输，并记录经过验证的源生成任务链接。下一次请求会按该指导明确继续原始任务；普通发送仍是独立的排队轮次。",
        "带修订号的原子 checkpoint 会保留部分 timeline、工具状态、不含密钥的配置和排队提示。激活时会恢复中断输出，并将排队提示作为草稿提供。",
        "显式 Stop 将已提交提示和部分 timeline 保存为 cancelled；steering 与生命周期恢复仍使用 interrupted。每个已接受任务在持久化后只发布一个终止结果。",
        "有界、无工具的完成度审查器会对可疑的过早文本停止评估一次。再次出现的不完整结果会保持 failed/incomplete，而不会被转换为虚假的最终回答。",
      ],
    },
    {
      title: "工具和终端",
      items: [
        "工具状态使用单一原生生命周期，最终进入 completed、rejected、cancelled 或 error；拒绝不会被编码为执行错误。",
        "同一工具轮次中的调用按顺序执行，并在工作区修改时期改变前阻止重复调用。所有权限模式都没有任意轮次或每块调用上限。无工具审查器会在 20 轮后以及此后每五轮接收紧凑的累计活动；其建议会指导下一次正常轮次，但不会禁用工具。并发任务之间只读工具可重叠，工作区变更则按工作区串行。",
        "在 VS Code 中，每个命令都会通过 Shell Integration 在专用集成终端中可见执行；同一终端会复用于后续命令，只有在超时、取消、工作目录不匹配或扩展关闭时才会关闭，并保留结构化有界输出、取消、超时和退出状态。系统拒绝分离式启动器，并禁用代理终端中的 .NET 构建服务器复用；非 VS Code 宿主继续使用 headless 执行器作为兼容回退。",
        "每个会话保存带修订号的逻辑工作区绑定。每次运行只捕获一次文件夹、别名、能力和活动编辑器根；操作不会回退到当前编辑器或第一个文件夹。",
        "路径授权仅接受工作区 ./ 路径，拒绝父目录遍历、绝对路径和 URI，并解析真实路径与现有祖先以防止 symlink 或 junction 越界。",
        "显式外部附件是临时只读快照；不会持久化，也不会把工具授权扩展到绑定工作区之外。",
        "统一选择器按二进制签名分类文件。图像使用 DeepSeek Files API file ID 和本地预览缓存，由 DeepSeek V4.1 Flash 直接读取；不再有中间工具处理视觉。",
        "已确认的文件写入带有 SHA-256 守卫；如果预览后磁盘内容发生变化，编辑或覆盖会失败。",
        "自动模式使用独立的 DeepSeek 实例且不使用本地危险分析器，将修改分类为常规、提权或关键。审查器接收初始请求、机械范围事实和显式命名的非敏感工作区文件受限预览；自动决策至少需要 medium-high 置信度。",
        "原生变更视图根据该次创建、编辑或补丁记录的受限 diff 重建前后文档，而不是读取当前磁盘或 Git 状态。",
      ],
    },
    {
      title: "API、上下文和持久化",
      items: [
        "SSE 支持注释、CRLF、带或不带空格的 data 字段、多行事件、解码器收尾、异常 JSON 诊断和 reader 取消。",
        "DeepSeek 请求使用规范化 URL，每次尝试超时 60 秒；对临时故障最多尝试三次，并遵守 Retry-After。",
        "网页搜索使用 SearXNG。默认 loopback 端点由平台运行时提供，其版本、大小和 SHA-256 摘要固定在 VSIX 中；兼容的自定义端点在非 loopback 环境必须使用 HTTPS，且不能包含凭据。",
        "设置、schema-v2 会话历史和 schema-3 生成 checkpoint 保存在 ~/.deepseek-agent/ 下。API 凭据按规范化来源单独保存在 VS Code Secret Storage 中，webview 只接收遮罩状态。checkpoint 绝不包含密钥，不兼容的历史或 checkpoint 文件会被直接删除，不进行迁移。",
        "DeepSeek 请求拒绝带凭据的 URL，在非 loopback 环境强制 HTTPS，在重定向中保持所选来源，并从可见错误中移除敏感值。",
        "已注册的 DeepSeek V4.1 Flash 能力使用 1M Token 总上下文和 384K 最大输出。配置的输出预留默认为 384,000，并与安全余量一起减少输入预算。",
        "上下文具有总预算、二进制检测、Git staged 和 unstaged 数据、受限的 AGENTS.md 来源，以及明确的不受信任数据分隔符。",
      ],
    },
  ],
};
