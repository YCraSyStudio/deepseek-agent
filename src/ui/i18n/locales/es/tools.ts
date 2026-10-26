import type { TranslationCatalog } from "../Types";

export const tools = {
  tools: {
    permissionMode: "Modo de permisos",
    defaultDescription: "Cada llamada de herramienta requiere confirmación.",
    fullAccessDescription: "Las operaciones rutinarias y elevadas se ejecutan automáticamente en cualquier ubicación. La confirmación se reserva para acciones críticas que podrían inutilizar el equipo o causar una pérdida amplia e irreversible.",
    default: "Predeterminado",
    fullAccess: "Acceso completo",
    autoApprove: "Aprobación automática",
    autoApproveModeDescription: "Las operaciones rutinarias se ejecutan automáticamente dentro y fuera del workspace. Las operaciones elevadas o críticas requieren confirmación.",
    fullAccessWarning: "¿Activar acceso completo? Las operaciones rutinarias y elevadas podrán ejecutarse en cualquier ubicación. Las acciones críticas que podrían inutilizar el equipo o causar una pérdida amplia e irreversible aún requieren confirmación.",
    toolCalls: "Llamadas de herramientas",
    toolCall: "Llamada de herramienta",
    pending: "Pendiente",
    awaitingConfirmation: "Esperando confirmación",
    running: "Ejecutándose",
    completed: "Completada",
    error: "Error",
    rejected: "Rechazada",
    cancelled: "Cancelada",
    openFile: "Abrir archivo",
    reviewTurn: "Revisar cambios",
    revertTurn: "Revertir turno",
    turnReverted: "Turno revertido",
    viewChange: "Ver cambio",
    editedFilesOne: "Se editó 1 archivo",
    editedFilesMany: "Se editaron {count} archivos",
    showMoreFiles: "Mostrar {count} archivos más",
    hideExtraFiles: "Mostrar menos archivos",
    copy: "Copiar",
    insert: "Insertar",
  }
} satisfies TranslationCatalog;
