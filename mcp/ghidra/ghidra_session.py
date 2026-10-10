# mcp/ghidra/ghidra_session.py
# WHY: Wraps pyghidra so the MCP server never touches Ghidra internals directly.
# Single responsibility: open a binary, decompile functions, list symbols.

import os
import tempfile
from pathlib import Path

import pyghidra

# Resolved once at import time so every call uses the same Ghidra root.
GHIDRA_DIR = os.environ.get(
    "GHIDRA_INSTALL_DIR",
    r"C:\ghidra_install\ghidra_12.1.4_PUBLIC",
)

_launcher_started = False


def _ensure_launcher():
    """Start the pyghidra launcher once per process."""
    global _launcher_started
    if _launcher_started:
        return
    pyghidra.start(install_dir=GHIDRA_DIR)
    _launcher_started = True


def _resolve_path(binary_path: str) -> Path:
    """Resolve and validate a binary path. Rejects path traversal."""
    p = Path(binary_path).resolve()
    if not p.exists():
        raise FileNotFoundError(f"Binary not found: {p}")
    return p


def list_functions(binary_path: str) -> list[dict]:
    """Return every function name + address in the binary."""
    _ensure_launcher()
    p = _resolve_path(binary_path)

    with pyghidra.open_program(str(p)) as flat:
        program = flat.getCurrentProgram()
        fm = program.getFunctionManager()
        results = []
        for fn in fm.getFunctions(True):
            results.append({
                "name": fn.getName(),
                "address": str(fn.getEntryPoint()),
                "size": fn.getBody().getNumAddresses(),
            })
    return results


def decompile_function(binary_path: str, function_name: str) -> str:
    """Decompile a single function by name. Returns C-like pseudocode."""
    _ensure_launcher()
    p = _resolve_path(binary_path)

    with pyghidra.open_program(str(p)) as flat:
        program = flat.getCurrentProgram()
        fm = program.getFunctionManager()

        # Find the function
        target = None
        for fn in fm.getFunctions(True):
            if fn.getName() == function_name:
                target = fn
                break

        if target is None:
            raise ValueError(
                f"Function '{function_name}' not found in {p.name}"
            )

        # Decompile
        from ghidra.app.decompiler import DecompInterface

        decomp = DecompInterface()
        decomp.openProgram(program)
        result = decomp.decompileFunction(target, 30, None)

        if not result.decompileCompleted():
            raise RuntimeError(
                f"Decompilation failed for '{function_name}': "
                f"{result.getErrorMessage()}"
            )

        return result.getDecompiledFunction().getC()


def decompile_all(binary_path: str) -> dict[str, str]:
    """Decompile every function in the binary. Returns {name: pseudocode}."""
    _ensure_launcher()
    p = _resolve_path(binary_path)

    with pyghidra.open_program(str(p)) as flat:
        program = flat.getCurrentProgram()
        fm = program.getFunctionManager()

        from ghidra.app.decompiler import DecompInterface

        decomp = DecompInterface()
        decomp.openProgram(program)

        results = {}
        for fn in fm.getFunctions(True):
            r = decomp.decompileFunction(fn, 30, None)
            if r.decompileCompleted():
                results[fn.getName()] = r.getDecompiledFunction().getC()
            else:
                results[fn.getName()] = f"// FAILED: {r.getErrorMessage()}"

        decomp.dispose()
    return results


def get_strings(binary_path: str) -> list[dict]:
    """Extract defined strings from the binary."""
    _ensure_launcher()
    p = _resolve_path(binary_path)

    with pyghidra.open_program(str(p)) as flat:
        program = flat.getCurrentProgram()
        listing = program.getListing()
        mem = program.getMemory()

        results = []
        for data in listing.getDefinedData(True):
            dt = data.getDataType()
            if "string" in dt.getName().lower():
                val = data.getValue()
                if val is not None:
                    results.append({
                        "address": str(data.getAddress()),
                        "value": str(val),
                        "type": dt.getName(),
                    })
    return results
