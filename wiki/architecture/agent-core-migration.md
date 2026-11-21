# Migración del runtime del agente a .NET

Decisión: **un único runtime en .NET**. El chat, las herramientas, la persistencia
y las credenciales viven en procesos .NET; la extensión de VS Code pasa a ser un
cliente (UI + adaptador del editor), igual que la app MAUI. No se mantiene un
worker en Node ni el runtime TypeScript en paralelo más allá de la transición.

Motivo: evitar dos implementaciones del mismo comportamiento (bucle de
generación, llamadas a herramientas, compacción de contexto, streaming,
validación), que se desincronizan y duplican cada corrección.

## Estado de partida

- `apps/vscode/src/application/**` es la capa de aplicación actual, en TypeScript,
  con puertos ya definidos: `ModelProvider`, `SettingsRepository`, `SecretStore`,
  `ToolHost`, `IdGenerator`, `GenerationEventSink`.
- `apps/core` es un proxy ASP.NET Core de ~150 líneas que reenvía `/ui/*` al
  servicio del IDE móvil de la extensión (`127.0.0.1:43189`). Su destino es
  convertirse en el router de F7; hoy no enruta identidades.
- El protocolo con la UI está fijado en `WEBVIEW_PROTOCOL_VERSION = 5`
  (`apps/vscode/src/contracts/messages/WebviewProtocol.ts`) y los tipos de
  mensaje en `WebviewRequests.ts` / `WebviewEvents.ts`.
- La UI React compartida se compila a `dist/webview` y la consumen tanto la
  extensión como el proxy.
- `apps/runtime` (ASP.NET Core, `net10.0`) existe desde F1: sirve la UI, habla el
  protocolo, guarda configuración y credenciales.

La capa TypeScript es la referencia funcional: cada comportamiento que se porte
a .NET debe quedar cubierto por una prueba equivalente antes de retirarlo.

## Regla de transición

Mientras dure la migración, el runtime TypeScript es la única fuente de verdad
funcional y solo recibe correcciones de errores. El código .NET avanza por fases
con paridad verificada; no se publican dos rutas de chat simultáneas al usuario.

Dos reglas adicionales que no estaban en la versión anterior del plan:

- **Un solo escritor de datos.** Hasta F4 el historial y los borradores los
  escribe únicamente el runtime TypeScript. A partir de la importación de F4 los
  escribe únicamente `apps/runtime`, con marca de esquema y detección del estado
  mixto (ambos almacenes con datos de la misma cuenta) para no corromper nada si
  alguien vuelve atrás.
- **La paridad es una puerta, no un deseo.** Una fase no se cierra mientras su
  fila de la matriz de paridad tenga pruebas rojas o ausentes.

## Orden de fases

| Fase | Alcance | Estado |
|---|---|---|
| F1 | Esqueleto del runtime: UI compartida y protocolo | Hecho (2026-11-18) |
| F2 | Configuración y credenciales (`libsecret` + fichero `0600`) | Hecho (2026-11-18) |
| F2b | Abstracción de transporte del cliente (VS Code `postMessage` / HTTP+SSE) | Pendiente |
| F3a | Proveedor DeepSeek y streaming sin herramientas | En curso (compilación sin verificar) |
| F3b | `ToolHost` mínimo de solo lectura (`read_file`, `list_directory`, `search_content`) | Pendiente |
| F4 | Persistencia e historial, importación desde TS y un solo escritor | Pendiente |
| F5a | Diseño del adaptador del editor (canal inverso, autorización, timeouts) | Pendiente |
| F5b | Implementación del adaptador y del resto de herramientas | Pendiente |
| F6 | Extensión como cliente; retirada del servicio del IDE móvil | Pendiente |
| F7 | Router por identidad y servicio de sistema | Pendiente |
| F8 | Retirada del runtime TypeScript | Pendiente |

Las fases se ejecutan en el orden de esta tabla. Cambiar el orden de una fase
exige registrar el cambio en «Registro de cambios de orden» antes de
implementarlo, con el motivo y la fecha.

## Fases

### F1. Esqueleto del runtime (`apps/runtime`) — hecho

Host mínimo que sirve la UI compartida y responde al protocolo.

- `/health`, `/ui/`, `/ui/shim.js`, `/ui/assets/*`, `/ui/post`, `/ui/events`.
- `initializeProtocol` → `protocolReady`/`protocolError`; `getConfig` →
  `configLoaded`; el resto → `requestRejected`.
- SSE con `id:` y reproducción por `Last-Event-ID`, keep-alive cada 15 s.

Criterio: la UI carga servida por el runtime y completa el handshake sin la
extensión abierta.

### F2. Configuración y credenciales — hecho

- Almacén de credenciales: `libsecret` vía `secret-tool` y respaldo de fichero
  `0600` en `~/.ycrasy-agent` cuando no hay sesión de keyring.
- Persistencia de configuración con revisión, validación por campo y escritura
  atómica.

Criterio: clave del proveedor usable con VS Code cerrado.

Nota sobre multiusuario: `libsecret` necesita el bus de sesión del usuario y no es
alcanzable desde una unidad de sistema. En F7 el camino soportado es el fichero
`0600`; `libsecret` queda como mejora para escritorio con sesión gráfica.

### F2b. Abstracción de transporte del cliente

Adelantada desde F6 (ver registro, cambio C1). El webview de VS Code no puede usar
`fetch`/`EventSource`: exige `acquireVsCodeApi` y `postMessage`. Sin esta pieza,
el mismo bundle de UI no puede servir a los dos clientes.

- Contrato `Transport` en la UI (`post`, `subscribe`, estado de sesión) con dos
  implementaciones: VS Code (`postMessage` + `window.addEventListener`) y HTTP
  (`fetch` + `EventSource`), seleccionadas por el shim.
- El shim y el transporte comparten la misma lógica de reintento, handshake y
  reproducción; no se duplica en cada cliente.

Criterio: el mismo bundle de `dist/webview` funciona servido por el runtime y
dentro del webview de VS Code, con una sola implementación del protocolo.

### F3a. Proveedor y generación sin herramientas

- Cliente DeepSeek con streaming SSE, reintentos, cancelación y `testConnection`.
- Cola por conversación, límite de generaciones concurrentes y presupuesto de
  contexto mínimo.
- Sin ejecución de herramientas: una petición de herramienta se responde como
  error explícito y el turno termina.

Criterio: conversación completa con streaming desde la UI, sin extensión y sin
herramientas. (Escindida de F3, ver cambio C2.)

### F3b. Herramientas mínimas de solo lectura

- `ToolHost` con `read_file`, `list_directory` y `search_content`, con los mismos
  límites, permisos y validación de rutas del runtime TypeScript.
- Bucle de herramientas completo: el modelo pide, se ejecuta, se devuelve el
  resultado y se continúa la generación.

Criterio: un turno con lectura de ficheros funciona sin editor abierto.

### F4. Persistencia e historial

- Conversaciones, mensajes, uso y borradores en almacenamiento local del
  runtime, con las mismas garantías que hoy (recuperación de borradores,
  paginación, retención).
- Importación única desde el almacén del runtime TypeScript
  (`globalStorageUri` del editor) con prueba de migración.
- Marca de esquema y bloqueo de doble escritor.

Criterio: historial y borradores idénticos a los actuales, con pruebas de
migración de datos existentes y sin dos escritores activos.

### F5a. Diseño del adaptador del editor

- Dirección y propiedad del canal: el runtime escucha, la extensión conecta y se
  registra como adaptador cuando está abierta.
- Autorización del canal (loopback + credencial por sesión) y ámbitos por
  comando.
- Timeout y degradación si VS Code no responde.
- Comportamiento con dos ventanas del mismo usuario: un adaptador por ventana
  con workspace declarado, y resolución de ambiguüedad en el runtime.

Criterio: documento revisado y aprobado; sin este diseño no se implementa F5b.

### F5b. Herramientas del editor

- Operaciones que solo tienen sentido en VS Code (aplicar edición, selección,
  diagnósticos, previsualización de imágenes) por el canal del adaptador.
- Sin adaptador conectado, error explícito y el resto del chat sigue funcionando.

Criterio: un turno con herramientas de fichero y shell funciona sin editor; con
editor conectado, las operaciones de edición funcionan.

### F6. Extensión como cliente

- La extensión deja de componer el runtime: conserva webview, comandos y el
  adaptador del editor, y habla el protocolo con el runtime usando el transporte
  de F2b.
- Se retira el servicio del IDE móvil (`MobileIde`/`MobileWebviewBridge`).

Criterio: la UI de VS Code y la app móvil consumen el mismo runtime y no queda
código TypeScript de generación en la ruta de chat.

### F7. Router y servicio de sistema

- `apps/core` deja de ser proxy: resuelve identidad verificada → UID, lanza un
  worker por cuenta con un lanzador de privilegio mínimo, y comprueba acceso en
  cada comando y suscripción.
- Unidad `systemd` en `multi-user.target`, ejecutables en rutas del
  administrador, datos en `~/.ycrasy-agent` de cada cuenta.

Criterio: tras reiniciar, dos cuentas Linux ven solo su historial, workspace y
eventos, con VS Code cerrado.

### F8. Retirada del runtime TypeScript

- Eliminar `apps/vscode/src/application/**` y sus adaptadores una vez cubierta la
  paridad, dejando los contratos de mensajes como fuente de tipos para la UI.

Criterio: suite de pruebas .NET en verde sin el runtime anterior en el árbol.

Rollback: antes de ejecutar F8 se crea la etiqueta `runtime-ts-final` y se deja
documentado el procedimiento de vuelta atrás, que se mantiene durante al menos un
ciclo de release.

## Matriz de paridad

Cada fila se marca al portar el comportamiento. Una fase no se cierra con filas
rojas o vacías de su alcance.

| Comportamiento | Prueba TS | Prueba .NET | Estado |
|---|---|---|---|
| Handshake y rechazo de protocolo no inicializado | *pendiente de anotar* | | |
| Configuración: revisión, validación y escritura atómica | *pendiente de anotar* | | |
| Credenciales: `libsecret` y respaldo `0600` | *pendiente de anotar* | | |
| Streaming y cancelación | *pendiente de anotar* | | |
| Bucle de herramientas y límites | *pendiente de anotar* | | |
| Compacción de contexto y presupuestos | *pendiente de anotar* | | |
| Deduplicación de conversaciones | *pendiente de anotar* | | |
| Borradores y retención | *pendiente de anotar* | | |

Antes de usar la capa TypeScript como referencia hay que arreglar las dos pruebas
que ya fallan hoy (`MessagePresentation.test.ts`, `ToolCallResultPreview.test.ts`):
una prueba en rojo no puede definir paridad.

## Autenticación de clientes (decidido)

**SSH es el único transporte y el único mecanismo de autenticación.** No hay
enrolamiento propio, ni mTLS, ni emisión de tokens por parte del router.

Consecuencias que F6 y F7 deben respetar:

- El cliente (app MAUI u otro) abre un túnel SSH al PC y el router acepta **solo**
  conexiones que lleguen por `127.0.0.1`; no escucha en la LAN.
- La identidad del usuario es la de la sesión SSH. `sshd` ya aporta `pam`,
  bloqueo de cuenta, revocación de claves y registro de accesos; el runtime no
  reimplementa nada de eso.
- El emparejamiento sigue igual que hoy: el runtime publica el código en
  `~/.ycrasy-agent/mobile-ide-code` (`0600`) y el cliente lo lee por el canal
  `exec` de su propia sesión SSH. No hay pantalla de login ni código que teclear.
- Revocar un dispositivo es retirar su clave de `authorized_keys`. No hace falta
  un registro de dispositivos propio.
- Como la confidencialidad la aporta el túnel, el transporte interno puede seguir
  siendo HTTP en loopback. Queda prohibido exponer el puerto fuera de
  `127.0.0.1`; la comprobación de origen se mantiene como defensa en profundidad
  frente a peticiones de otros procesos locales.
- La app no ve ni guarda la clave API: la credencial vive en el PC.

## Registro de cambios de orden

Se permite reordenar fases cuando una bloquea a otra; el cambio se documenta aquí
antes de implementarlo.

### C1 — La abstracción de transporte adelanta de F6 a F2b (2026-11-18)

Motivo: F6 suponía que la extensión usaría `fetch`+`EventSource`, pero su webview
solo dispone de `postMessage`. Sin el transporte, el mismo bundle no puede servir
a dos clientes y el problema aparecería ya dentro de F6, obligando a rehacer el
shim y la UI. Se resuelve antes de tocar el chat.

### C2 — F3 se escinde en F3a (generación sin herramientas) y F3b (herramientas mínimas), adelantando parte de F5 (2026-11-18)

Motivo: el criterio de F3 ("conversación completa") era inalcanzable sin
herramientas, porque el bucle de generación y el de herramientas se llaman
mutuamente. Con un `ToolHost` mínimo de solo lectura en F3b se cierra la
conversación real sin arrastrar aún las herramientas de escritura, shell y git ni
el adaptador del editor.

### C3 — F5 se escinde en F5a (diseño) y F5b (implementación) (2026-11-18)

Motivo: el adaptador del editor invierte la dirección de las dependencias
(el runtime llama al cliente) y necesita decisiones de autorización, timeouts y
múltiples ventanas. Implementarlo sin ese diseño antes de F6 lo haría dos veces.

### C4 — Regla de un solo escritor de datos en F4 (2026-11-18)

Motivo: el plan no decía quién escribe historial durante la transición. Dos
escritores sobre el mismo almacén lo corrompen; se fija TS hasta la importación y
solo el runtime después, con marca de esquema.

### C5 — La matriz de paridad como puerta de fase (2026-11-18)

Motivo: "cada comportamiento con prueba equivalente" no era verificable. Ahora es
una tabla con filas y una condición de cierre por fase.

### C6 — Rollback explícito para F8 (2026-11-18)

Motivo: borrar `apps/vscode/src/application/**` elimina la red de seguridad. Se
añade etiqueta y procedimiento de vuelta atrás con vigencia mínima de un ciclo de
release.

### C7 — Credenciales multiusuario: `0600` como camino soportado (2026-11-18)

Motivo: F2 dejaba `libsecret` como opción principal, pero una unidad de sistema no
alcanza el bus de sesión del usuario. `libsecret` pasa a mejora de escritorio y el
fichero `0600` al camino por defecto en F7.

### C8 — Autenticación cerrada: SSH como único transporte (2026-11-18)

Motivo: F7 no podía empezar con el mecanismo sin decidir y un sistema de
enrolamiento propio (mTLS o tokens) habría que construirlo desde cero, duplicando
lo que `sshd` ya resuelve. No es un cambio de orden, pero sí una decisión que
desbloquea F6 y F7; se registra aquí para que el plan no quede ambiguo.

## Riesgos conocidos

- **Paridad**: la capa TypeScript concentra reglas sutiles (deduplicación,
  interrupciones, presupuestos de contexto). Cada una necesita prueba antes de
  retirarla; la matriz de paridad lo hace explícito.
- **Herramientas del editor**: sin adaptador conectado hay funciones que no
  pueden replicarse; se documentan como limitación, no se simulan.
- **Credenciales sin sesión gráfica**: `libsecret` requiere keyring desbloqueado;
  el respaldo `0600` es el camino para cuentas sin escritorio.
- **Migración de datos**: historial, borradores e imágenes existentes deben
  importarse con prueba dedicada antes de cambiar el almacén por defecto.
- **Contratos en dos lenguajes**: `WEBVIEW_PROTOCOL_VERSION` vive hoy solo en
  TypeScript. Hace falta una fuente única (snapshot JSON verificado por pruebas en
  ambos lados) y una política de compatibilidad N-1 para el APK, que no se
  actualiza al ritmo del PC.
