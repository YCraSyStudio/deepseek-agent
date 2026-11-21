using System.Text.Json;

namespace YCraSy.Agent.Runtime.Configuration;

public sealed record ConfigSnapshot(int Revision, IReadOnlyDictionary<string, object?> Config, bool HasKey, string? KeyPreview);

public sealed class ConfigService(SettingsStore settings, SecretStore secrets)
{
    public async Task<ConfigSnapshot> ReadAsync(CancellationToken ct)
    {
        var (config, revision) = await settings.ReadAsync(ct);
        var (hasKey, preview) = await StatusAsync(BaseUrl(config), ct);
        return new ConfigSnapshot(revision, config, hasKey, preview);
    }

    public async Task<(SaveOutcome Outcome, bool CredentialUpdated)> SaveAsync(JsonElement payload, CancellationToken ct)
    {
        var outcome = await settings.SaveAsync(payload, ct);
        var credentialUpdated = false;
        if (outcome.Success && payload.TryGetProperty("apiKey", out var key) &&
            key.ValueKind == JsonValueKind.String && key.GetString() is { Length: > 0 } value)
        {
            await secrets.WriteAsync(BaseUrl(outcome.Config), value.Trim(), ct);
            credentialUpdated = true;
        }
        return (outcome, credentialUpdated);
    }

    public Task<SaveOutcome> ResetAsync(CancellationToken ct) => settings.ResetAsync(ct);

    public async Task<bool> DeleteKeyAsync(CancellationToken ct)
    {
        var snapshot = await settings.ReadAsync(ct);
        secrets.Delete(BaseUrl(snapshot.Config));
        var (hasKey, _) = await KeyStatusAsync(ct);
        return !hasKey;
    }

    public async Task<(bool HasKey, string? KeyPreview)> KeyStatusAsync(CancellationToken ct)
    {
        var snapshot = await settings.ReadAsync(ct);
        return await StatusAsync(BaseUrl(snapshot.Config), ct);
    }

    private static string BaseUrl(IReadOnlyDictionary<string, object?> config) =>
        config.GetValueOrDefault("baseUrl") as string ?? "https://api.deepseek.com";

    private async Task<(bool, string?)> StatusAsync(string baseUrl, CancellationToken ct)
    {
        var stored = await secrets.ReadAsync(baseUrl, ct);
        if (string.IsNullOrWhiteSpace(stored))
        {
            return (false, null);
        }

        var trimmed = stored.Trim();
        var tail = trimmed.Length <= 4 ? string.Empty : trimmed[^4..];
        return (true, $"…{tail}");
    }
}
