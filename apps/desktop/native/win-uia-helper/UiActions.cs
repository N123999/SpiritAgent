using System.Windows.Automation;

namespace Spirit.WinUia;

internal static class UiActions
{
    private const int DefaultInvokeTimeoutMs = 30_000;

    public static object Execute(RefRegistry registry, string refId, string action, string? text, int invokeTimeoutMs)
    {
        if (!ElementResolver.TryResolve(registry, refId, out var element, out var errorCode, out var errorMessage))
        {
            return JsonProtocol.Error(errorCode ?? "element_not_found", errorMessage ?? "Element not found.");
        }

        try
        {
            return action switch
            {
                "invoke" => Invoke(element, invokeTimeoutMs),
                "set_value" => SetValue(element, text),
                "toggle" => Toggle(element),
                "expand" => ExpandCollapse(element, expand: true),
                "collapse" => ExpandCollapse(element, expand: false),
                "select" => Select(element),
                _ => JsonProtocol.Error("unknown_action", $"Unknown action: {action}"),
            };
        }
        catch (ElementNotEnabledException ex)
        {
            return JsonProtocol.Error("element_disabled", ex.Message);
        }
        catch (InvalidOperationException ex)
        {
            return PatternUnsupported(element, ex.Message);
        }
    }

    private static object Invoke(AutomationElement element, int timeoutMs)
    {
        if (!element.TryGetCurrentPattern(InvokePattern.Pattern, out var patternObject)
            || patternObject is not InvokePattern invokePattern)
        {
            return PatternUnsupported(element, "InvokePattern is not supported.");
        }

        Exception? invokeError = null;
        var completed = false;
        var thread = new Thread(() =>
        {
            try
            {
                invokePattern.Invoke();
                completed = true;
            }
            catch (Exception ex)
            {
                invokeError = ex;
            }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();

        if (!thread.Join(Math.Max(1, timeoutMs)))
        {
            return JsonProtocol.Error("invoke_timeout", "Invoke did not complete before timeout.");
        }

        if (invokeError != null)
        {
            return JsonProtocol.Error("invoke_failed", invokeError.Message);
        }

        if (!completed)
        {
            return JsonProtocol.Error("invoke_failed", "Invoke did not complete.");
        }

        return JsonProtocol.Ok(new { action = "invoke" });
    }

    private static object SetValue(AutomationElement element, string? text)
    {
        if (text == null)
        {
            return JsonProtocol.Error("invalid_request", "text is required for set_value.");
        }

        if (!element.TryGetCurrentPattern(ValuePattern.Pattern, out var patternObject)
            || patternObject is not ValuePattern valuePattern)
        {
            return PatternUnsupported(element, "ValuePattern is not supported.");
        }

        if (valuePattern.Current.IsReadOnly)
        {
            return JsonProtocol.Error("value_read_only", "Target value is read-only.");
        }

        valuePattern.SetValue(text);
        return JsonProtocol.Ok(new { action = "set_value" });
    }

    private static object Toggle(AutomationElement element)
    {
        if (!element.TryGetCurrentPattern(TogglePattern.Pattern, out var patternObject)
            || patternObject is not TogglePattern togglePattern)
        {
            return PatternUnsupported(element, "TogglePattern is not supported.");
        }

        togglePattern.Toggle();
        return JsonProtocol.Ok(new { action = "toggle", state = togglePattern.Current.ToggleState.ToString() });
    }

    private static object ExpandCollapse(AutomationElement element, bool expand)
    {
        if (!element.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out var patternObject)
            || patternObject is not ExpandCollapsePattern expandPattern)
        {
            return PatternUnsupported(element, "ExpandCollapsePattern is not supported.");
        }

        if (expand)
        {
            expandPattern.Expand();
        }
        else
        {
            expandPattern.Collapse();
        }

        return JsonProtocol.Ok(new
        {
            action = expand ? "expand" : "collapse",
            state = expandPattern.Current.ExpandCollapseState.ToString(),
        });
    }

    private static object Select(AutomationElement element)
    {
        if (!element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out var patternObject)
            || patternObject is not SelectionItemPattern selectionPattern)
        {
            return PatternUnsupported(element, "SelectionItemPattern is not supported.");
        }

        selectionPattern.Select();
        return JsonProtocol.Ok(new { action = "select" });
    }

    private static object PatternUnsupported(AutomationElement element, string message)
    {
        return new
        {
            ok = false,
            error = new
            {
                code = "pattern_unsupported",
                message,
            },
            supported_patterns = UiPatterns.ListSupported(element),
        };
    }
}
