using System.Windows.Automation;

namespace Spirit.WinUia;

internal static class UiSnapshot
{
    public sealed record SnapshotRequest(
        string? ProcessName,
        string? WindowTitle,
        string? Surface,
        int MaxDepth,
        int MaxNodes);

    public sealed record TreeNode(
        string Ref,
        string Role,
        string Name,
        string AutomationId,
        IReadOnlyList<string> Patterns,
        bool IsEnabled,
        bool IsOffscreen,
        IReadOnlyList<TreeNode>? Children);

    public static object Capture(SnapshotRequest request, RefRegistry registry)
    {
        if (!WindowResolver.TryResolveWindow(
                request.ProcessName,
                request.WindowTitle,
                request.Surface,
                out var window,
                out var resolveError))
        {
            return JsonProtocol.Error(resolveError ?? "window_not_found", "Target window could not be resolved.");
        }

        var hwnd = window.Current.NativeWindowHandle;
        var hostKind = CefHostDetector.DetectHostKind(window, hwnd);
        var walker = TreeWalker.ControlViewWalker;
        var nodeBudget = new NodeBudget(request.MaxNodes);
        var tree = BuildNode(window, hwnd, walker, registry, depth: 0, request.MaxDepth, nodeBudget, isRoot: true);
        var coverage = nodeBudget.Truncated ? "partial" : "full";
        var resolvedTitle = window.Current.Name ?? string.Empty;
        if (string.IsNullOrWhiteSpace(resolvedTitle) && !string.IsNullOrWhiteSpace(request.Surface))
        {
            resolvedTitle = ShellSurfaceCatalog.DisplayTitleFor(request.Surface) ?? string.Empty;
        }

        var processName = WindowEnumerator.ResolveProcessName(hwnd);
        object windowPayload = string.IsNullOrWhiteSpace(request.Surface)
            ? new
            {
                hwnd,
                title = resolvedTitle,
                process_name = processName,
            }
            : new
            {
                hwnd,
                title = resolvedTitle,
                process_name = processName,
                surface = request.Surface.Trim().ToLowerInvariant(),
            };

        return JsonProtocol.Ok(new
        {
            host_kind = hostKind,
            window = windowPayload,
            coverage,
            tree,
            nodes_returned = nodeBudget.Count,
            max_nodes = request.MaxNodes,
        });
    }

    private static TreeNode? BuildNode(
        AutomationElement element,
        int windowHwnd,
        TreeWalker walker,
        RefRegistry registry,
        int depth,
        int maxDepth,
        NodeBudget budget,
        bool isRoot)
    {
        if (!budget.TryConsume())
        {
            return null;
        }

        int[] runtimeId;
        try
        {
            runtimeId = element.GetRuntimeId() ?? Array.Empty<int>();
        }
        catch (ElementNotAvailableException)
        {
            return null;
        }

        var current = element.Current;
        var role = UiPatterns.RoleName(current.ControlType);
        var name = current.Name ?? string.Empty;
        var automationId = current.AutomationId ?? string.Empty;
        var patterns = UiPatterns.ListSupported(element);
        var binding = new AutomationElementBinding(
            role,
            name,
            automationId,
            patterns,
            current.IsEnabled,
            current.IsOffscreen);
        var refId = registry.Register(windowHwnd, runtimeId, binding);

        IReadOnlyList<TreeNode>? children = null;
        if (depth < maxDepth)
        {
            var childNodes = new List<TreeNode>();
            AutomationElement? child;
            try
            {
                child = walker.GetFirstChild(element);
            }
            catch (ElementNotAvailableException)
            {
                child = null;
            }

            while (child != null && budget.Remaining > 0)
            {
                var built = BuildNode(child, windowHwnd, walker, registry, depth + 1, maxDepth, budget, isRoot: false);
                if (built != null)
                {
                    childNodes.Add(built);
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

            if (childNodes.Count > 0)
            {
                children = childNodes;
            }
        }

        return new TreeNode(
            refId,
            role,
            name,
            automationId,
            patterns,
            binding.IsEnabled,
            binding.IsOffscreen,
            children);
    }

    private sealed class NodeBudget(int maxNodes)
    {
        public int Count { get; private set; }
        public bool Truncated { get; private set; }
        public int Remaining => Math.Max(0, maxNodes - Count);

        public bool TryConsume()
        {
            if (Count >= maxNodes)
            {
                Truncated = true;
                return false;
            }

            Count++;
            return true;
        }
    }
}
