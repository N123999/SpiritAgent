using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Automation;

namespace Spirit.WinUia;

internal static class CefHostDetector
{
    private const string ChromeLegacyWindowName = "Chrome Legacy Window";

    private static readonly string[] CefClassNames =
    [
        "Chrome_RenderWidgetHostHWND",
        "Chrome_WidgetWin_1",
        "Chrome_WidgetWin_0",
        "CefBrowserWindow",
    ];

    public static string DetectHostKind(AutomationElement window, int hwnd)
    {
        if (ContainsChromeLegacyWindow(window))
        {
            return "cef";
        }

        if (ContainsCefClassName(window))
        {
            return "cef";
        }

        if (ContainsCefClassNameViaWin32(hwnd))
        {
            return "cef";
        }

        return "native";
    }

    private static bool ContainsChromeLegacyWindow(AutomationElement root)
    {
        var walker = TreeWalker.ControlViewWalker;
        return WalkForMatch(root, walker, static element =>
        {
            var name = element.Current.Name ?? string.Empty;
            return string.Equals(name, ChromeLegacyWindowName, StringComparison.Ordinal);
        });
    }

    private static bool ContainsCefClassName(AutomationElement root)
    {
        var walker = TreeWalker.ControlViewWalker;
        return WalkForMatch(root, walker, static element =>
        {
            var className = element.Current.ClassName ?? string.Empty;
            return CefClassNames.Any(candidate =>
                string.Equals(className, candidate, StringComparison.OrdinalIgnoreCase));
        });
    }

    private static bool WalkForMatch(
        AutomationElement element,
        TreeWalker walker,
        Func<AutomationElement, bool> predicate)
    {
        try
        {
            if (predicate(element))
            {
                return true;
            }
        }
        catch (ElementNotAvailableException)
        {
            return false;
        }

        AutomationElement? child;
        try
        {
            child = walker.GetFirstChild(element);
        }
        catch (ElementNotAvailableException)
        {
            return false;
        }

        while (child != null)
        {
            if (WalkForMatch(child, walker, predicate))
            {
                return true;
            }

            try
            {
                child = walker.GetNextSibling(child);
            }
            catch (ElementNotAvailableException)
            {
                break;
            }
        }

        return false;
    }

    private static bool ContainsCefClassNameViaWin32(int hwnd)
    {
        // CEF 主窗口常为自定义壳（如 OrpheusBrowserHost），Chrome 类名在深层子 HWND；
        // UIA Control View 又可能只剩顶层 Window，故须递归枚举 Win32 子树。
        return WalkWin32ChildrenForCefClass(new IntPtr(hwnd));
    }

    private static bool WalkWin32ChildrenForCefClass(IntPtr hwnd)
    {
        var found = false;
        EnumChildWindows(hwnd, (childHwnd, _) =>
        {
            var className = ReadClassName(childHwnd);
            if (CefClassNames.Any(candidate =>
                    string.Equals(className, candidate, StringComparison.OrdinalIgnoreCase)))
            {
                found = true;
                return false;
            }

            if (WalkWin32ChildrenForCefClass(childHwnd))
            {
                found = true;
                return false;
            }

            return true;
        }, IntPtr.Zero);
        return found;
    }

    private static string ReadClassName(IntPtr hwnd)
    {
        var buffer = new StringBuilder(256);
        _ = GetClassName(hwnd, buffer, buffer.Capacity);
        return buffer.ToString();
    }

    private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumChildWindows(IntPtr hWndParent, EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
}
