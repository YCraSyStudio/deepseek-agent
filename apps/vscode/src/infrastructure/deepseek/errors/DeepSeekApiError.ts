export class DeepSeekApiError extends Error {
  public status: number;
  public code?: string;
  public reason?: "model_unavailable";

  constructor(status: number, message: string, code?: string, reason?: "model_unavailable") {
    super(message);
    this.name = "DeepSeekApiError";
    this.status = status;
    this.code = code;
    this.reason = reason;
  }
}
