import type { TranslationCatalog } from "../Types";

export const results = {
  results: {
    retainedOutput: "Ver salida conservada",
    searchResults: "Resultados de búsqueda",
    binaryContentCannotBePreviewedAsText: "El contenido binario no puede previsualizarse como texto.",
    binaryPreviewUnavailable: "Se detectó un archivo binario. La vista previa de texto no está disponible.",
    clickToOpenPathLine: "Abrir {path}:{line}",
    beforeSize: "antes {size}",
    afterSize: "después {size}",
    binarySource: "origen binario",
    binaryDiffUnavailable: "El archivo anterior era binario, por lo que no hay diff de texto disponible.",
    binary: "binario",
    truncated: "truncado",
    countResults: "{count} resultados",
    andCountMoreResults: "... y {count} resultados más",
    result: "Resultado",
    terminalCommandMetadata: "Metadatos del comando de terminal",
    cancelled: "cancelado",
    timedOut: "tiempo agotado",
    exitCode: "salida {code}",
    unknown: "desconocida",
    cwdCwd: "directorio: {cwd}",
    shellShell: "shell: {shell}",
    signalSignal: "señal: {signal}",
    truncatedPreview: " (vista previa truncada)",
    outputTruncated: "salida truncada",
    commandCompletedWithoutOutput: "El comando terminó sin salida.",
    truncatedDiffNotice: "La vista previa del diff está truncada. La operación de archivo terminó correctamente.",
    onlyTheFirstSizeIsShown: "Solo se muestran los primeros {size}."
  }
} satisfies TranslationCatalog;
