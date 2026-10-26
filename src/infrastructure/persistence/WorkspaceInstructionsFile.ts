import { stat, writeFile } from "node:fs/promises";
import * as path from "node:path";

/** A human-editable template, without model requests or guessed project commands. */
export async function ensureWorkspaceInstructionsFile(directory: string, locale = "en"): Promise<string> {
  if (!(await stat(directory)).isDirectory()) {throw new Error("Open an existing workspace directory first.");}
  const file = path.join(directory, "AGENTS.md");
  try {await writeFile(file, template(locale), { encoding: "utf8", flag: "wx", mode: 0o644 });}
  catch (error) {if ((error as NodeJS.ErrnoException).code !== "EEXIST") {throw error;}}
  if (!(await stat(file)).isFile()) {throw new Error("Workspace AGENTS.md must be a file.");}
  return file;
}

function template(locale: string): string {
  if (locale.toLowerCase().startsWith("es")) {
    return `# AGENTS.md

## Descripción del proyecto
<!-- Describe el propósito, las tecnologías y los directorios principales. -->

## Preparación y desarrollo
<!-- Añade los comandos para instalar dependencias, ejecutar y compilar el proyecto. -->

## Validación
<!-- Indica los comandos de pruebas, lint y comprobación de tipos que deben ejecutarse. -->

## Convenciones
<!-- Documenta el estilo, la arquitectura, los nombres y el idioma de las respuestas. -->

## Límites
<!-- Indica los archivos generados que no deben editarse y las operaciones que requieren revisión. -->
`;
  }
  if (locale.toLowerCase().startsWith("zh")) {
    return `# AGENTS.md

## 项目概述
<!-- 描述项目目标、技术栈和主要目录。 -->

## 设置与开发
<!-- 添加安装依赖、运行和构建项目的命令。 -->

## 验证
<!-- 列出需要运行的测试、lint 和类型检查命令。 -->

## 约定
<!-- 记录代码风格、架构、命名和回复语言。 -->

## 边界
<!-- 指明不应编辑的生成文件以及需要审核的操作。 -->
`;
  }
  return `# AGENTS.md

## Project overview
<!-- Describe the project's purpose, technologies and main directories. -->

## Setup and development
<!-- Add the commands to install dependencies, run and build the project. -->

## Validation
<!-- List the tests, lint and type-check commands that should be run. -->

## Conventions
<!-- Document code style, architecture, naming and response language. -->

## Boundaries
<!-- Identify generated files that should not be edited and operations requiring review. -->
`;
}
