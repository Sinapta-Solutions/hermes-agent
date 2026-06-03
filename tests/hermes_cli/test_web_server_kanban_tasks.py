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
