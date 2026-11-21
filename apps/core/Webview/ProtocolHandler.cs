using System.Text.Json;
using YCraSy.Agent.Runtime.Configuration;
using YCraSy.Agent.Runtime.Model;

namespace YCraSy.Agent.Runtime.Webview;

/// <summary>
/// Despacho del protocolo de la webview. F1 cubrió el handshake y la lectura de la
/// configuración; F2 añade persistencia de ajustes y la credencial del proveedor;
/// F3a añade la generación de texto sin herramientas. El resto de peticiones se
/// rechazan con un mensaje explícito mientras se portan.
/// </summary>
public sealed class ProtocolHandler(ConfigService config, GenerationService generations)
{
    public const int ProtocolVersion = 5;

    public async Task HandleAsync(JsonElement message, WebviewHub hub, CancellationToken ct)
    {
        var type = message.ValueKind == JsonValueKind.Object && message.TryGetProperty("type", out var kind)
            ? kind.GetString()
            : null;

        switch (type)
        {
            case "initializeProtocol":
                var requested = message.TryGetProperty("protocolVersion", out var version) && version.TryGetInt32(out var parsed)
                    ? parsed
                    : 0;
                hub.Publish(requested == ProtocolVersion
                    ? new Dictionary<string, object?>
                    {
                        ["type"] = "protocolReady",
                        ["protocolVersion"] = ProtocolVersion,
                    }
                    : new Dictionary<string, object?>
                    {
                        ["type"] = "protocolError",
                        ["supportedVersion"] = ProtocolVersion,
                        ["error"] = $"Unsupported protocol version {requested}.",
                    });
                break;

            case "getConfig":
                var snapshot = await config.ReadAsync(ct);
                hub.Publish(new Dictionary<string, object?>
                {
                    ["type"] = "configLoaded",
                    ["revision"] = snapshot.Revision,
                    ["config"] = snapshot.Config,
                });
                await PublishKeyStatusAsync(hub, snapshot.HasKey, snapshot.KeyPreview);
                break;

            case "saveConfig":
                var requestId = ReadRequestId(message);
                var outcome = await config.SaveAsync(message.TryGetProperty("config", out var partial) ? partial : default, ct);
                hub.Publish(new Dictionary<string, object?>
                {
                    ["type"] = "configUpdateResult",
                    ["requestId"] = requestId,
                    ["revision"] = outcome.Outcome.Revision,
                    ["operation"] = "save",
                    ["status"] = outcome.Outcome.Success ? "success" : "error",
                    ["config"] = outcome.Outcome.Config,
                    ["credentialUpdated"] = outcome.CredentialUpdated,
                    ["error"] = outcome.Outcome.Success ? null : string.Join(" ", outcome.Outcome.Errors),
                });
                if (outcome.Outcome.Success)
                {
                    var (hasKey, preview) = await config.KeyStatusAsync(ct);
                    await PublishKeyStatusAsync(hub, hasKey, preview);
                }

                break;

            case "resetConfig":
                var resetRequestId = ReadRequestId(message);
                var reset = await config.ResetAsync(ct);
                hub.Publish(new Dictionary<string, object?>
                {
                    ["type"] = "configUpdateResult",
                    ["requestId"] = resetRequestId,
                    ["revision"] = reset.Revision,
                    ["operation"] = "reset",
                    ["status"] = reset.Success ? "success" : "error",
                    ["config"] = reset.Config,
                    ["error"] = reset.Success ? null : string.Join(" ", reset.Errors),
                });
                break;

            case "deleteApiKey":
                var deleteRequestId = ReadRequestId(message);
                var deleted = await config.DeleteKeyAsync(ct);
                hub.Publish(new Dictionary<string, object?>
                {
                    ["type"] = "apiKeyDeleteResult",
                    ["requestId"] = deleteRequestId,
                    ["status"] = deleted ? "success" : "error",
                    ["error"] = deleted ? null : "The credential could not be removed.",
                });
                var (stillHasKey, stillPreview) = await config.KeyStatusAsync(ct);
                await PublishKeyStatusAsync(hub, stillHasKey, stillPreview);
                break;

            case "sendMessage":
                await generations.StartAsync(message, ct);
                break;

            case "cancelGeneration":
                var cancelRequestId = ReadRequestId(message);
                var cancelGenerationId = ReadString(message, "generationId");
                var cancelConversationId = ReadString(message, "conversationId") ?? string.Empty;
                var accepted = generations.Cancel(cancelGenerationId, cancelConversationId);
                hub.Publish(new Dictionary<string, object?>
                {
                    ["type"] = "cancelGenerationResult",
                    ["requestId"] = cancelRequestId,
                    ["generationId"] = cancelGenerationId,
                    ["conversationId"] = cancelConversationId,
                    ["status"] = accepted ? "accepted" : "stale",
                });
                break;

            case "getGenerationSnapshot":
                hub.Publish(generations.Snapshot());
                break;

            case "newConversation":
                hub.Publish(new Dictionary<string, object?>
                {
                    ["type"] = "newConversationReady",
                    ["requestId"] = ReadRequestId(message),
                });
                break;

            default:
                hub.Publish(new Dictionary<string, object?>
                {
                    ["type"] = "requestRejected",
                    ["requestId"] = ReadRequestId(message),
                    ["action"] = type,
                    ["error"] = "This runtime build does not implement that request yet.",
                });
                break;
        }
    }

    private static Task PublishKeyStatusAsync(WebviewHub hub, bool hasKey, string? preview)
    {
        hub.Publish(new Dictionary<string, object?>
        {
            ["type"] = "apiKeyStatus",
            ["status"] = hasKey ? "configured" : "missing",
            ["keyPreview"] = preview,
        });
        return Task.CompletedTask;
    }

    private static string? ReadRequestId(JsonElement message) =>
        message.ValueKind == JsonValueKind.Object &&
        message.TryGetProperty("requestId", out var id) &&
        id.ValueKind == JsonValueKind.String
            ? id.GetString()
            : null;

    private static string? ReadString(JsonElement message, string name) =>
        message.ValueKind == JsonValueKind.Object &&
        message.TryGetProperty(name, out var value) &&
        value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
}
