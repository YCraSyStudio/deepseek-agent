import type { TranslationCatalog } from "../Types";

export const confirmations = {
  confirmations: {
    reviewDetails: "Revisar detalles",
    reviewTool: "Revisar {tool}",
    reviewFileDescription: "Revisa la operación completa para {path} antes de elegir una acción.",
    reviewToolDescription: "Revisa esta operación de {tool} antes de elegir una acción.",
    completeArgumentsForTool: "Argumentos completos de {tool}",
    roundRound: "Ronda {round}",
    openFileInEditor: "Abrir archivo en el editor",
    filePath: "Archivo: {path}",
    reviewBeforeExecuting: "Revisa la operación antes de ejecutarla.",
    executeOnce: "Ejecutar una vez",
    reject: "Rechazar",
    executeAllManualToolsOnce: "Ejecutar una vez todas las herramientas manuales",
    rejectAllManualTools: "Rechazar todas las herramientas manuales",
    completeCommand: "Comando completo",
    workingDirectory: "Directorio de trabajo:",
    shell: "Shell:",
    cancel: "Cancelar",
    yesExecuteOnce: "Sí, ejecutar una vez",
    destructiveOnceDescription: "Esta operación revisada solo se aprueba una vez. Las mutaciones posteriores reciben una nueva revisión independiente.",
    destructiveAction: "Acción destructiva",
    potentiallyDangerousAction: "Acción potencialmente peligrosa",
    cautionRequired: "Se requiere precaución"
  }
} satisfies TranslationCatalog;
