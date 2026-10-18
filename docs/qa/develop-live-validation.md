# Validación e integración de develop — 2026-10-18

Se revisaron las issues #67 y #70–#76 antes de comprobar sus ramas. Se integraron sus historiales mediante merges en `develop`; `main` y la rama #66 quedan fuera de esta integración. La #66 conserva la decisión previa de aplazar el trabajo de sandbox.

| Issue | Prueba realizada | Resultado y alcance |
| --- | --- | --- |
| #67 | API real: el modelo ejecuta `search_web`, lee con `read_web` y responde con la fuente | Correcto; Search/Fetch de DeepSeek, sin implementación ni comandos SearXNG |
| #70 | Subida real, Flash con visión nativa, Pro con `analyze_images`, archivos del workspace y caché | Correcto; corregidas las carreras entre análisis, subida y cierre para eliminar archivos pendientes |
| #71 | CaptureService, almacenamiento y contrato de herramienta con captura X11 real inyectada | Correcto; la rama de contrato por sí sola no incorpora los backends de las ramas posteriores |
| #72 | Navegador integrado en VS Code 1.142.0 y análisis real del PNG | Correcto a 640 × 480; corregidos espera del adaptador hijo, petición sin respuesta, recorte y cierre de la página propia |
| #73 | Componente React real en webview: miniatura, apertura completa, imagen ausente; análisis real | Correcto; no se automatizó toda la navegación del historial del chat |
| #74 | Backend nativo Linux/X11: título exacto y PID, PID de depuración, destino ausente, rechazo de Wayland; análisis real | Correcto para la ventana de prueba visible; Windows/macOS requieren sus propios hosts |
| #75 | Migración real de archivos, destino existente, idempotencia, interrupción y recuperación, llamada al modelo migrado | Correcto; la clave permaneció en memoria y no se escribió en los ajustes |
| #76 | Captura automática X11, modo desactivado, deduplicación, límite persistente, exclusión de pantalla/terminal; análisis real | Correcto; se redimensionó la ventana propia para generar píxeles nuevos, sin simular un ciclo completo de edición/renderizado por el modelo |

Los informes JSON de [live/](live/) recogen las comprobaciones y el uso. Todas las pruebas de visión incluyeron borrado de sus dos archivos remotos y terminaron sin subidas pendientes. Se usaron únicamente imágenes y ventanas propias de prueba.

## Correcciones al combinar las ramas

Se resolvieron los conflictos de configuración y composición conservando los backends de captura y el cliente web de DeepSeek. Los campos retirados de SearXNG no se restauraron. Se mantuvo exportada la ruta compartida que necesita la separación de ajustes del proveedor y se hicieron privadas las exportaciones sin consumidores.

## Comprobaciones del conjunto

Tipos, lint y auditoría de código sin incidencias; 531 pruebas unitarias pasan con el runner normal. La documentación pasa la comprobación de Astro (32 archivos, cero errores/avisos). La compilación de producción y la lista permitida del VSIX pasan: 16 entradas y canal normal/Public Preview. Las pruebas unitarias de #74 y #75 necesitaron ampliar el plazo de los escaneos de arquitectura durante comprobaciones concurrentes en este host; no se modificaron sus pruebas de origen.

La integración nativa pasa sus 11 pruebas en VS Code 1.142.0/Linux/X11. Los límites de las pruebas de escritorio y del runner del VSIX pasan a 20 segundos: el límite previo de cinco segundos agotó el plazo durante apertura/edición de búferes en el host compartido, y el CLI priorizaba la configuración del repositorio sobre `--timeout`. Las aserciones permanecen intactas. La repetición completa pasa en seis segundos. El VSIX también se instaló en un directorio de extensiones limpio: activación, comandos y apertura del chat pasan (una prueba). El resumen y el SHA-256 están en [develop-summary.json](live/develop-summary.json).

## Coste y límites

Coste acumulado estimado: **0,0692336 CNY**, incluida la validación previa de #67 y las llamadas finales de `develop`, frente al máximo autorizado de 10 CNY. Es una estimación por uso y tarifas; no una lectura del saldo de la cuenta. La credencial temporal no se guarda en el repositorio ni en estos informes.

El Chromium externo de este host agota el tiempo de captura; no se certifica ese fallback por el éxito del navegador integrado. Siguen pendientes Windows, macOS, la compatibilidad mínima con VS Code 1.131 y los casos de navegador minimizado/en segundo plano. Las pruebas automatizadas de ámbito del primer envío pasan; no se afirma haber conducido toda la interfaz del chat con una conversación real y la API.
