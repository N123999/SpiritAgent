using System.Text.Json;

namespace Spirit.WinUia;

internal sealed class CommandHandler
{
    private readonly RefRegistry _registry = new();

    public object Handle(string cmd, JsonElement root)
    {
        return cmd switch
        {
            "ping" => JsonProtocol.Ok(new { pong = true }),
            "echo_text" => HandleEchoText(root),
            "list_windows" => HandleListWindows(),
            "snapshot" => HandleSnapshot(root),
            "action" => HandleAction(root),
            "shutdown" => JsonProtocol.Ok(),
            _ => JsonProtocol.Error("unknown_cmd", $"Unknown cmd: {cmd}"),
        };
    }

    private static object HandleEchoText(JsonElement root)
    {
        var text = ReadOptionalString(root, "text");
        if (text == null)
        {
            return JsonProtocol.Error("invalid_request", "text is required.");
        }

        return JsonProtocol.Ok(new { text });
    }

    private static object HandleListWindows()
    {
        var windows = WindowEnumerator.ListTopLevelWindows()
            .Select(w => new
            {
                hwnd = w.Hwnd,
                title = w.Title,
                process_name = w.ProcessName,
                is_enabled = w.IsEnabled,
            })
            .ToList();

        return JsonProtocol.Ok(new { windows });
    }

    private object HandleSnapshot(JsonElement root)
    {
        var processName = ReadOptionalString(root, "process_name");
        var windowTitle = ReadOptionalString(root, "window_title");
        var maxDepth = ReadOptionalInt(root, "max_depth", 8, 1, 32);
        var maxNodes = ReadOptionalInt(root, "max_nodes", 400, 1, 5000);

        return UiSnapshot.Capture(
            new UiSnapshot.SnapshotRequest(processName, windowTitle, maxDepth, maxNodes),
            _registry);
    }

    private static string? ReadOptionalString(JsonElement root, string name)
    {
        if (!root.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        var text = value.GetString();
        return string.IsNullOrWhiteSpace(text) ? null : text.Trim();
    }

    private object HandleAction(JsonElement root)
    {
        var refId = ReadOptionalString(root, "ref");
        var action = ReadOptionalString(root, "action");
        if (string.IsNullOrWhiteSpace(refId) || string.IsNullOrWhiteSpace(action))
        {
            return JsonProtocol.Error("invalid_request", "ref and action are required.");
        }

        var text = ReadOptionalString(root, "text");
        var invokeTimeoutMs = ReadOptionalInt(root, "invoke_timeout_ms", 30_000, 1_000, 120_000);
        return UiActions.Execute(_registry, refId, action, text, invokeTimeoutMs);
    }

    private static int ReadOptionalInt(JsonElement root, string name, int defaultValue, int min, int max)
    {
        if (!root.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.Number)
        {
            return defaultValue;
        }

        var parsed = value.GetInt32();
        return Math.Clamp(parsed, min, max);
    }
}
