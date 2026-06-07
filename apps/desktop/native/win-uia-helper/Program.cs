using System.Runtime.Versioning;
using System.Text.Json;

[assembly: SupportedOSPlatform("windows")]

namespace Spirit.WinUia;

internal static class Program
{
    [STAThread]
    private static int Main()
    {
        var handler = new CommandHandler();
        using var input = StdioJson.OpenInput();
        using var output = StdioJson.OpenOutput();

        try
        {
            string? line;
            while ((line = input.ReadLine()) != null)
            {
                if (string.IsNullOrWhiteSpace(line))
                {
                    continue;
                }

                JsonDocument doc;
                try
                {
                    doc = JsonDocument.Parse(line);
                }
                catch (JsonException ex)
                {
                    StdioJson.WriteLine(output, JsonProtocol.Error("invalid_json", ex.Message));
                    continue;
                }

                using (doc)
                {
                    if (!doc.RootElement.TryGetProperty("cmd", out var cmdProp) || cmdProp.ValueKind != JsonValueKind.String)
                    {
                        StdioJson.WriteLine(output, JsonProtocol.Error("invalid_request", "Missing cmd field."));
                        continue;
                    }

                    var cmd = cmdProp.GetString() ?? string.Empty;
                    object response;
                    try
                    {
                        response = handler.Handle(cmd, doc.RootElement);
                    }
                    catch (Exception ex)
                    {
                        response = JsonProtocol.Error("internal_error", ex.Message);
                    }

                    StdioJson.WriteLine(output, response);

                    if (cmd == "shutdown")
                    {
                        return 0;
                    }
                }
            }
        }
        catch (Exception ex)
        {
            try
            {
                StdioJson.WriteLine(output, JsonProtocol.Error("fatal", ex.Message));
            }
            catch
            {
                // ignore
            }

            return 1;
        }

        return 0;
    }
}
