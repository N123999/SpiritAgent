using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace Spirit.WinUia;

internal static class StdioJson
{
    private static readonly UTF8Encoding Utf8NoBom = new(encoderShouldEmitUTF8Identifier: false);

    public static JsonSerializerOptions SerializerOptions { get; } = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public static StreamReader OpenInput() =>
        new(Console.OpenStandardInput(), Utf8NoBom, detectEncodingFromByteOrderMarks: false, bufferSize: 4096, leaveOpen: true);

    public static StreamWriter OpenOutput() =>
        new(Console.OpenStandardOutput(), Utf8NoBom, bufferSize: 4096, leaveOpen: true) { AutoFlush = true };

    public static void WriteLine(StreamWriter output, object response)
    {
        output.WriteLine(JsonSerializer.Serialize(response, SerializerOptions));
    }
}
