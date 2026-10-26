export const INSTRUCTION_TEMPLATE_IDS = ["blank", "git", "commit"] as const;
export type InstructionTemplateId = (typeof INSTRUCTION_TEMPLATE_IDS)[number];

/** Editable starter files; placeholders intentionally leave project-specific conventions to the user. */
export function instructionTemplate(id: InstructionTemplateId, locale: string): { name: string; description: string; body: string } {
  const language = locale.toLowerCase().startsWith("es") ? "es" : locale.toLowerCase().startsWith("zh") ? "zh" : "en";
  const templates = {
    en: {
      blank: { name: "blank", description: "", body: "## Instructions\n<!-- Write the rules and steps to follow when performing this task here. -->\n" },
      git: { name: "git", description: "When working with Git branches, merges or repository history", body: `## Before making changes
- Inspect the repository status, current branch and relevant diff.
- Preserve unrelated local changes; do not discard or stage them automatically.

## Workflow
<!-- Define branch names, target branches, and the project's merge/rebase policy. -->
- Use the workflow requested by the user or documented by the project.
- Require an explicit user request before pushing, deleting branches or rewriting shared history.

## Validation
<!-- List project checks to run before integrating changes. -->
- Report conflicts, checks performed and any checks that could not run.
` },
      commit: { name: "commit", description: "When creating or reviewing a Git commit", body: `## Message conventions
<!-- Language: define the commit message language here. -->
<!-- Format: choose prefixes such as fix: / feature:, or a [ticket] prefix. -->
<!-- Example: fix(auth): correct session expiration. Adapt to your project's conventions. -->

## Before committing
- Inspect the status and staged diff; include only changes covered by the user's request.
- Preserve unrelated edits and staged files.
- Run the relevant project checks and report any that could not run.

## Commit
- Write a concise message that accurately describes the staged changes.
- Commit only when requested by the user; do not push or amend unless requested.
` },
    },
    es: {
      blank: { name: "blank", description: "", body: "## Instrucciones\n<!-- Escribe aquí las reglas y los pasos que deben seguirse al realizar esta tarea. -->\n" },
      git: { name: "git", description: "Al trabajar con ramas, integraciones o historial de Git", body: `## Antes de modificar
- Revisa el estado del repositorio, la rama actual y el diff pertinente.
- Conserva los cambios locales ajenos a la tarea; no los descartes ni añadas al staging automáticamente.

## Flujo de trabajo
<!-- Define los nombres de ramas, las ramas de destino y la política de merge/rebase del proyecto. -->
- Sigue el flujo solicitado por el usuario o documentado por el proyecto.
- Requiere una petición explícita del usuario antes de hacer push, eliminar ramas o reescribir historial compartido.

## Validación
<!-- Enumera las comprobaciones del proyecto antes de integrar los cambios. -->
- Informa de los conflictos, las comprobaciones realizadas y las que no se pudieron ejecutar.
` },
      commit: { name: "commit", description: "Al crear o revisar un commit de Git", body: `## Convenciones del mensaje
<!-- Idioma: define aquí el idioma de los mensajes de commit. -->
<!-- Formato: elige prefijos como fix: / feature:, o un prefijo [ticket]. -->
<!-- Ejemplo: fix(auth): corrige la caducidad de la sesión. Adáptalo a las convenciones del proyecto. -->

## Antes del commit
- Revisa el estado y el diff del staging; incluye solo cambios que correspondan a la petición del usuario.
- Conserva las ediciones y los archivos en staging ajenos a la tarea.
- Ejecuta las comprobaciones pertinentes del proyecto e informa de las que no se pudieron ejecutar.

## Commit
- Escribe un mensaje conciso que describa con precisión los cambios en staging.
- Haz commit solo cuando lo pida el usuario; no hagas push ni amend salvo que se solicite.
` },
    },
    zh: {
      blank: { name: "blank", description: "", body: "## 指令\n<!-- 在此填写执行此任务时需要遵循的规则和步骤。 -->\n" },
      git: { name: "git", description: "处理 Git 分支、合并或仓库历史时", body: `## 修改前
- 检查仓库状态、当前分支及相关差异。
- 保留与任务无关的本地改动，不自动丢弃或暂存它们。

## 工作流
<!-- 定义分支命名、目标分支及项目的 merge/rebase 策略。 -->
- 遵循用户请求或项目文档中的工作流。
- 推送、删除分支或改写共享历史前必须有用户的明确请求。

## 验证
<!-- 列出整合改动前需要运行的项目检查。 -->
- 报告冲突、已执行的检查及无法执行的检查。
` },
      commit: { name: "commit", description: "创建或检查 Git 提交时", body: `## 消息约定
<!-- 语言：在此定义提交消息的语言。 -->
<!-- 格式：选择 fix: / feature: 等前缀或 [ticket] 前缀。 -->
<!-- 示例：fix(auth): 修复会话过期。请按项目约定调整。 -->

## 提交前
- 检查状态和暂存区差异，仅包含用户请求涉及的改动。
- 保留无关的编辑及暂存文件。
- 执行相关项目检查，并报告无法执行的检查。

## 提交
- 使用简洁准确的消息描述暂存改动。
- 仅在用户要求时提交；未经要求不推送或 amend。
` },
    },
  };
  return templates[language][id];
}
