import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import type { ImageAttachment } from "@/contracts";
import type { SecretStore, SettingsRepository } from "@/application/ports";
import { deleteDeepSeekFile, uploadDeepSeekImage } from "@/infrastructure/deepseek/files/DeepSeekFiles";

const MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
const FILE_EXPIRY_SECONDS = 30 * 24 * 60 * 60;

export class ImageAttachmentController {
  readonly cacheRoot: vscode.Uri;

  constructor(
    context: vscode.ExtensionContext,
    private readonly settings: SettingsRepository,
    private readonly secrets: SecretStore,
  ) {
    this.cacheRoot = vscode.Uri.joinPath(context.globalStorageUri, "image-attachments");
  }

  async classifyAndUpload(
    webview: vscode.Webview,
    uris: readonly vscode.Uri[],
  ): Promise<{ attachments: ImageAttachment[]; contextUris: vscode.Uri[] }> {
    const attachments: ImageAttachment[] = [];
    const contextUris: vscode.Uri[] = [];
    let uploadConfig: { baseUrl: string; apiKey: string } | undefined;
    try {
      for (const uri of uris) {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.type !== vscode.FileType.File || stat.size < 1) {
          contextUris.push(uri);
          continue;
        }
        if (stat.size > MAX_IMAGE_BYTES) {
          if (looksLikeImageFilename(uri.path)) {
            throw new Error(`"${uri.path.split("/").at(-1) ?? "image"}" exceeds DeepSeek's 64 MiB image limit.`);
          }
          contextUris.push(uri);
          continue;
        }
        const bytes = await vscode.workspace.fs.readFile(uri);
        if (!detectImageMediaType(bytes)) {
          contextUris.push(uri);
          continue;
        }
        if (attachments.length >= MAX_IMAGES) {
          throw new Error(`Select at most ${MAX_IMAGES} images per message.`);
        }
        if (!uploadConfig) {
          await this.settings.waitForPendingWrites();
          const config = this.settings.load();
          const apiKey = await this.secrets.getApiKey(config.baseUrl);
          if (!apiKey) {throw new Error("Configure the DeepSeek API key before attaching images.");}
          await vscode.workspace.fs.createDirectory(this.cacheRoot);
          uploadConfig = { baseUrl: config.baseUrl, apiKey };
        }
        attachments.push(await this.uploadBytes(
          webview,
          bytes,
          uri.path.split("/").at(-1) ?? "image",
          "picker",
          uploadConfig.baseUrl,
          uploadConfig.apiKey,
        ));
      }
      return { attachments, contextUris };
    } catch (error) {
      await Promise.allSettled(attachments.map((attachment) => this.delete(attachment)));
      throw error;
    }
  }

  async uploadClipboard(
    webview: vscode.Webview,
    input: { name: string; size: number; dataBase64: string },
  ): Promise<ImageAttachment> {
    const bytes = Buffer.from(input.dataBase64, "base64");
    if (bytes.byteLength !== input.size) {throw new Error("The pasted image payload is incomplete.");}
    await this.settings.waitForPendingWrites();
    const config = this.settings.load();
    const apiKey = await this.secrets.getApiKey(config.baseUrl);
    if (!apiKey) {throw new Error("Configure the DeepSeek API key before attaching images.");}
    await vscode.workspace.fs.createDirectory(this.cacheRoot);
    return this.uploadBytes(webview, bytes, input.name, "clipboard", config.baseUrl, apiKey);
  }

  async delete(attachment: ImageAttachment): Promise<void> {
    const cacheUri = this.getCacheUri(attachment.cacheFileName);
    await vscode.workspace.fs.delete(cacheUri, { recursive: false, useTrash: false }).then(undefined, () => undefined);
    const apiKey = await this.secrets.getApiKey(attachment.apiBaseUrl);
    if (!apiKey) {throw new Error("The image was removed locally, but its DeepSeek file could not be deleted because the API key is unavailable.");}
    await deleteDeepSeekFile({ apiKey, baseUrl: attachment.apiBaseUrl, fileId: attachment.fileId });
  }

  getCacheUri(cacheFileName: string): vscode.Uri {
    if (!/^[A-Za-z0-9._-]+$/.test(cacheFileName)) {throw new Error("Invalid image cache filename.");}
    return vscode.Uri.joinPath(this.cacheRoot, cacheFileName);
  }

  private async uploadBytes(
    webview: vscode.Webview,
    bytes: Uint8Array,
    filename: string,
    source: ImageAttachment["source"],
    baseUrl: string,
    apiKey: string,
  ): Promise<ImageAttachment> {
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_IMAGE_BYTES) {throw new Error("The image exceeds DeepSeek's 64 MiB limit.");}
    const mediaType = detectImageMediaType(bytes);
    if (!mediaType) {throw new Error(`"${filename}" is not a supported JPEG, PNG, GIF, or WebP image.`);}
    const id = randomUUID();
    const name = safeFilename(filename || `image-${id}`);
    const uploaded = await uploadDeepSeekImage({
      apiKey,
      baseUrl,
      bytes,
      filename: name,
      mediaType,
      expiresAfterSeconds: FILE_EXPIRY_SECONDS,
    });
    const cacheFileName = `${id}.${extensionFor(mediaType)}`;
    const cacheUri = vscode.Uri.joinPath(this.cacheRoot, cacheFileName);
    try {
      await vscode.workspace.fs.writeFile(cacheUri, bytes);
    } catch (error) {
      await deleteDeepSeekFile({ apiKey, baseUrl, fileId: uploaded.id }).catch(() => undefined);
      throw error;
    }
    return {
      id,
      fileId: uploaded.id,
      name,
      mediaType,
      size: bytes.byteLength,
      source,
      uploadedAt: uploaded.createdAt * 1_000,
      expiresAt: (uploaded.expiresAt ?? uploaded.createdAt + FILE_EXPIRY_SECONDS) * 1_000,
      apiBaseUrl: baseUrl,
      cacheFileName,
      previewUri: webview.asWebviewUri(cacheUri).toString(),
    };
  }
}

function detectImageMediaType(bytes: Uint8Array): ImageAttachment["mediaType"] | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {return "image/jpeg";}
  if (bytes.length >= 8 && bytes.slice(0, 8).every((value, index) => value === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index])) {return "image/png";}
  const prefix = Buffer.from(bytes.slice(0, 6)).toString("ascii");
  if (prefix === "GIF87a" || prefix === "GIF89a") {return "image/gif";}
  if (bytes.length >= 12 && Buffer.from(bytes.slice(0, 4)).toString("ascii") === "RIFF" && Buffer.from(bytes.slice(8, 12)).toString("ascii") === "WEBP") {return "image/webp";}
  return undefined;
}

function extensionFor(mediaType: ImageAttachment["mediaType"]): string {
  return mediaType === "image/jpeg" ? "jpg" : mediaType.split("/")[1];
}

function safeFilename(value: string): string {
  const sanitized = value.replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_").trim();
  return (sanitized || "image").slice(0, 512);
}

function looksLikeImageFilename(value: string): boolean {
  return /\.(?:jpe?g|png|gif|webp)$/i.test(value);
}
