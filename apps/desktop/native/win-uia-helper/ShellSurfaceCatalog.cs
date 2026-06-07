using System.Runtime.InteropServices;
using System.Windows.Automation;

namespace Spirit.WinUia;

internal static class ShellSurfaceCatalog
{
    internal readonly record struct ShellSurfaceDef(string Id, string DisplayTitle, string Win32ClassName);

    private static readonly ShellSurfaceDef[] Surfaces =
    [
        new("taskbar", "Taskbar", "Shell_TrayWnd"),
        new("secondary_taskbar", "Secondary taskbar", "Shell_SecondaryTrayWnd"),
    ];

    public static IReadOnlyList<WindowInfo> ListAvailableSurfaces()
    {
        var results = new List<WindowInfo>(Surfaces.Length);
        foreach (var def in Surfaces)
        {
            var hwnd = FindSurfaceHwnd(def.Win32ClassName);
            if (hwnd == 0)
            {
                continue;
            }

            AutomationElement? element;
            try
            {
                element = AutomationElement.FromHandle(hwnd);
            }
            catch
            {
                continue;
            }

            if (element == null)
            {
                continue;
            }

            bool isEnabled;
            try
            {
                isEnabled = element.Current.IsEnabled;
            }
            catch (ElementNotAvailableException)
            {
                isEnabled = true;
            }

            results.Add(new WindowInfo(
                Hwnd: hwnd,
                Title: def.DisplayTitle,
                ProcessName: WindowEnumerator.ResolveProcessName(hwnd),
                IsEnabled: isEnabled,
                Surface: def.Id,
                ClassName: def.Win32ClassName));
        }

        return results;
    }

    public static string? DisplayTitleFor(string? surfaceId)
    {
        if (string.IsNullOrWhiteSpace(surfaceId))
        {
            return null;
        }

        var normalized = surfaceId.Trim().ToLowerInvariant();
        foreach (var def in Surfaces)
        {
            if (string.Equals(def.Id, normalized, StringComparison.Ordinal))
            {
                return def.DisplayTitle;
            }
        }

        return null;
    }

    public static bool TryResolveBySurfaceId(string? surfaceId, out AutomationElement window, out string? error)
    {
        window = null!;
        error = null;

        if (string.IsNullOrWhiteSpace(surfaceId))
        {
            error = "surface is required.";
            return false;
        }

        var normalized = surfaceId.Trim().ToLowerInvariant();
        ShellSurfaceDef? match = null;
        foreach (var def in Surfaces)
        {
            if (string.Equals(def.Id, normalized, StringComparison.Ordinal))
            {
                match = def;
                break;
            }
        }

        if (match == null)
        {
            error = "unknown_surface";
            return false;
        }

        var hwnd = FindSurfaceHwnd(match.Value.Win32ClassName);
        if (hwnd == 0)
        {
            error = "surface_not_found";
            return false;
        }

        window = AutomationElement.FromHandle(hwnd);
        if (window == null)
        {
            error = "surface_not_found";
            return false;
        }

        return true;
    }

    private static int FindSurfaceHwnd(string className)
    {
        var hwnd = FindWindow(className, null);
        return hwnd == IntPtr.Zero ? 0 : hwnd.ToInt32();
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr FindWindow(string? lpClassName, string? lpWindowName);
}
