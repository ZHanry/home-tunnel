using System.Text.RegularExpressions;

namespace HomeTunnel.Client.Services;

public sealed class SemanticVersion : IComparable<SemanticVersion>, IEquatable<SemanticVersion>
{
    private static readonly Regex Pattern = new(
        @"^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-(?<pre>(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+(?<build>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private readonly string[] _preRelease;

    private SemanticVersion(ulong major, ulong minor, ulong patch, string[] preRelease)
    {
        Major = major;
        Minor = minor;
        Patch = patch;
        _preRelease = preRelease;
    }

    public ulong Major { get; }
    public ulong Minor { get; }
    public ulong Patch { get; }
    public bool IsPreRelease => _preRelease.Length > 0;

    public static SemanticVersion Parse(string value)
    {
        if (!TryParse(value, out var version))
            throw new FormatException($"无效的语义版本号：{value}");
        return version;
    }

    public static bool TryParse(string? value, out SemanticVersion version)
    {
        version = null!;
        if (string.IsNullOrWhiteSpace(value)) return false;
        var match = Pattern.Match(value);
        if (!match.Success ||
            !ulong.TryParse(match.Groups["major"].Value, out var major) ||
            !ulong.TryParse(match.Groups["minor"].Value, out var minor) ||
            !ulong.TryParse(match.Groups["patch"].Value, out var patch))
            return false;

        var preRelease = match.Groups["pre"].Success
            ? match.Groups["pre"].Value.Split('.')
            : [];
        version = new SemanticVersion(major, minor, patch, preRelease);
        return true;
    }

    public static int Compare(string left, string right) => Parse(left).CompareTo(Parse(right));

    public int CompareTo(SemanticVersion? other)
    {
        if (other is null) return 1;
        var core = Major.CompareTo(other.Major);
        if (core != 0) return core;
        core = Minor.CompareTo(other.Minor);
        if (core != 0) return core;
        core = Patch.CompareTo(other.Patch);
        if (core != 0) return core;

        if (_preRelease.Length == 0 && other._preRelease.Length == 0) return 0;
        if (_preRelease.Length == 0) return 1;
        if (other._preRelease.Length == 0) return -1;

        for (var index = 0; index < Math.Min(_preRelease.Length, other._preRelease.Length); index++)
        {
            var comparison = CompareIdentifier(_preRelease[index], other._preRelease[index]);
            if (comparison != 0) return comparison;
        }
        return _preRelease.Length.CompareTo(other._preRelease.Length);
    }

    public bool Equals(SemanticVersion? other) => other is not null && CompareTo(other) == 0;

    public override bool Equals(object? obj) => obj is SemanticVersion other && Equals(other);

    public override int GetHashCode()
    {
        var hash = new HashCode();
        hash.Add(Major);
        hash.Add(Minor);
        hash.Add(Patch);
        foreach (var identifier in _preRelease)
            hash.Add(identifier, StringComparer.Ordinal);
        return hash.ToHashCode();
    }

    public static bool operator ==(SemanticVersion? left, SemanticVersion? right) => Equals(left, right);

    public static bool operator !=(SemanticVersion? left, SemanticVersion? right) => !Equals(left, right);

    public static bool operator <(SemanticVersion left, SemanticVersion right) => left.CompareTo(right) < 0;

    public static bool operator <=(SemanticVersion left, SemanticVersion right) => left.CompareTo(right) <= 0;

    public static bool operator >(SemanticVersion left, SemanticVersion right) => left.CompareTo(right) > 0;

    public static bool operator >=(SemanticVersion left, SemanticVersion right) => left.CompareTo(right) >= 0;

    private static int CompareIdentifier(string left, string right)
    {
        var leftNumeric = left.All(char.IsDigit);
        var rightNumeric = right.All(char.IsDigit);
        if (leftNumeric && rightNumeric)
        {
            var length = left.Length.CompareTo(right.Length);
            return length != 0 ? length : string.CompareOrdinal(left, right);
        }
        if (leftNumeric) return -1;
        if (rightNumeric) return 1;
        return string.CompareOrdinal(left, right);
    }
}
