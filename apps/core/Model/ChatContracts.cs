namespace YCraSy.Agent.Runtime.Model;

public sealed record ChatMessage(string Role, string Content);

public sealed record ChatDelta(string Kind, string Content);

public sealed record ChatCompletion(string Content, string? Reasoning, string? FinishReason);

public interface IModelClient
{
    IAsyncEnumerable<ChatDelta> StreamAsync(
        string baseUrl,
        string apiKey,
        string model,
        IReadOnlyList<ChatMessage> messages,
        double temperature,
        double topP,
        int maxTokens,
        CancellationToken ct);
}
