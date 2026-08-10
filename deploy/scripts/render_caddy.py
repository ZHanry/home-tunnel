#!/usr/bin/env python3
"""Render the Home Tunnel blocks into an existing Caddyfile without replacing it."""

from __future__ import annotations

import argparse
from pathlib import Path

GLOBAL_MARKER = "# BEGIN HOME TUNNEL ON-DEMAND TLS v1.2"
SITE_MARKER = "# BEGIN HOME TUNNEL v1.2"


def brace_delta(line: str) -> int:
    in_quote = False
    escaped = False
    delta = 0
    for character in line:
        if escaped:
            escaped = False
            continue
        if character == "\\" and in_quote:
            escaped = True
            continue
        if character == '"':
            in_quote = not in_quote
            continue
        if character == "#" and not in_quote:
            break
        if not in_quote:
            delta += character == "{"
            delta -= character == "}"
    return delta


def render(source: str, global_snippet: str, site_snippet: str) -> str:
    has_global = GLOBAL_MARKER in source
    has_site = SITE_MARKER in source
    if has_global != has_site:
        raise ValueError("Caddyfile contains a partial Home Tunnel block")
    if has_global and has_site:
        return source if source.endswith("\n") else source + "\n"

    lines = source.splitlines()
    first_content = next((index for index, line in enumerate(lines) if line.strip() and not line.lstrip().startswith("#")), None)
    global_lines = global_snippet.rstrip().splitlines()
    if first_content is not None and lines[first_content].strip() == "{":
        depth = 0
        closing_index = None
        for index in range(first_content, len(lines)):
            depth += brace_delta(lines[index])
            if index > first_content and depth == 0:
                closing_index = index
                break
        if closing_index is None:
            raise ValueError("Unable to locate the end of the Caddy global options block")
        insertion = ([] if closing_index == 0 or not lines[closing_index - 1].strip() else [""]) + global_lines
        lines[closing_index:closing_index] = insertion
    else:
        lines = ["{"] + global_lines + ["}", ""] + lines

    while lines and not lines[-1].strip():
        lines.pop()
    lines.extend(["", *site_snippet.rstrip().splitlines()])
    rendered = "\n".join(lines) + "\n"
    if rendered.index("console.tunnel.example.com") > rendered.index("*.tunnel.example.com"):
        raise ValueError("Exact console route must precede the wildcard route")
    return rendered


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--global-snippet", required=True)
    parser.add_argument("--site-snippet", required=True)
    parser.add_argument("--output", required=True)
    arguments = parser.parse_args()

    source_path = Path(arguments.input)
    rendered = render(
        source_path.read_text(encoding="utf-8"),
        Path(arguments.global_snippet).read_text(encoding="utf-8"),
        Path(arguments.site_snippet).read_text(encoding="utf-8"),
    )
    Path(arguments.output).write_text(rendered, encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
