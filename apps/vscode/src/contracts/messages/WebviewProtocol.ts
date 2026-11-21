export const WEBVIEW_PROTOCOL_VERSION = 5 as const;

export const WEBVIEW_INPUT_LIMITS = {
  chatText: 1024 * 1024,
  referenceContent: 1024 * 1024,
  totalReferenceContent: 5 * 1024 * 1024,
  references: 50,
  images: 8,
  imageBytes: 64 * 1024 * 1024,
  clipboardImageBytes: 16 * 1024 * 1024,
} as const;
