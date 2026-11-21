using System.Collections.Concurrent;
using System.Text.Json;
using YCraSy.Agent.Runtime.Configuration;
using YCraSy.Agent.Runtime.Webview;

namespace YCraSy.Agent.Runtime.Model;

public sealed class GenerationService(
    ConfigService config,
    SecretStore secrets,
    IModelClient client,
    WebviewHub hub,
    ILogger<GenerationService> logger)
{
    private const int MaximumPromptCharacters = 200_000;

    private sealed record Run(string GenerationId, string ConversationId, CancellationTokenSource Cancellation);

    private readonly ConcurrentDictionary<string, Run> runs = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, List<ChatMessage>> conversations = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, byte> claimed = new(StringComparer.Ordinal);

    public async Task StartAsync(JsonElement message, CancellationToken ct)
    {
        var clientRequestId = ReadString(message, "clientRequestId") ?? Guid.NewGuid().ToString("n");
        var text = ReadString(message, "text")?.Trim();
        var conversationId = ReadString(message, "conversationId") ?? Guid.NewGuid().ToString("n");
        var modelId = ReadString(message, "modelId");

        if (string.IsNullOrEmpty(text))
        {
            hub.Publish(new Dictionary<string, object?>
            {
                ["type"] = "streamError",
                ["generationId"] = "",
                ["conversationId"] = conversationId,
                ["error"] = "The message is empty.",
            });
            return;
        }

        if (text.Length > MaximumPromptCharacters)
        {
            hub.Publish(new Dictionary<string, object?>
            {
                ["type"] = "streamError",
                ["generationId"] = "",
                ["conversationId"] = conversationId,
                ["error"] = $"The message exceeds {MaximumPromptCharacters} characters.",
            });
            return;
        }

        if (!claimed.TryAdd($"{conversationId}|{clientRequestId}", 0))
        {
            logger.LogDebug("Ignoring duplicate clientRequestId {ClientRequestId}.", clientRequestId);
            return;
        }

        var generationId = Guid.NewGuid().ToString("n");
        var cancellation = new CancellationTokenSource();
        runs[generationId] = new Run(generationId, conversationId, cancellation);

        hub.Publish(new Dictionary<string, object?>
        {
            ["type"] = "generationAccepted",
            ["generationId"] = generationId,
            ["conversationId"] = conversationId,
            ["clientRequestId"] = clientRequestId,
        });
        hub.Publish(new Dictionary<string, object?>
        {
            ["type"] = "showTyping",
            ["generationId"] = generationId,
            ["conversationId"] = conversationId,
        });
        PublishActivity(conversationId, generationId, "running", 0);

        var history = conversations.GetOrAdd(conversationId, _ => []);
        lock (history)
        {
            history.Add(new ChatMessage("user", text));
        }

        _ = RunAsync(generationId, conversationId, modelId, [.. history], cancellation);
        await Task.CompletedTask;
    }

    public bool Cancel(string? generationId, string conversationId)
    {
        if (generationId is { Length: > 0 } && runs.TryGetValue(generationId, out var run))
        {
            run.Cancellation.Cancel();
            return true;
        }

        return false;
    }

    public Dictionary<string, object?> Snapshot() => new()
    {
        ["type"] = "generationSnapshot",
        ["generations"] = Array.Empty<object>(),
        ["recoveredDrafts"] = Array.Empty<object>(),
    };

    private async Task RunAsync(
        string generationId,
        string conversationId,
        string? modelId,
        IReadOnlyList<ChatMessage> history,
        CancellationTokenSource cancellation)
    {
        var ct = cancellation.Token;
        var content = new System.Text.StringBuilder();
        var sequence = 0;
        string? finishReason = null;

        try
        {
            var snapshot = await config.ReadAsync(ct);
            var baseUrl = snapshot.Config.GetValueOrDefault("baseUrl") as string ?? "https://api.deepseek.com";
            var apiKey = (await secrets.ReadAsync(baseUrl, ct))?.Trim();
            if (string.IsNullOrEmpty(apiKey))
            {
                PublishError(conversationId, generationId, "No API key is configured. Add the DeepSeek credential in the settings.");
                return;
            }

            var model = modelId is { Length: > 0 } ? modelId : snapshot.Config.GetValueOrDefault("model") as string ?? "deepseek-flash";
            var temperature = snapshot.Config.GetValueOrDefault("temperature") is double t ? t : 1.0;
            var topP = snapshot.Config.GetValueOrDefault("topP") is double p ? p : 1.0;
            var maxTokens = snapshot.Config.GetValueOrDefault("maxTokens") is double m ? (int)Math.Min(m, 8192) : 8192;

            await foreach (var delta in client.StreamAsync(baseUrl, apiKey, model, history, temperature, topP, maxTokens, ct))
            {
                if (delta.Kind == "finish")
                {
                    finishReason = delta.Content;
                    continue;
                }

                if (delta.Kind == "content")
                {
                    content.Append(delta.Content);
                }

                sequence++;
                hub.Publish(new Dictionary<string, object?>
                {
                    ["type"] = "streamTimelineDelta",
                    ["generationId"] = generationId,
                    ["conversationId"] = conversationId,
                    ["eventId"] = $"{generationId}-{sequence}",
                    ["eventType"] = delta.Kind,
                    ["content"] = delta.Content,
                });
            }

            if (content.Length > 0)
            {
                var conversationHistory = conversations.GetOrAdd(conversationId, _ => []);
                lock (conversationHistory)
                {
                    conversationHistory.Add(new ChatMessage("assistant", content.ToString()));
                }
            }

            hub.Publish(new Dictionary<string, object?>
            {
                ["type"] = "streamDone",
                ["generationId"] = generationId,
                ["conversationId"] = conversationId,
                ["status"] = "completed",
                ["finish_reason"] = finishReason,
            });
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            hub.Publish(new Dictionary<string, object?>
            {
                ["type"] = "streamDone",
                ["generationId"] = generationId,
                ["conversationId"] = conversationId,
                ["status"] = "cancelled",
                ["generationStopReason"] = "user_cancelled",
            });
        }
        catch (Exception exception) when (exception is ModelException or HttpRequestException or TaskCanceledException or JsonException)
        {
            logger.LogWarning(exception, "Generation {GenerationId} failed.", generationId);
            PublishError(conversationId, generationId, exception.Message);
        }
        finally
        {
            runs.TryRemove(generationId, out _);
            cancellation.Dispose();
            PublishActivity(conversationId, generationId, "settled", 0);
        }
    }

    private void PublishError(string conversationId, string generationId, string error)
    {
        hub.Publish(new Dictionary<string, object?>
        {
            ["type"] = "streamError",
            ["generationId"] = generationId,
            ["conversationId"] = conversationId,
            ["error"] = error,
        });
    }

    private void PublishActivity(string conversationId, string? generationId, string status, int queued) =>
        hub.Publish(new Dictionary<string, object?>
        {
            ["type"] = "generationActivityChanged",
            ["conversationId"] = conversationId,
            ["generationId"] = generationId,
            ["status"] = status,
            ["queuedMessages"] = queued,
        });

    private static string? ReadString(JsonElement message, string name) =>
        message.ValueKind == JsonValueKind.Object &&
        message.TryGetProperty(name, out var value) &&
        value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
}
