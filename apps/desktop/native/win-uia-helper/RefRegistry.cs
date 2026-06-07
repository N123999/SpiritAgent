using System.Collections.Concurrent;

namespace Spirit.WinUia;

internal sealed class RefRegistry
{
    private readonly ConcurrentDictionary<string, ElementBinding> _refs = new(StringComparer.Ordinal);
    private int _nextOrdinal = 1;

    public string Register(int windowHwnd, int[] runtimeId, AutomationElementBinding binding)
    {
        var refId = $"w{windowHwnd:x}n{_nextOrdinal++}";
        _refs[refId] = new ElementBinding(windowHwnd, runtimeId, binding);
        return refId;
    }

    public bool TryResolve(string refId, out ElementBinding binding)
    {
        return _refs.TryGetValue(refId, out binding!);
    }
}

internal readonly record struct AutomationElementBinding(
    string Role,
    string Name,
    string AutomationId,
    IReadOnlyList<string> Patterns,
    bool IsEnabled,
    bool IsOffscreen);

internal readonly record struct ElementBinding(int WindowHwnd, int[] RuntimeId, AutomationElementBinding Meta);
