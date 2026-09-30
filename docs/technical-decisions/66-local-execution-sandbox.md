# #66 — Propuesta de aislamiento local del agente

Estado: propuesta de investigación, revisable en `agent/66-local-sandbox-proposal`, basada directamente en `develop-agent`. No cambia la ejecución de producción. Resultados reproducibles en `scripts/research/sandbox-probe.mjs`; registros inicial y corregido junto a este documento. Consulta de fuentes: 30 de septiembre de 2026.

## Recomendación

Introducir un ejecutor local del núcleo compartido, independiente de DeepSeek y de la webview. Primera implementación: Linux/WSL2 con Bubblewrap, proyecto montado explícitamente, entorno limpio y red denegada por defecto. La terminal integrada debe usar ese mismo ejecutor, sin una vía alternativa sin aislamiento. Después, desarrollar un helper de Windows con token/ACL/Job Object y estudiar un backend macOS mantenible. Ofrecer contenedores como alternativa optativa, con sus montajes y conexiones sujetos a la misma política.

El prototipo prueba viabilidad en este host Linux; no certifica aislamiento de la extensión completa. Se recomienda empezar por el contrato y las pruebas de garantías antes de activar el backend por defecto. Ni una revisión de riesgo favorable ni `auto-approve` deben ampliar los permisos técnicos.

## Inventario del repositorio

| Ruta | Acceso real | Control actual | Aislamiento pendiente |
| --- | --- | --- | --- |
| `VsCodeTerminalExecution.ts` | Shell Integration `executeCommand` en terminal reutilizada | Cola, límites, cancelación y cierre | El comando y sus hijos conservan permisos del usuario |
| `ShellExecution.ts` | `spawn(command,{shell,…})` cuando no hay ejecutor del host | Límite de tiempo/salida, grupo de procesos y teardown | Mismo usuario; cwd no restringe accesos |
| `VsCodeToolWorkspace.ts` / `WorkspacePathResolver.ts` | `workspace.fs`, lectura/escritura/move/delete, rutas externas aprobadas | Resolución y validación lógica, confianza del workspace | El host de extensión está fuera del sandbox de comandos; necesita el mismo broker de archivos |
| Herramientas de Git/build/test | Ejecutables y scripts vía terminal | Revisión de herramienta y controles anteriores | Hooks, npm scripts y procesos hijos deben heredar política |
| `SearxngManager.ts` | Runtime Python mediante `spawn`; descargas y comprobaciones HTTP | Runtime verificado, proceso controlado, endpoints | Servicio independiente con red necesaria y permisos acotados a su runtime; no dar estos accesos a comandos del agente |
| `HeadlessWebRuntime`, `SearxngSearch` | HTTP desde el host | Políticas de URL, límites, cancelación | Broker de red distinto del shell, con diagnóstico explícito |
| Adaptador DeepSeek / SecretStorage | API autenticada y credenciales | Endpoint y almacenamiento de secretos | Solo el broker de modelo recibe la clave; no heredarla en helpers/terminal |
| Captura web/nativa (#71–#74) | Debug API/CDP, navegador del sistema, helpers del SO | Objetivo exacto, acceso por origen, límites, confirmación de pantalla | Permiso GUI específico; no abrir socket de escritorio a cualquier script del proyecto |
| Almacenamiento e imágenes | Historial/checkpoints/capturas/caché de adjuntos | Locks, escritura atómica y resolución de fuentes | Datos del agente fuera de montajes del proyecto; broker de visión comparte solo la imagen elegida |
| Editor, diff y descubrimiento de instrucciones | API del host; proyecto y referencias autorizadas | Binding de workspace y validaciones | Acceso del broker, no capacidad general de los procesos |

Inventario basado en la rama develop y las implementaciones de captura de esta sesión. La propuesta no modifica esas otras ramas. Al añadir herramientas futuras, deben declarar sus capacidades antes de registrarse; un `spawn`, acceso directo a archivos o cliente HTTP nuevo no puede eludir el broker.

## Amenazas y garantías pretendidas

Cubrir errores del agente, instrucciones maliciosas de contenido externo, scripts de proyecto/dependencias y sus procesos hijos. Proteger archivos ajenos al proyecto, secretos del usuario y del agente, sockets privilegiados, red no autorizada y otras conversaciones. El aislamiento sigue limitado por el kernel/SO, la política de montajes y la integridad del helper.

No pretende contener un host de extensión comprometido, un administrador malicioso, vulnerabilidades del kernel ni exfiltración a un destino explícitamente permitido. Si un secreto está en un archivo legible del proyecto, autorizar lectura del proyecto también puede exponerlo: los archivos sensibles requieren exclusiones o vistas de trabajo separadas. Aislar comandos no garantiza que las herramientas directas del host estén aisladas.

## Alternativas

| Mecanismo | Garantía útil | Requisitos/coste | Limitación y decisión |
| --- | --- | --- | --- |
| Linux/WSL2 Bubblewrap | Namespaces + montajes + entorno explícitos, aplicados también a hijos | Paquete local; user namespaces permitidos; sin daemon | No define una política por sí solo. Backend recomendado; seccomp/cgroups y broker de red deben diseñarse |
| macOS Seatbelt/sandbox-exec | Restricciones de procesos según perfil | Presente en sistemas que lo admitan; sin contenedor | `sandbox-exec`/SBPL no son una interfaz pública mantenida para terceros. Spike obligatorio por versión; no prometer mantenimiento gratis |
| macOS App Sandbox / helper firmado | Frontera soportada por entitlements del helper | Helper firmado, perfiles y distribución propios | No equivale automáticamente a ejecutar cualquier toolchain con montajes dinámicos; requiere experimentación |
| Windows token restringido + ACL | Reduce privilegios y limita objetos según ACL | Helper nativo, permisos del workspace y limpieza | Token reducido por sí solo no bloquea red ni todo acceso de lectura; necesita controles separados y pruebas con cuentas reales |
| Windows AppContainer/LPAC | Capacidades y DACL; restricciones de recursos/red | Perfil, permisos de archivos y helper Win32 | Compatibilidad de Git/Node/.NET/ConPTY por probar; no presumirla por documentación |
| Windows usuario dedicado + firewall | Separación de identidad y política de red | Instalación administrativa, ACLs y ciclo de usuarios | Más coste operativo. Evaluar como modo fuerte; no modificar usuarios/firewall desde una extensión sin instalación explícita |
| Contenedor local rootless / VM | Vista separada del filesystem y runtime reproducible | Daemon/VM e imágenes; toolchains y sincronización | No montar socket Docker, credenciales ni raíz del host. Coste mayor y GUI/native debugging menos transparentes |
| Solo validación de rutas/revisión de riesgo | Reduce errores de herramientas conocidas | Actual, bajo coste | No aísla scripts, syscalls o hijos; insuficiente como garantía técnica |

Bubblewrap instalado declara LGPL-2+ en `/usr/share/doc/bubblewrap/copyright`; este prototipo usa el paquete del sistema y no lo redistribuye. Cualquier binario empaquetado necesita avisos, fuentes y revisión de obligaciones de su versión. Las APIs nativas dependen de los términos del SDK/SO; una implementación propia o reutilización de código de terceros necesita revisar su licencia concreta. Docker Desktop tiene condiciones comerciales específicas; no es una opción universalmente gratuita. El backend local propuesto no depende de una API de pago.

## Contrato propuesto

```ts
interface ExecutionPolicy {
  revision: string;
  readRoots: readonly string[];
  writeRoots: readonly string[];
  protectedPaths: readonly string[];
  network: { mode: 'deny' | 'brokered'; allowedOrigins: readonly string[] };
  allowedEnvironment: Readonly<Record<string, string>>;
  timeoutMs: number;
  maxOutputBytes: number;
}
interface LocalExecutionBroker {
  probe(): Promise<{ backend: string; available: boolean; reason?: string }>;
  execute(request: {
    executable: string; args: readonly string[]; cwd: string;
    policy: ExecutionPolicy; approvalGrant?: ScopedGrant; signal: AbortSignal;
  }): Promise<BoundedExecutionResult>;
  files(policy: ExecutionPolicy): PolicyBoundFileAccess;
}
```

Tipos ilustrativos: aún no se incorporan a los contratos de producción. Un grant está ligado a operación, revisión de política, raíces/orígenes, expiración y workspace. Se valida fuera del modelo y no puede convertirse en una excepción global. Capturar y registrar el backend efectivo, permisos y si existe una excepción sin aislamiento; el usuario debe verlos en el diagnóstico/estado de la ejecución.

La UI recibe salida/estado por el broker. `vscode.Pseudoterminal` puede mostrar un proceso aislado; validar un PTY real para fidelidad de shell y señales. Shell Integration solo se reutiliza si inicia y conserva el wrapper aislado bajo la política actual. No heredar una terminal antigua con una política más amplia; recrear al cambiar política. El fallback `spawn` debe llamar al mismo broker. Si falta el backend o falla su arranque, devolver `sandbox_unavailable` y bloquear ejecución; usar modo sin aislamiento solo con autorización explícita, visible y acotada.

## Política inicial

| Recurso | Lectura | Escritura | Red/otros |
| --- | --- | --- | --- |
| Proyecto y worktrees autorizados | Sí, con exclusiones | Solo raíces delegadas | Proteger metadatos del agente, secretos y controles de políticas; `.git` con acceso explícito según operación |
| Referencias externas seleccionadas | Solo ficheros/raíces autorizadas | No | No inferir autorización a directorio padre |
| Temporales | Área privada por ejecución | Sí | Limpieza al terminar; límites de bytes/procesos |
| Toolchains/runtimes | Montajes mínimos de solo lectura | No | No scripts de usuario ni hooks globales ocultos |
| Cachés npm/NuGet/build | Caché dedicada del broker | Solo caché dedicada | Evitar home completo; paquetes/scripts siguen siendo código no fiable |
| Home, SSH, credenciales, historiales | No por defecto | No | Variables de entorno por lista permitida; sin agentes SSH/GPG ni sockets heredados |
| Internet | No por defecto | — | Broker con DNS/IP/origen y redirecciones controlados; instalación requiere grant específico |
| Servicios locales | No por defecto | — | Grant por servicio; no compartir toda la red del host para habilitar localhost |
| GUI/DBus/Docker/VS Code IPC | No por defecto | — | Capturador separado con objetivo autorizado; jamás socket Docker para shell arbitrario |

Resolver rutas reales, symlinks y montajes al aplicar el grant; comprobar de nuevo al abrir. Tratar cambios de workspace y de política como invalidación de sesiones. El broker de archivos necesita defensas contra reemplazos de symlinks entre validación y apertura; `realpath` previo por sí solo no elimina TOCTOU. Las exclusiones dentro de una raíz escribible requieren un montaje protegido o una vista de proyecto filtrada, no solo comparar prefijos.

## Separación de aprobación e aislamiento

`default`: conserva la confirmación actual de herramientas; el backend sigue aplicando su política. `auto-approve`: permite trabajo rutinario ya delegado dentro de esa misma frontera. Revisión automática: decide únicamente un grant acotado para una acción bloqueada; no modifica el perfil por considerar la acción segura. `full-access`: debe indicar explícitamente que desactiva o amplía la frontera; no activarlo como recuperación silenciosa de un fallo del sandbox. Una aprobación no cambia por sí misma las restricciones de archivos/red de otras ejecuciones ni de SearXNG.

## Experimentos Linux

Comando: `node scripts/research/sandbox-probe.mjs`. Usa exclusivamente archivos sintéticos en un directorio temporal, un servicio TCP de prueba y una identidad passwd/group sintética. Retira los fixtures al terminar. No instala paquetes, no toca perfiles de seguridad del sistema y no copia credenciales. Lanzamiento sin fallback sin aislamiento.

Host observado: Bubblewrap 0.11.1; Node 24.18.0; Git 2.53.0; SDK .NET 10.0.112. Primera ejecución: npm falló al faltar una identidad/home resoluble y `dotnet restore --ignore-failed-sources` agotó 30 s intentando restauración. Esos fallos se conservan en el registro inicial. Segunda ejecución: passwd/group mínimos, fuentes NuGet vacías y auditoría de red desactivada en el fixture; no se amplió la red ni se montó el home del usuario.

| Fixture | Resultado corregido |
| --- | --- |
| Arranque del sandbox | OK |
| Escritura permitida en proyecto + lectura de referencia | OK |
| Lectura/escritura fuera de raíces | Bloqueadas |
| Escritura de referencia readonly | Bloqueada |
| Symlink del proyecto hacia secreto externo | Bloqueado |
| `.env` del proyecto | Enmascarado; no expone sus bytes |
| Variable sintética heredada | Eliminada |
| Hijo Node | Hereda restricción de filesystem |
| Servicio loopback del host | Inaccesible |
| Git init/add/commit offline | OK, ~13 ms |
| npm test offline | OK, ~202 ms |
| Restore/build .NET sin paquetes externos | OK, ~2,99 s |
| Timeout | Retorna ETIMEDOUT en ~100 ms |

20 lanzamientos vacíos: mediana 5,72 ms, p95 6,61 ms. Tamaño observado de `/usr/bin/bwrap`: 80.424 bytes; no es tamaño total de distribución ni coste de toolchains. GNU time informó 43.412 KiB para Node y 1.980 KiB para el proceso wrapper; son contabilidades separadas, no memoria agregada del árbol. No se midieron batería, contención, proyectos grandes, latencia de red ni coste de mantenimiento. Las cifras son una observación de este host, no un presupuesto garantizado.

No se probaron Windows, macOS, WSL2, Dev Containers, SSH, ConPTY/PTY ni terminales concurrentes. Un extension host remoto debe aplicar el backend al SO remoto; no asumir que la UI y los comandos comparten máquina. Un Dev Container no certifica por sí mismo el aislamiento: revisar montajes, capabilities y sockets. El fixture de timeout prueba el retorno del padre; reaping de descendientes y límites de recursos necesitan pruebas adicionales.

## Fases y aceptación

1. **P0 — contrato, diagnóstico y rutas sin bypass.** Inventariar cada ejecutor/helper; adaptar terminal y fallback al broker. Fixture obligatorio de backend ausente/fallo de arranque: cero ejecuciones sin aislamiento. Publicar el modo efectivo.
2. **P0 — Linux/WSL2.** Montajes explícitos, entorno limpio, máscaras, red denegada, cancelación y reaping. Validar symlinks cambiantes, `.git`/secretos dentro del proyecto, procesos nietos, sockets Unix, salida truncada, concurrencia, PTY y cambios de política. Si user namespaces está bloqueado, mostrar requisito; no debilitar globalmente AppArmor automáticamente.
3. **P1 — broker de archivos/red/cachés.** Aplicar la misma política a `workspace.fs`. Grants de paquetes y localhost sin acceso a red completa. Fixtures offline/online de Git con autenticación delegada, npm install/build/test, NuGet y proyectos reales .NET. No inyectar claves API en sus entornos.
4. **P1 — Windows.** Spike comparativo token+ACL, AppContainer y usuario dedicado; fixtures de Git/Node/.NET, ConPTY, Job Object, lectura sensible, named pipes, red y teardown. Elegir después de medir; instalación administrativa solo como modo explícito.
5. **P2 — macOS.** Spike por versiones soportadas de helper firmado/App Sandbox y Seatbelt; documentar dependencia no pública si se elige SBPL. Probar toolchains, notarización, restricciones de red y excepciones GUI. Si no hay backend mantenible, contenedor/VM optativo o modo no disponible.
6. **P2 — contenedor optativo y compatibilidad remota.** Sin mounts privilegiados/socket Docker; runner rootless, imágenes versionadas y diagnóstico del host real. Medir descarga, RAM, arranque, debugging y actualización.

Decisiones abiertas: lecturas públicas del sistema frente a lista mínima; UX de grants a paquetes/servicios; cachés por proyecto o compartidas; límites CPU/RAM/procesos; compatibilidad PTY; soporte macOS garantizado; backend fuerte de Windows y coste de instalación. Recomendación: mantener separación provider/core, no incorporar estas capacidades a una extensión específica de DeepSeek.

## Fuentes primarias

- [Sandbox y aprobación, OpenAI](https://learn.chatgpt.com/docs/sandboxing): distingue enforcement de aprobación y documenta backends por SO. Referencia de diseño; no prueba que esta extensión herede sus garantías.
- [Sandbox Windows, OpenAI](https://learn.chatgpt.com/docs/windows/windows-sandbox): distingue usuario dedicado/firewall de token reducido/ACL y controles offline más débiles.
- [Bubblewrap upstream](https://github.com/containers/bubblewrap): política dependiente de argumentos, namespaces, montajes y reaping. Versión local/licencia verificadas también con paquete instalado.
- [AppContainer, Microsoft](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer): modelo SID/capacidades/DACL; no implica compatibilidad demostrada de toolchains.
- [App Sandbox, Apple](https://developer.apple.com/documentation/security/app-sandbox) y [discusión técnica de Apple sobre sandbox-exec](https://developer.apple.com/forums/thread/661939): interfaz soportada de entitlements y advertencia sobre SBPL no documentado para terceros.
- [Seguridad de Docker Engine](https://docs.docker.com/engine/security/) y [licencia Docker Desktop](https://docs.docker.com/subscription-billing/desktop-license/): aislamiento dependiente de capacidades/montajes y condiciones de distribución/comerciales.
