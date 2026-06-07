using System.Windows.Automation;

namespace Spirit.WinUia;

internal static class WindowResolver
{
    public static bool TryResolveWindow(
        string? processName,
        string? windowTitle,
        string? surface,
        out AutomationElement window,
        out string? error)
    {
        window = null!;
        error = null;

        if (!string.IsNullOrWhiteSpace(surface))
        {
            return ShellSurfaceCatalog.TryResolveBySurfaceId(surface, out window, out error);
        }

        if (string.IsNullOrWhiteSpace(processName) && string.IsNullOrWhiteSpace(windowTitle))
        {
            error = "process_name, window_title, or surface is required.";
            return false;
        }

        var candidates = WindowEnumerator.ListTopLevelWindows();
        var normalizedProcess = NormalizeProcessName(processName);
        var matches = candidates.Where(candidate =>
        {
            var processOk = normalizedProcess == null
                || string.Equals(
                    NormalizeProcessName(candidate.ProcessName),
                    normalizedProcess,
                    StringComparison.OrdinalIgnoreCase);
            var titleOk = string.IsNullOrWhiteSpace(windowTitle)
                || candidate.Title.Contains(windowTitle, StringComparison.OrdinalIgnoreCase);
            return processOk && titleOk;
        }).ToList();

        if (matches.Count == 0)
        {
            error = "window_not_found";
            return false;
        }

        if (matches.Count > 1)
        {
            error = "window_ambiguous";
            return false;
        }

        var hwnd = matches[0].Hwnd;
        window = AutomationElement.FromHandle(hwnd);
        if (window == null)
        {
            error = "window_not_found";
            return false;
        }

        return true;
    }

    private static string? NormalizeProcessName(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var trimmed = value.Trim();
        return trimmed.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)
            ? trimmed
            : trimmed + ".exe";
    }
}
