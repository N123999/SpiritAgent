using System.Windows.Automation;

namespace Spirit.WinUia;

internal static class UiPatterns
{
    private static readonly (AutomationPattern Pattern, string Name)[] KnownPatterns =
    [
        (InvokePattern.Pattern, "invoke"),
        (ValuePattern.Pattern, "set_value"),
        (TogglePattern.Pattern, "toggle"),
        (ExpandCollapsePattern.Pattern, "expand_collapse"),
        (SelectionItemPattern.Pattern, "select"),
    ];

    public static IReadOnlyList<string> ListSupported(AutomationElement element)
    {
        var patterns = new List<string>();
        foreach (var (pattern, name) in KnownPatterns)
        {
            try
            {
                if (element.TryGetCurrentPattern(pattern, out _))
                {
                    patterns.Add(name);
                }
            }
            catch (ElementNotAvailableException)
            {
                // Element disappeared while inspecting patterns.
            }
        }

        return patterns;
    }

    public static string RoleName(ControlType controlType)
    {
        var programmatic = controlType.ProgrammaticName ?? string.Empty;
        const string prefix = "ControlType.";
        return programmatic.StartsWith(prefix, StringComparison.Ordinal)
            ? programmatic[prefix.Length..]
            : programmatic;
    }
}
