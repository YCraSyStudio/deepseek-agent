using System.Net.Http.Headers;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;

namespace YCraSy.Agent.Runtime.Model;

public sealed class DeepSeekClient(HttpClient http) : IModelClient
{
    private static readonly TimeSpan IdleTimeout = TimeSpan.FromSeconds(120);

    public async IAsyncEnumerable<ChatDelta> StreamAsync(
        string baseUrl,
        string apiKey,
        string model,
        IReadOnlyList<ChatMessage> messages,
        double temperature,
        double topP,
        int maxTokens,
        [EnumeratorCancellation] CancellationToken ct)
    {
        var payload = new Dictionary<string, object?>
        {
            ["model"] = model,
            ["stream"] = true,
            ["temperature"] = temperature,
            ["top_p"] = topP,
            ["max_tokens"] = maxTokens,
            ["messages"] = messages.Select(message => new Dictionary<string, object?>
            {
                ["role"] = message.Role,
                ["content"] = message.Content,
            }).ToArray(),
        };

        using var request = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl.TrimEnd('/')}/chat/completions")
        {
            Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json"),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(IdleTimeout);
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);

        if (!response.IsSuccessStatusCode)
        {
            var detail = await response.Content.ReadAsStringAsync(ct);
            throw new ModelException(
                $"The provider answered {(int)response.StatusCode}: {Truncate(detail, 300)}",
                (int)response.StatusCode);
        }

        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var reader = new StreamReader(stream, Encoding.UTF8);

        while (await reader.ReadLineAsync(ct) is { } line)
        {
            if (line.Length == 0 || line.StartsWith(':'))
            {
                continue;
            }

            if (!line.StartsWith("data:", StringComparison.Ordinal))
            {
                continue;
            }

            var data = line[5..].Trim();
            if (data.Length == 0)
            {
                continue;
            }

            if (string.Equals(data, "[DONE]", StringComparison.Ordinal))
            {
                yield break;
            }

            foreach (var delta in ReadDeltas(data))
            {
                yield return delta;
            }
        }
    }

    private static IEnumerable<ChatDelta> ReadDeltas(string data)
    {
        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(data);
        }
        catch (JsonException)
        {
            yield break;
        }

        using (document)
        {
            if (!document.RootElement.TryGetProperty("choices", out var choices) ||
                choices.ValueKind != JsonValueKind.Array ||
                choices.GetArrayLength() == 0)
            {
                yield break;
            }

            var choice = choices[0];
            if (!choice.TryGetProperty("delta", out var delta) || delta.ValueKind != JsonValueKind.Object)
            {
                yield break;
            }

            foreach (var (property, kind) in new[] { ("reasoning_content", "reasoning"), ("content", "content") })
            {
                if (delta.TryGetProperty(property, out var text) &&
                    text.ValueKind == JsonValueKind.String &&
                    text.GetString() is { Length: > 0 } value)
                {
                    yield return new ChatDelta(kind, value);
                }
            }

            if (choice.TryGetProperty("finish_reason", out var finish) && finish.ValueKind == JsonValueKind.String)
            {
                yield return new ChatDelta("finish", finish.GetString()!);
            }
        }
    }

    private static string Truncate(string value, int maximum) =>
        value.Length <= maximum ? value : value[..maximum] + "…";
}

public sealed class ModelException(string message, int? statusCode = null) : Exception(message)
{
    public int? StatusCode { get; } = statusCode;
}
