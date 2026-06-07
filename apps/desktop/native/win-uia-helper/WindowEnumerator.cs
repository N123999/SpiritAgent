using System.Diagnostics;
using System.Windows.Automation;

namespace Spirit.WinUia;

internal static class WindowEnumerator
{
    public static IReadOnlyList<WindowInfo> ListTopLevelWindows()
    {
        var root = AutomationElement.RootElement;
        var windowCondition = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Window);
        var windows = root.FindAll(TreeScope.Children, windowCondition);
        var results = new List<WindowInfo>(windows.Count);

        foreach (AutomationElement window in windows)
        {
            try
            {
                var hwnd = window.Current.NativeWindowHandle;
                if (hwnd == 0)
                {
                    continue;
                }

                var title = window.Current.Name ?? string.Empty;
                var processName = ResolveProcessName(hwnd);
                var isEnabled = window.Current.IsEnabled;

                results.Add(new WindowInfo(
                    Hwnd: hwnd,
                    Title: title,
                    ProcessName: processName,
                    IsEnabled: isEnabled));
            }
            catch (ElementNotAvailableException)
            {
                // Window closed while enumerating.
            }
        }

        return results
            .OrderBy(w => w.ProcessName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(w => w.Title, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static string ResolveProcessName(int hwnd)
    {
        try
        {
            _ = NativeMethods.GetWindowThreadProcessId(hwnd, out var processId);
            if (processId == 0)
            {
                return string.Empty;
            }

            using var process = Process.GetProcessById((int)processId);
            return process.ProcessName + ".exe";
        }
        catch
        {
            return string.Empty;
        }
    }
}

internal readonly record struct WindowInfo(int Hwnd, string Title, string ProcessName, bool IsEnabled);

internal static class NativeMethods
{
    [System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true)]
    public static extern uint GetWindowThreadProcessId(int hWnd, out uint processId);
}
