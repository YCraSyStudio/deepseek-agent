[Back](INDEX.md)

# IDE móvil (MVP)

El navegador del móvil se conecta a la extensión que se ejecuta en VS Code de escritorio. El servicio escucha en `127.0.0.1:43189` y necesita que VS Code siga abierto. El chat usa el proveedor, el modelo y la clave configurados en el PC. El código de conexión se guarda en memoria y cambia al reiniciar el servicio.

## Probar desde VS Code

1. En un clon de esta rama, ejecuta `npm ci` desde la raíz y abre la carpeta del repositorio en VS Code.
2. Pulsa **F5** y abre una carpeta local de confianza con un repositorio Git en la ventana de desarrollo. Si quieres usar el chat, configura DeepSeek en esa ventana.
3. Ejecuta **YCraSy DeepSeek Agent: Iniciar IDE móvil (MVP)** en la paleta de comandos y elige **Copiar código**. Puedes repetir el comando para recuperar el código o elegir **Abrir en este PC** para probar la interfaz primero en el escritorio.
4. Para probar desde el móvil, conecta los dos dispositivos a la misma red privada de Tailscale. En el PC ejecuta `tailscale serve --https=43189 http://127.0.0.1:43189` y deja ese terminal abierto. Abre en el móvil la URL HTTPS que imprime Serve e introduce el código. [Documentación de Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve)
5. Cuando termines, ejecuta **YCraSy DeepSeek Agent: Detener IDE móvil** y cierra el proceso de Serve con **Ctrl+C**.

## Comprobar el flujo

- **Archivos**. Busca un archivo de texto UTF-8 ya versionado, ábrelo, edítalo y guarda. Comprueba el cambio en el PC con `git diff`. Se pueden editar archivos existentes de hasta 128 KiB.
- **Conflictos**. Con un archivo abierto en el móvil, modifícalo en el PC. Comprueba que al guardar desde el móvil se muestra el conflicto y se conserva tu borrador.
- **Chat**. Envía una consulta y después una pregunta de seguimiento. La conversación es temporal, separada del chat de escritorio y compartida por los navegadores conectados con el mismo código. Puedes pegar código de forma manual.
- **Cierre**. Detén el servicio desde VS Code. Al volver a iniciarlo, el código anterior deja de ser válido.

[Back](INDEX.md)
