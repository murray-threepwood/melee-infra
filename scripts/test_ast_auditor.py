#!/usr/bin/env python3
"""Auditor estático AST anti-test hacking.

Cuenta deterministamente funciones de test y aserciones.
Bloquea cambios que eliminen pruebas o reduzcan aserciones.
"""

from __future__ import annotations

import argparse
import ast
import json
import subprocess
import sys
from pathlib import Path


class TestMetricsVisitor(ast.NodeVisitor):
    def __init__(self) -> None:
        self.test_count = 0
        self.assertion_count = 0

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        if self._is_test_function_name(node.name):
            self.test_count += 1
        self.generic_visit(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        if self._is_test_function_name(node.name):
            self.test_count += 1
        self.generic_visit(node)

    def visit_Assert(self, node: ast.Assert) -> None:
        self.assertion_count += 1
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        if self._is_assertion_call(node):
            self.assertion_count += 1
        self.generic_visit(node)

    def visit_With(self, node: ast.With) -> None:
        for item in node.items:
            if isinstance(item.context_expr, ast.Call) and self._is_assertion_call(
                item.context_expr
            ):
                self.assertion_count += 1
        self.generic_visit(node)

    def _is_test_function_name(self, name: str) -> bool:
        low = name.lower()
        return low.startswith("test_") or low.endswith("_test") or low == "test"

    def _is_assertion_call(self, node: ast.Call) -> bool:
        # self.assert* or unittest assertions
        if isinstance(node.func, ast.Attribute):
            attr_name = node.func.attr.lower()
            if attr_name.startswith("assert") or attr_name == "fail":
                return True
            # pytest.raises, pytest.approx, etc.
            if isinstance(node.func.value, ast.Name):
                if node.func.value.id == "pytest" and attr_name in {
                    "raises",
                    "approx",
                    "warns",
                    "deprecated_call",
                }:
                    return True
        elif isinstance(node.func, ast.Name):
            func_name = node.func.id.lower()
            if func_name.startswith("assert_") or func_name.startswith("assert"):
                return True
        return False


def analyze_code(code: str) -> dict[str, int]:
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return {"test_count": 0, "assertion_count": 0, "syntax_error": 1}
    visitor = TestMetricsVisitor()
    visitor.visit(tree)
    return {
        "test_count": visitor.test_count,
        "assertion_count": visitor.assertion_count,
    }


def is_test_file(path_str: str) -> bool:
    p = Path(path_str)
    name = p.name.lower()
    if not name.endswith(".py"):
        return False
    if name.startswith("test_") or name.endswith("_test.py") or "tests" in p.parts:
        return True
    return False


def run_git(args: list[str], cwd: Path) -> tuple[int, str, str]:
    res = subprocess.run(
        ["git", *args],
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
    )
    return res.returncode, res.stdout, res.stderr


def audit_files_diff(
    before_code: str, after_code: str, file_name: str = "test.py"
) -> list[dict[str, object]]:
    violations: list[dict[str, object]] = []
    m_before = analyze_code(before_code)
    m_after = analyze_code(after_code)

    if m_after.get("syntax_error"):
        violations.append(
            {
                "file": file_name,
                "type": "syntax_error",
                "message": f"Error de sintaxis al parsear AST en {file_name}",
            }
        )
        return violations

    if m_after["test_count"] < m_before["test_count"]:
        violations.append(
            {
                "file": file_name,
                "type": "tests_reduced",
                "before": m_before["test_count"],
                "after": m_after["test_count"],
                "message": (
                    f"Redujo pruebas en {file_name}: "
                    f"tenía {m_before['test_count']}, ahora tiene {m_after['test_count']}"
                ),
            }
        )

    if m_after["assertion_count"] < m_before["assertion_count"]:
        violations.append(
            {
                "file": file_name,
                "type": "assertions_reduced",
                "before": m_before["assertion_count"],
                "after": m_after["assertion_count"],
                "message": (
                    f"Redujo aserciones en {file_name}: "
                    f"tenía {m_before['assertion_count']}, ahora tiene {m_after['assertion_count']}"
                ),
            }
        )

    return violations


def audit_git_repo(repo_dir: Path, base_ref: str = "HEAD") -> dict[str, object]:
    code, out, _ = run_git(["rev-parse", "--is-inside-work-tree"], repo_dir)
    if code != 0:
        return {
            "passed": True,
            "violations": [],
            "message": "No es un repositorio git; omitido.",
        }

    code, diff_out, _ = run_git(["diff", "--name-only", base_ref], repo_dir)
    code_unstaged, unstaged_out, _ = run_git(["diff", "--name-only"], repo_dir)
    code_staged, staged_out, _ = run_git(["diff", "--cached", "--name-only"], repo_dir)

    all_files = set(
        diff_out.splitlines() + unstaged_out.splitlines() + staged_out.splitlines()
    )
    test_files = [f.strip() for f in all_files if f.strip() and is_test_file(f)]

    all_violations: list[dict[str, object]] = []

    for rel_path in test_files:
        code_b, before_src, _ = run_git(["show", f"{base_ref}:{rel_path}"], repo_dir)
        if code_b != 0:
            continue

        disk_file = repo_dir / rel_path
        if not disk_file.exists():
            all_violations.append(
                {
                    "file": rel_path,
                    "type": "test_file_deleted",
                    "message": f"Archivo de prueba eliminado: {rel_path}",
                }
            )
            continue

        try:
            after_src = disk_file.read_text(encoding="utf-8")
        except Exception:
            continue

        violations = audit_files_diff(before_src, after_src, file_name=rel_path)
        all_violations.extend(violations)

    return {
        "passed": len(all_violations) == 0,
        "violations": all_violations,
        "audited_files": test_files,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Auditor AST anti-test hacking para repositorios del workspace"
    )
    parser.add_argument("repo_dir", nargs="?", default=".", help="Ruta al repositorio")
    parser.add_argument(
        "--base-ref", default="HEAD", help="Referencia base de git (default: HEAD)"
    )
    parser.add_argument("--file-before", help="Archivo antes (comparación directa)")
    parser.add_argument("--file-after", help="Archivo después (comparación directa)")

    args = parser.parse_args()

    if args.file_before and args.file_after:
        before_text = Path(args.file_before).read_text(encoding="utf-8")
        after_text = Path(args.file_after).read_text(encoding="utf-8")
        violations = audit_files_diff(
            before_text, after_text, file_name=args.file_after
        )
        result = {
            "passed": len(violations) == 0,
            "violations": violations,
        }
    else:
        repo_path = Path(args.repo_dir).resolve()
        result = audit_git_repo(repo_path, base_ref=args.base_ref)

    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
