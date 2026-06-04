from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from hermes_cli import kanban_db as kb
from hermes_cli import web_server


@pytest.fixture
def client() -> Iterator[TestClient]:
    prev_required = getattr(web_server.app.state, "auth_required", None)
    prev_host = getattr(web_server.app.state, "bound_host", None)
    prev_port = getattr(web_server.app.state, "bound_port", None)
    web_server.app.state.auth_required = False
    web_server.app.state.bound_host = "127.0.0.1"
    web_server.app.state.bound_port = 9119
    with TestClient(web_server.app, base_url="http://127.0.0.1:9119") as test_client:
        yield test_client
    web_server.app.state.auth_required = prev_required
    web_server.app.state.bound_host = prev_host
    web_server.app.state.bound_port = prev_port


def _auth_headers() -> dict[str, str]:
    return {"X-Hermes-Session-Token": web_server._SESSION_TOKEN}


def test_desktop_kanban_task_create_defaults_to_dispatchable_scratch_workspace(client: TestClient):
    kb.create_board("api-test")

    response = client.post(
        "/api/kanban/boards/api-test/tasks",
        json={"title": "smoke", "assignee": "juris-analista"},
        headers=_auth_headers(),
    )

    assert response.status_code == 201
    task = response.json()["task"]
    assert task["workspace_kind"] == "scratch"


def test_desktop_workspace_syncs_repo_and_base_ref_to_kanban_board(client: TestClient, tmp_path):
    response = client.post(
        "/api/workspaces",
        json={
            "board_id": "JUR",
            "branch": "dev",
            "description": "Workspace operacional JurisHUB",
            "name": "JurisHUB",
            "repo_path": str(tmp_path),
            "vault_path": str(tmp_path / "vault"),
        },
        headers=_auth_headers(),
    )

    assert response.status_code == 201
    workspace = response.json()["workspace"]
    assert workspace["branch"] == "dev"

    boards_response = client.get("/api/kanban/boards", headers=_auth_headers())
    assert boards_response.status_code == 200
    boards = boards_response.json()["boards"]
    board = next(item for item in boards if item["slug"] == "jur")
    assert board["workspace_id"] == workspace["id"]
    assert board["default_workdir"] == str(tmp_path)
    assert board["worktree_base_ref"] == "dev"

    # The workspace sync must create a dispatcher-ready board DB, not only
    # board.json metadata, so task operations work immediately from Desktop.
    tasks_response = client.get("/api/kanban/boards/jur/tasks", headers=_auth_headers())
    assert tasks_response.status_code == 200

    task_response = client.post(
        "/api/kanban/boards/jur/tasks",
        json={"title": "worktree card", "workspace_kind": "worktree"},
        headers=_auth_headers(),
    )
    assert task_response.status_code == 201
    assert task_response.json()["task"]["workspace_kind"] == "worktree"


def test_desktop_kanban_task_rejects_invalid_workspace_kind(client: TestClient):
    kb.create_board("api-test-invalid")

    response = client.post(
        "/api/kanban/boards/api-test-invalid/tasks",
        json={"title": "smoke", "workspace_kind": "repo"},
        headers=_auth_headers(),
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid task workspace_kind"


def test_desktop_kanban_task_update_rejects_invalid_workspace_kind(client: TestClient):
    kb.create_board("api-test-update")
    created = client.post(
        "/api/kanban/boards/api-test-update/tasks",
        json={"title": "smoke"},
        headers=_auth_headers(),
    )
    task_id = created.json()["task"]["id"]

    response = client.patch(
        f"/api/kanban/boards/api-test-update/tasks/{task_id}",
        json={"workspace_kind": "repo"},
        headers=_auth_headers(),
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid task workspace_kind"
