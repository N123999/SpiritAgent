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
        var options = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

        try
        {
            string? line;
            while ((line = Console.In.ReadLine()) != null)
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
                    WriteResponse(options, JsonProtocol.Error("invalid_json", ex.Message));
                    continue;
                }

                using (doc)
                {
                    if (!doc.RootElement.TryGetProperty("cmd", out var cmdProp) || cmdProp.ValueKind != JsonValueKind.String)
                    {
                        WriteResponse(options, JsonProtocol.Error("invalid_request", "Missing cmd field."));
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

                    WriteResponse(options, response);

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
                WriteResponse(options, JsonProtocol.Error("fatal", ex.Message));
            }
            catch
            {
                // ignore
            }

            return 1;
        }

        return 0;
    }

    private static void WriteResponse(JsonSerializerOptions options, object response)
    {
        Console.Out.WriteLine(JsonSerializer.Serialize(response, options));
        Console.Out.Flush();
    }
}
