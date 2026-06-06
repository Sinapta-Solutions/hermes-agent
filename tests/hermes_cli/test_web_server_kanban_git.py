import subprocess
from pathlib import Path

from fastapi.testclient import TestClient

from hermes_cli import kanban_db as kb
from hermes_cli.web_server import _SESSION_TOKEN, app


def _auth_headers() -> dict[str, str]:
    return {"X-Hermes-Session-Token": _SESSION_TOKEN}


def _git(repo: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=repo,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def _init_repo_with_remote(tmp_path: Path) -> Path:
    remote = tmp_path / "origin.git"
    repo = tmp_path / "repo"
    subprocess.run(["git", "init", "--bare", str(remote)], check=True, capture_output=True, text=True)
    repo.mkdir()
    subprocess.run(["git", "init"], cwd=repo, check=True, capture_output=True, text=True)
    _git(repo, "config", "user.email", "test@example.com")
    _git(repo, "config", "user.name", "Hermes Test")
    (repo / "src").mkdir()
    (repo / "src" / "app.txt").write_text("initial\n", encoding="utf-8")
    _git(repo, "add", "src/app.txt")
    _git(repo, "commit", "-m", "init")
    _git(repo, "remote", "add", "origin", str(remote))
    _git(repo, "push", "-u", "origin", "HEAD")
    return repo


def _seed_git_board(tmp_path: Path, monkeypatch) -> tuple[TestClient, Path]:
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "home"))
    repo = _init_repo_with_remote(tmp_path)
    kb.create_board("git", default_workdir=str(repo), worktree_base_ref=_git(repo, "branch", "--show-current"))
    return TestClient(app), repo


def test_kanban_git_changes_lists_diff_and_commit_pushes_repo_changes(tmp_path, monkeypatch):
    client, repo = _seed_git_board(tmp_path, monkeypatch)
    (repo / "src" / "app.txt").write_text("changed\n", encoding="utf-8")

    repos_response = client.get("/api/kanban/boards/git/git/repos", headers=_auth_headers())
    assert repos_response.status_code == 200
    repos = repos_response.json()["repos"]
    assert len(repos) == 1
    assert repos[0]["path"] == str(repo.resolve())
    repo_id = repos[0]["id"]

    status_response = client.get(
        "/api/kanban/boards/git/git/status",
        params={"repo_id": repo_id},
        headers=_auth_headers(),
    )
    assert status_response.status_code == 200
    files = status_response.json()["files"]
    assert files == [
        {
            "path": "src/app.txt",
            "status": "modified",
            "raw_status": " M",
            "staged": False,
            "sensitive": False,
        }
    ]

    diff_response = client.get(
        "/api/kanban/boards/git/git/diff",
        params={"repo_id": repo_id, "path": "src/app.txt"},
        headers=_auth_headers(),
    )
    assert diff_response.status_code == 200
    diff = diff_response.json()["diff"]
    assert "-initial" in diff
    assert "+changed" in diff

    commit_response = client.post(
        "/api/kanban/boards/git/git/commit-push",
        json={"repo_id": repo_id, "message": "Update app text", "paths": ["src/app.txt"]},
        headers=_auth_headers(),
    )
    assert commit_response.status_code == 200
    body = commit_response.json()
    assert body["committed"] is True
    assert body["pushed"] is True
    assert body["commit"]

    clean_response = client.get(
        "/api/kanban/boards/git/git/status",
        params={"repo_id": repo_id},
        headers=_auth_headers(),
    )
    assert clean_response.status_code == 200
    assert clean_response.json()["files"] == []


def test_kanban_git_changes_blocks_sensitive_diff_and_commit(tmp_path, monkeypatch):
    client, repo = _seed_git_board(tmp_path, monkeypatch)
    (repo / "src" / "app.txt").write_text("changed\n", encoding="utf-8")
    (repo / "credentials.json").write_text("redacted-placeholder\n", encoding="utf-8")

    repos_response = client.get("/api/kanban/boards/git/git/repos", headers=_auth_headers())
    assert repos_response.status_code == 200
    repo_id = repos_response.json()["repos"][0]["id"]

    status_response = client.get(
        "/api/kanban/boards/git/git/status",
        params={"repo_id": repo_id},
        headers=_auth_headers(),
    )
    assert status_response.status_code == 200
    files = {item["path"]: item for item in status_response.json()["files"]}
    assert files["src/app.txt"]["sensitive"] is False
    assert files["credentials.json"]["sensitive"] is True

    sensitive_diff = client.get(
        "/api/kanban/boards/git/git/diff",
        params={"repo_id": repo_id, "path": "credentials.json"},
        headers=_auth_headers(),
    )
    assert sensitive_diff.status_code == 400
    assert sensitive_diff.json()["detail"] == "Sensitive file diff is blocked"

    traversal_diff = client.get(
        "/api/kanban/boards/git/git/diff",
        params={"repo_id": repo_id, "path": "../src/app.txt"},
        headers=_auth_headers(),
    )
    assert traversal_diff.status_code == 400

    blocked_commit = client.post(
        "/api/kanban/boards/git/git/commit-push",
        json={"repo_id": repo_id, "message": "Commit unsafe", "paths": ["credentials.json"]},
        headers=_auth_headers(),
    )
    assert blocked_commit.status_code == 400
    assert blocked_commit.json()["detail"] == "Sensitive files cannot be committed from Kanban"
