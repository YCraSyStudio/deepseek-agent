using System.Text.Json;
using System.Threading.Channels;

namespace YCraSy.Agent.Runtime.Webview;

public sealed record HubEvent(long Id, string Json);

/// <summary>
/// Fan-out de eventos del host hacia las sesiones de la UI, con búfer circular
/// para reproducir lo perdido cuando el cliente reconecta con Last-Event-ID.
/// </summary>
public sealed class WebviewHub
{
    private const int BufferLimit = 200;
    private readonly object gate = new();
    private readonly List<HubEvent> recent = [];
    private readonly List<Subscriber> subscribers = [];
    private long lastId;

    public static JsonSerializerOptions Json { get; } = new(JsonSerializerDefaults.Web);

    public void Publish(object message)
    {
        var json = JsonSerializer.Serialize(message, Json);
        HubEvent hubEvent;
        Subscriber[] targets;
        lock (gate)
        {
            hubEvent = new HubEvent(++lastId, json);
            recent.Add(hubEvent);
            if (recent.Count > BufferLimit)
            {
                recent.RemoveAt(0);
            }

            targets = [.. subscribers];
        }

        foreach (var subscriber in targets)
        {
            subscriber.Queue.Writer.TryWrite(hubEvent);
        }
    }

    public async Task StreamAsync(HttpContext context, CancellationToken cancellationToken)
    {
        var subscriber = new Subscriber();
        HubEvent[] replay;
        lock (gate)
        {
            var lastSeen = LastEventId(context);
            replay = [.. recent.Where(item => item.Id > lastSeen)];
            subscribers.Add(subscriber);
        }

        context.Response.ContentType = "text/event-stream; charset=utf-8";
        context.Response.Headers.CacheControl = "no-store";
        context.Response.Headers["X-Accel-Buffering"] = "no";

        try
        {
            await context.Response.WriteAsync("retry: 1000\n\n", cancellationToken);
            foreach (var item in replay)
            {
                await WriteAsync(context, item, cancellationToken);
            }

            while (!cancellationToken.IsCancellationRequested)
            {
                using var idle = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                idle.CancelAfter(TimeSpan.FromSeconds(15));

                HubEvent item;
                try
                {
                    item = await subscriber.Queue.Reader.ReadAsync(idle.Token);
                }
                catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
                {
                    await context.Response.WriteAsync(": keep-alive\n\n", cancellationToken);
                    await context.Response.Body.FlushAsync(cancellationToken);
                    continue;
                }

                await WriteAsync(context, item, cancellationToken);
            }
        }
        catch (OperationCanceledException)
        {
            // Cliente desconectado.
        }
        finally
        {
            lock (gate)
            {
                subscribers.Remove(subscriber);
            }
        }
    }

    private static long LastEventId(HttpContext context) =>
        long.TryParse(context.Request.Headers["Last-Event-ID"], out var id) ? id : 0;

    private static async Task WriteAsync(HttpContext context, HubEvent item, CancellationToken cancellationToken)
    {
        await context.Response.WriteAsync($"id: {item.Id}\ndata: {item.Json}\n\n", cancellationToken);
        await context.Response.Body.FlushAsync(cancellationToken);
    }

    private sealed class Subscriber
    {
        public Channel<HubEvent> Queue { get; } = Channel.CreateBounded<HubEvent>(
            new BoundedChannelOptions(BufferLimit) { FullMode = BoundedChannelFullMode.DropOldest });
    }
}
