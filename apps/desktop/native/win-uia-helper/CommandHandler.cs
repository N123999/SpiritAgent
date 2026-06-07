using System.Text.Json;

namespace Spirit.WinUia;

internal sealed class CommandHandler
{
    public object Handle(string cmd, JsonElement root)
    {
        return cmd switch
        {
            "ping" => JsonProtocol.Ok(new { pong = true }),
            "list_windows" => HandleListWindows(),
            "shutdown" => JsonProtocol.Ok(),
            _ => JsonProtocol.Error("unknown_cmd", $"Unknown cmd: {cmd}"),
        };
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
}
