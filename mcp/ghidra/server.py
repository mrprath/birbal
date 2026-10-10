# mcp/ghidra/server.py
# WHY: MCP stdio server that exposes Ghidra decompilation to Claude.
# Decompile-only: never executes the target binary, no sandbox needed.

import json
import sys
from pathlib import Path

from mcp.server.mcpserver import MCPServer

from ghidra_session import (
    decompile_all,
    decompile_function,
    get_strings,
    list_functions,
)

mcp = MCPServer(
    name="ghidra-decompiler",
    version="1.0.0",
)


@mcp.tool()
def ghidra_list_functions(binary_path: str) -> str:
    """List all functions in a binary with their addresses and sizes.

    Args:
        binary_path: Absolute path to the binary file to analyze.
    """
    fns = list_functions(binary_path)
    return json.dumps(fns, indent=2)


@mcp.tool()
def ghidra_decompile_function(binary_path: str, function_name: str) -> str:
    """Decompile a single function from a binary into C-like pseudocode.

    Args:
        binary_path: Absolute path to the binary file.
        function_name: Exact name of the function to decompile.
    """
    return decompile_function(binary_path, function_name)


@mcp.tool()
def ghidra_decompile_all(binary_path: str) -> str:
    """Decompile every function in a binary. Returns all pseudocode.

    Use ghidra_list_functions first to see what's available,
    then ghidra_decompile_function for targeted work.
    Only use this for small binaries or when you need full coverage.

    Args:
        binary_path: Absolute path to the binary file.
    """
    results = decompile_all(binary_path)
    # Format as concatenated C blocks
    parts = []
    for name, code in results.items():
        parts.append(f"// === {name} ===\n{code}")
    return "\n\n".join(parts)


@mcp.tool()
def ghidra_get_strings(binary_path: str) -> str:
    """Extract all defined strings from a binary.

    Useful for understanding what a binary does before decompiling.

    Args:
        binary_path: Absolute path to the binary file.
    """
    strings = get_strings(binary_path)
    return json.dumps(strings, indent=2)


if __name__ == "__main__":
    mcp.run(transport="stdio")
