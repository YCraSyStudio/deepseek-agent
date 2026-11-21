using System.Text.Json;
using System.Text.Json.Nodes;

namespace YCraSy.Agent.Runtime.Configuration;

public sealed record SaveOutcome(bool Success, int Revision, IReadOnlyDictionary<string, object?> Config, IReadOnlyList<string> Errors);

public sealed class SettingsStore(ILogger<SettingsStore> logger)
{
    private static readonly Dictionary<string, object?> Defaults = new(StringComparer.Ordinal)
    {
        ["interfaceLanguage"] = "auto",
        ["baseUrl"] = "https://api.deepseek.com",
        ["model"] = "deepseek-flash",
        ["thinkingMode"] = true,
        ["reasoningEffort"] = "high",
        ["temperature"] = 1.0,
        ["topP"] = 1.0,
        ["maxTokens"] = 384000,
        ["maxConcurrentGenerations"] = 8,
        ["permissionMode"] = "default",
        ["historyEnabled"] = true,
        ["historyRetentionDays"] = 30,
        ["snapshotStorageLimitMb"] = 1024,
        ["includeHomeAgents"] = false,
        ["usageBreakdown"] = false,
        ["usageCostCurrency"] = "USD",
        ["capturePermission"] = "ask",
        ["webSearchEnabled"] = true,
        ["webSearchRegion"] = "global",
        ["privacyMinimizeData"] = true,
        ["betaFeaturesEnabled"] = false,
        ["strictToolCallsEnabled"] = false,
        ["editorSuggestionsEnabled"] = true,
        ["chatSuggestionsEnabled"] = true,
    };

    private readonly SemaphoreSlim gate = new(1, 1);
    private Dictionary<string, object?>? loaded;
    private int revision = 1;

    public async Task<(IReadOnlyDictionary<string, object?> Config, int Revision)> ReadAsync(CancellationToken ct)
    {
        await gate.WaitAsync(ct);
        try
        {
            await EnsureLoadedAsync(ct);
            return (new Dictionary<string, object?>(loaded!, StringComparer.Ordinal), revision);
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<SaveOutcome> SaveAsync(JsonElement partial, CancellationToken ct)
    {
        await gate.WaitAsync(ct);
        try
        {
            await EnsureLoadedAsync(ct);
            var errors = new List<string>();
            var next = new Dictionary<string, object?>(loaded!, StringComparer.Ordinal);

            if (partial.ValueKind != JsonValueKind.Object)
            {
                return new SaveOutcome(false, revision, next, ["The config payload must be an object."]);
            }

            foreach (var property in partial.EnumerateObject())
            {
                if (property.NameEquals("apiKey") || string.Equals(property.Name, "apiKey", StringComparison.Ordinal))
                {
                    continue;
                }

                if (!Defaults.ContainsKey(property.Name))
                {
                    errors.Add($"Unknown config key '{property.Name}'.");
                    continue;
                }

                if (TryNormalize(property.Name, property.Value, out var normalized, out var error))
                {
                    next[property.Name] = normalized;
                }
                else
                {
                    errors.Add(error!);
                }
            }

            if (errors.Count > 0)
            {
                return new SaveOutcome(false, revision, new Dictionary<string, object?>(loaded!, StringComparer.Ordinal), errors);
            }

            loaded = next;
            revision++;
            await PersistAsync(ct);
            return new SaveOutcome(true, revision, new Dictionary<string, object?>(next, StringComparer.Ordinal), []);
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<SaveOutcome> ResetAsync(CancellationToken ct)
    {
        await gate.WaitAsync(ct);
        try
        {
            await EnsureLoadedAsync(ct);
            loaded = new Dictionary<string, object?>(Defaults, StringComparer.Ordinal);
            revision++;
            await PersistAsync(ct);
            return new SaveOutcome(true, revision, new Dictionary<string, object?>(loaded, StringComparer.Ordinal), []);
        }
        finally
        {
            gate.Release();
        }
    }

    private async Task EnsureLoadedAsync(CancellationToken ct)
    {
        if (loaded is not null)
        {
            return;
        }

        loaded = new Dictionary<string, object?>(Defaults, StringComparer.Ordinal);
        revision = 1;

        if (!File.Exists(AgentPaths.SettingsFile))
        {
            return;
        }

        try
        {
            await using var stream = File.OpenRead(AgentPaths.SettingsFile);
            var document = await JsonNode.ParseAsync(stream, cancellationToken: ct);
            if (document is not JsonObject root)
            {
                logger.LogWarning("Ignoring settings file: the root is not a JSON object.");
                return;
            }

            if (root["revision"] is JsonValue revisionValue && revisionValue.TryGetValue<int>(out var storedRevision) && storedRevision > 0)
            {
                revision = storedRevision;
            }

            if (root["config"] is not JsonObject config)
            {
                return;
            }

            foreach (var property in config)
            {
                if (!Defaults.ContainsKey(property.Key) || property.Value is not { } value)
                {
                    continue;
                }

                using var element = JsonDocument.Parse(value.ToJsonString());
                if (TryNormalize(property.Key, element.RootElement, out var normalized, out var error))
                {
                    loaded[property.Key] = normalized;
                }
                else
                {
                    logger.LogWarning("Ignoring stored config key '{Key}': {Error}", property.Key, error);
                }
            }
        }
        catch (Exception exception) when (exception is JsonException or IOException)
        {
            logger.LogWarning(exception, "The settings file could not be read; defaults are in use.");
            loaded = new Dictionary<string, object?>(Defaults, StringComparer.Ordinal);
        }
    }

    private async Task PersistAsync(CancellationToken ct)
    {
        AgentPaths.EnsureHome();
        var document = new JsonObject
        {
            ["revision"] = revision,
            ["config"] = JsonSerializer.SerializeToNode(loaded, JsonOptions),
        };

        var temporary = AgentPaths.SettingsFile + ".tmp";
        await File.WriteAllTextAsync(temporary, document.ToJsonString(JsonOptions), ct);
        AgentPaths.Restrict(temporary);
        File.Move(temporary, AgentPaths.SettingsFile, overwrite: true);
        AgentPaths.Restrict(AgentPaths.SettingsFile);
    }

    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    private static bool TryNormalize(string key, JsonElement value, out object? normalized, out string? error)
    {
        normalized = null;
        error = null;

        if (value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            error = $"'{key}' cannot be null.";
            return false;
        }

        switch (key)
        {
            case "interfaceLanguage":
                return OneOf(key, value, out normalized, out error, "auto", "en", "es", "zh");
            case "reasoningEffort":
                return OneOf(key, value, out normalized, out error, "low", "high", "max");
            case "permissionMode":
                return OneOf(key, value, out normalized, out error, "default", "auto-approve", "full-access");
            case "capturePermission":
                return OneOf(key, value, out normalized, out error, "ask", "first-use", "always");
            case "baseUrl":
                return Url(key, value, out normalized, out error);
            case "model":
                return Text(key, value, 1, 120, out normalized, out error);
            case "webSearchRegion":
                return Text(key, value, 1, 32, out normalized, out error);
            case "usageCostCurrency":
                return Text(key, value, 3, 3, out normalized, out error);
            case "userId":
                return Text(key, value, 1, 128, out normalized, out error);
            case "temperature":
                return Number(key, value, 0, 2, out normalized, out error);
            case "topP":
                return Number(key, value, 0, 1, out normalized, out error);
            case "maxTokens":
                return Number(key, value, 1, 1_000_000, out normalized, out error);
            case "maxConcurrentGenerations":
                return Number(key, value, 1, 16, out normalized, out error);
            case "historyRetentionDays":
                return Number(key, value, 0, 3_650, out normalized, out error);
            case "snapshotStorageLimitMb":
                return Number(key, value, 0, 102_400, out normalized, out error);
            default:
                return Boolean(key, value, out normalized, out error);
        }
    }

    private static bool OneOf(string key, JsonElement value, out object? normalized, out string? error, params string[] allowed)
    {
        normalized = null;
        error = null;
        if (value.ValueKind != JsonValueKind.String || value.GetString() is not { } text || !allowed.Contains(text, StringComparer.Ordinal))
        {
            error = $"'{key}' must be one of {string.Join(", ", allowed)}.";
            return false;
        }

        normalized = text;
        return true;
    }

    private static bool Text(string key, JsonElement value, int minimum, int maximum, out object? normalized, out string? error)
    {
        normalized = null;
        error = null;
        if (value.ValueKind != JsonValueKind.String || value.GetString() is not { } text)
        {
            error = $"'{key}' must be a string.";
            return false;
        }

        text = text.Trim();
        if (text.Length < minimum || text.Length > maximum)
        {
            error = $"'{key}' must be between {minimum} and {maximum} characters.";
            return false;
        }

        normalized = text;
        return true;
    }

    private static bool Url(string key, JsonElement value, out object? normalized, out string? error)
    {
        normalized = null;
        error = null;
        if (!Text(key, value, 8, 300, out var text, out error))
        {
            return false;
        }

        var candidate = (string)text!;
        if (!Uri.TryCreate(candidate, UriKind.Absolute, out var uri) || (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp))
        {
            error = $"'{key}' must be an absolute http or https URL.";
            return false;
        }

        normalized = candidate.TrimEnd('/');
        return true;
    }

    private static bool Number(string key, JsonElement value, double minimum, double maximum, out object? normalized, out string? error)
    {
        normalized = null;
        error = null;
        if (value.ValueKind != JsonValueKind.Number || !value.TryGetDouble(out var number) || number < minimum || number > maximum)
        {
            error = $"'{key}' must be a number between {minimum} and {maximum}.";
            return false;
        }

        normalized = number;
        return true;
    }

    private static bool Boolean(string key, JsonElement value, out object? normalized, out string? error)
    {
        normalized = null;
        error = null;
        if (value.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
        {
            error = $"'{key}' must be a boolean.";
            return false;
        }

        normalized = value.GetBoolean();
        return true;
    }
}
