from __future__ import annotations

import hashlib
import os
import re
import subprocess
from pathlib import Path
from typing import Any

from fastapi import HTTPException

_GIT_TIMEOUT_SECONDS = 10
_MAX_DIFF_CHARS = 120_000
_SENSITIVE_NAME_PARTS = (
    "apikey",
    "api_key",
    "credential",
    "credentials",
    "secret",
    "secrets",
    "token",
    "tokens",
)
_SENSITIVE_BASENAMES = {"id_ed25519", "id_rsa"}
_SENSITIVE_SUFFIXES = (".key", ".p12", ".pem", ".pfx")
_WINDOWS_DRIVE_PATH = re.compile(r"^[a-zA-Z]:")


def repo_id_for_path(path: Path) -> str:
    return hashlib.sha256(str(path.resolve()).casefold().encode("utf-8")).hexdigest()[:16]


def is_sensitive_git_path(path: str) -> bool:
    normalized = path.replace("\\", "/")
    basename = normalized.rsplit("/", 1)[-1].casefold()
    if basename == ".env" or basename.startswith(".env."):
        return True
    if basename in _SENSITIVE_BASENAMES:
        return True
    if basename.endswith(_SENSITIVE_SUFFIXES):
        return True
    return any(part in basename for part in _SENSITIVE_NAME_PARTS)


def safe_git_pathspec(raw_path: Any) -> str:
    path = str(raw_path or "").strip()
    if not path:
        raise HTTPException(status_code=400, detail="Git path is required")
    if "\x00" in path or any(ord(char) < 32 for char in path):
        raise HTTPException(status_code=400, detail="Invalid git path")
    if "\\" in path or path.startswith("/") or _WINDOWS_DRIVE_PATH.match(path):
        raise HTTPException(status_code=400, detail="Invalid git path")
    parts = path.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        raise HTTPException(status_code=400, detail="Invalid git path")
    if any(part == ".git" for part in parts):
        raise HTTPException(status_code=400, detail="Invalid git path")
    return "/".join(parts)


def _clean_git_env() -> dict[str, str]:
    env = dict(os.environ)
    for key in list(env):
        if key.startswith("GIT_"):
            env.pop(key, None)
    return env


def run_git(repo: Path, args: list[str], *, timeout: int = _GIT_TIMEOUT_SECONDS, allow_diff_exit: bool = False) -> str:
    try:
        proc = subprocess.run(
            ["git", "-C", str(repo), *args],
            capture_output=True,
            text=True,
            timeout=timeout,
            env=_clean_git_env(),
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail="git executable not found") from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="git command timed out") from exc

    if proc.returncode != 0 and not (allow_diff_exit and proc.returncode == 1):
        detail = (proc.stderr or proc.stdout or "git command failed").strip()
        raise HTTPException(status_code=400, detail=detail[:2000])
    return proc.stdout or ""


def git_toplevel(path: str | Path) -> Path:
    candidate = Path(path).expanduser()
    if not candidate.exists() or not candidate.is_dir():
        raise HTTPException(status_code=400, detail="Git repository path does not exist")
    output = run_git(candidate, ["rev-parse", "--show-toplevel"])
    root = Path(output.strip()).expanduser().resolve()
    if not root.exists() or not root.is_dir():
        raise HTTPException(status_code=400, detail="Git repository root does not exist")
    return root


def git_branch(repo: Path) -> str | None:
    try:
        branch = run_git(repo, ["branch", "--show-current"]).strip()
    except HTTPException:
        return None
    return branch or None


def repository_payload(path: str | Path, *, label: str, source: str, task_id: str | None = None) -> dict[str, Any] | None:
    try:
        root = git_toplevel(path)
    except HTTPException:
        return None
    return {
        "id": repo_id_for_path(root),
        "label": label,
        "path": str(root),
        "branch": git_branch(root),
        "source": source,
        "task_id": task_id,
    }


def _status_label(raw_status: str) -> str:
    if raw_status == "??":
        return "untracked"
    if "U" in raw_status:
        return "conflicted"
    if "R" in raw_status:
        return "renamed"
    if "C" in raw_status:
        return "copied"
    if "D" in raw_status:
        return "deleted"
    if "A" in raw_status:
        return "added"
    if "M" in raw_status:
        return "modified"
    return "changed"


def git_status(repo: Path) -> list[dict[str, Any]]:
    output = run_git(repo, ["status", "--porcelain=v1", "-z"])
    entries = [entry for entry in output.split("\0") if entry]
    files: list[dict[str, Any]] = []
    index = 0
    while index < len(entries):
        entry = entries[index]
        if len(entry) < 4:
            index += 1
            continue
        raw_status = entry[:2]
        path = entry[3:]
        original_path = None
        if "R" in raw_status or "C" in raw_status:
            index += 1
            if index < len(entries):
                original_path = entries[index]
        try:
            safe_path = safe_git_pathspec(path)
        except HTTPException:
            index += 1
            continue
        files.append(
            {
                "path": safe_path,
                "status": _status_label(raw_status),
                "raw_status": raw_status,
                "staged": raw_status[0] not in {" ", "?"},
                "sensitive": is_sensitive_git_path(safe_path),
                **({"original_path": original_path} if original_path else {}),
            }
        )
        index += 1
    return sorted(files, key=lambda item: item["path"])


def git_diff(repo: Path, path: str) -> str:
    safe_path = safe_git_pathspec(path)
    if is_sensitive_git_path(safe_path):
        raise HTTPException(status_code=400, detail="Sensitive file diff is blocked")

    diff = run_git(repo, ["diff", "--", safe_path])
    cached = run_git(repo, ["diff", "--cached", "--", safe_path])
    combined = "\n".join(part for part in (cached.strip(), diff.strip()) if part)
    return combined[:_MAX_DIFF_CHARS]


def _commit_paths(repo: Path, raw_paths: Any) -> list[str]:
    if raw_paths is None:
        paths = [item["path"] for item in git_status(repo) if not item["sensitive"]]
    elif isinstance(raw_paths, list):
        paths = [safe_git_pathspec(item) for item in raw_paths]
    else:
        raise HTTPException(status_code=400, detail="paths must be a list")

    if not paths:
        raise HTTPException(status_code=400, detail="No safe git changes to commit")
    if any(is_sensitive_git_path(path) for path in paths):
        raise HTTPException(status_code=400, detail="Sensitive files cannot be committed from Kanban")
    return paths


def commit_and_push(repo: Path, *, message: str, paths: Any = None) -> dict[str, Any]:
    commit_message = str(message or "").strip()
    if not commit_message:
        raise HTTPException(status_code=400, detail="Commit message is required")
    if len(commit_message) > 500:
        raise HTTPException(status_code=400, detail="Commit message is too long")

    safe_paths = _commit_paths(repo, paths)
    run_git(repo, ["add", "--", *safe_paths])
    run_git(repo, ["commit", "-m", commit_message], timeout=30)
    commit = run_git(repo, ["rev-parse", "HEAD"]).strip()
    branch = git_branch(repo)
    if not branch:
        raise HTTPException(status_code=400, detail="Cannot push detached HEAD")
    run_git(repo, ["push", "-u", "origin", branch], timeout=60)
    return {
        "object": "hermes.kanban.git.commit_push",
        "commit": commit,
        "committed": True,
        "pushed": True,
        "branch": branch,
        "paths": safe_paths,
    }
