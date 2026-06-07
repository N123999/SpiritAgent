using System.Windows.Automation;

namespace Spirit.WinUia;

internal static class ElementResolver
{
    public static bool TryResolve(RefRegistry registry, string refId, out AutomationElement element, out string? errorCode, out string? errorMessage)
    {
        element = null!;
        errorCode = null;
        errorMessage = null;

        if (!registry.TryResolve(refId, out var binding))
        {
            errorCode = "ref_not_found";
            errorMessage = $"Unknown ref: {refId}";
            return false;
        }

        var window = AutomationElement.FromHandle(binding.WindowHwnd);
        if (window == null)
        {
            errorCode = "window_not_found";
            errorMessage = "Target window is no longer available.";
            return false;
        }

        if (binding.RuntimeId.Length == 0)
        {
            errorCode = "runtime_id_missing";
            errorMessage = "Element runtime id is unavailable.";
            return false;
        }

        var condition = new PropertyCondition(AutomationElement.RuntimeIdProperty, binding.RuntimeId);
        element = window.FindFirst(TreeScope.Descendants, condition);
        if (element == null)
        {
            errorCode = "element_not_found";
            errorMessage = "Element is no longer in the UI tree.";
            return false;
        }

        return true;
    }
}
