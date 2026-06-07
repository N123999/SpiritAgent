namespace Spirit.WinUia;

internal static class JsonProtocol
{
    public static object Ok(object? data = null)
    {
        if (data is null)
        {
            return new { ok = true };
        }

        return new { ok = true, data };
    }

    public static object Error(string code, string message)
    {
        return new
        {
            ok = false,
            error = new { code, message },
        };
    }
}
