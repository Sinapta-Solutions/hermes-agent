import json
from pathlib import Path

from fastapi.testclient import TestClient

from hermes_cli import kanban_db


def _seed_board(home: Path, slug: str = "jur") -> Path:
    board_dir = home / "kanban" / "boards" / slug
    board_dir.mkdir(parents=True, exist_ok=True)
    (board_dir / "board.json").write_text(
        json.dumps(
            {
                "slug": slug,
                "name": "JurisHUB",
                "description": "test board",
                "icon": "◫",
                "color": "#cba6f7",
                "archived": False,
            }
        ),
        encoding="utf-8",
    )
    db_path = board_dir / "kanban.db"
    kanban_db.init_db(db_path=db_path)
    return db_path


def test_desktop_kanban_archive_hides_task_from_active_board(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    _seed_board(tmp_path)

    from hermes_cli.web_server import _SESSION_TOKEN, app

    client = TestClient(app)
    headers = {"X-Hermes-Session-Token": _SESSION_TOKEN}

    created = client.post(
        "/api/kanban/boards/jur/tasks",
        headers=headers,
        json={"title": "archive me", "status": "ready"},
    )
    assert created.status_code == 201
    task_id = created.json()["task"]["id"]

    archived = client.patch(
        f"/api/kanban/boards/jur/tasks/{task_id}",
        headers=headers,
        json={"status": "archived"},
    )
    assert archived.status_code == 200
    assert archived.json()["task"]["status"] == "archived"

    active_board = client.get("/api/kanban/boards/jur/tasks", headers=headers)
    assert active_board.status_code == 200
    body = active_board.json()
    assert task_id not in {task["id"] for task in body["tasks"]}
    assert "archived" not in body["task_counts"]

    detail = client.get(f"/api/kanban/boards/jur/tasks/{task_id}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["task"]["status"] == "archived"



def test_desktop_kanban_workflow_route_create_apply_preset_and_evidence(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    _seed_board(tmp_path, slug="wf")

    from hermes_cli.web_server import _SESSION_TOKEN, app

    client = TestClient(app)
    headers = {"X-Hermes-Session-Token": _SESSION_TOKEN}
    route = {
        "version": kanban_db.WORKFLOW_ROUTE_VERSION,
        "template_id": "desktop-custom",
        "steps": [
            {"id": "plan", "title": "Plan", "type": "planning", "assignee": "planner"},
            {"id": "ship", "title": "Ship", "type": "implementation", "assignee": "shipper", "depends_on": ["plan"]},
        ],
    }

    created = client.post(
        "/api/kanban/boards/wf/tasks",
        headers=headers,
        json={"title": "workflow api", "assignee": "fallback", "workflowRoute": route},
    )
    assert created.status_code == 201
    task = created.json()["task"]
    task_id = task["id"]
    assert task["workflowRoute"]["template_id"] == "desktop-custom"
    assert task["current_step_key"] == "plan"
    assert task["assignee"] == "planner"

    preset = client.post(
        f"/api/kanban/boards/wf/tasks/{task_id}/workflow/apply-preset",
        headers=headers,
        json={"preset_id": kanban_db.JURISHUB_WORKFLOW_PRESET_ID, "assignee": "juris-agent"},
    )
    assert preset.status_code == 200
    task = preset.json()["task"]
    assert task["workflowRoute"]["template_id"] == kanban_db.JURISHUB_WORKFLOW_PRESET_ID
    assert task["current_step_key"] == "planning"
    assert task["assignee"] == "juris-agent"

    evidence = client.post(
        f"/api/kanban/boards/wf/tasks/{task_id}/workflow/evidence",
        headers=headers,
        json={"text": "desktop evidence"},
    )
    assert evidence.status_code == 200

    detail = client.get(f"/api/kanban/boards/wf/tasks/{task_id}", headers=headers)
    assert detail.status_code == 200
    step = detail.json()["task"]["workflowRoute"]["steps"][0]
    assert step["id"] == "planning"
    assert step["evidence"][-1]["text"] == "desktop evidence"



def test_desktop_kanban_workflow_step_endpoints_add_and_update_step(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    _seed_board(tmp_path, slug="steps")

    from hermes_cli.web_server import _SESSION_TOKEN, app

    client = TestClient(app)
    headers = {"X-Hermes-Session-Token": _SESSION_TOKEN}
    route = {
        "version": kanban_db.WORKFLOW_ROUTE_VERSION,
        "template_id": "desktop-custom",
        "steps": [
            {"id": "plan", "title": "Plan", "type": "planning", "assignee": "planner"},
        ],
    }

    created = client.post(
        "/api/kanban/boards/steps/tasks",
        headers=headers,
        json={"title": "workflow steps", "workflowRoute": route},
    )
    assert created.status_code == 201
    task_id = created.json()["task"]["id"]

    added = client.post(
        f"/api/kanban/boards/steps/tasks/{task_id}/workflow/steps",
        headers=headers,
        json={
            "id": "review",
            "title": "Review",
            "type": "review",
            "assignee": "reviewer",
            "depends_on": ["plan"],
            "validation_criteria": ["Review notes recorded"],
            "max_retries": 2,
        },
    )
    assert added.status_code == 200
    task = added.json()["task"]
    review = next(step for step in task["workflowRoute"]["steps"] if step["id"] == "review")
    assert review["assignee"] == "reviewer"
    assert review["depends_on"] == ["plan"]
    assert review["validation_criteria"] == ["Review notes recorded"]
    assert review["max_retries"] == 2

    updated = client.patch(
        f"/api/kanban/boards/steps/tasks/{task_id}/workflow/steps/review",
        headers=headers,
        json={"status": "blocked", "assignee": "auditor", "evidence": "needs rework"},
    )
    assert updated.status_code == 200
    review = next(step for step in updated.json()["task"]["workflowRoute"]["steps"] if step["id"] == "review")
    assert review["status"] == "blocked"
    assert review["assignee"] == "auditor"
    assert review["evidence"][-1]["text"] == "needs rework"



def test_desktop_kanban_dispatcher_status_endpoint_reports_counts(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    _seed_board(tmp_path, slug="disp")

    from hermes_cli.web_server import _SESSION_TOKEN, app

    client = TestClient(app)
    headers = {"X-Hermes-Session-Token": _SESSION_TOKEN}

    ready = client.post(
        "/api/kanban/boards/disp/tasks",
        headers=headers,
        json={"title": "ready task", "status": "ready", "assignee": "worker"},
    )
    assert ready.status_code == 201
    running = client.post(
        "/api/kanban/boards/disp/tasks",
        headers=headers,
        json={"title": "running task", "status": "running", "assignee": "worker"},
    )
    assert running.status_code == 201

    status = client.get("/api/kanban/boards/disp/dispatcher/status", headers=headers)
    assert status.status_code == 200
    body = status.json()
    assert body["object"] == "hermes.kanban.dispatcher_status"
    assert isinstance(body["dispatch_in_gateway"], bool)
    assert body["ready_count"] >= 1
    assert body["running_count"] >= 1
    assert body["stale_running_count"] == 0
    assert isinstance(body["active_runs"], list)
