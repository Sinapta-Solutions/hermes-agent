import json
import sqlite3
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



def test_desktop_kanban_create_uses_requested_initial_status_atomically(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    _seed_board(tmp_path, slug="status")

    from hermes_cli.web_server import _SESSION_TOKEN, app

    client = TestClient(app)
    headers = {"X-Hermes-Session-Token": _SESSION_TOKEN}

    created = client.post(
        "/api/kanban/boards/status/tasks",
        headers=headers,
        json={"title": "scheduled directly", "status": "scheduled"},
    )
    assert created.status_code == 201
    task = created.json()["task"]
    assert task["status"] == "scheduled"

    conn = sqlite3.connect(tmp_path / "kanban" / "boards" / "status" / "kanban.db")
    conn.row_factory = sqlite3.Row
    try:
        events = conn.execute(
            "SELECT kind, payload FROM task_events WHERE task_id = ? ORDER BY id",
            (task["id"],),
        ).fetchall()
    finally:
        conn.close()

    assert [(event["kind"], json.loads(event["payload"]).get("status")) for event in events] == [("created", "scheduled")]



def test_desktop_kanban_workflow_step_passed_unblocks_ready_next_step(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    _seed_board(tmp_path, slug="blocked-wf")

    from hermes_cli.web_server import _SESSION_TOKEN, app

    client = TestClient(app)
    headers = {"X-Hermes-Session-Token": _SESSION_TOKEN}
    route = {
        "version": kanban_db.WORKFLOW_ROUTE_VERSION,
        "template_id": "blocked-recovery",
        "steps": [
            {"id": "plan", "title": "Plan", "type": "planning", "assignee": "planner"},
            {"id": "review", "title": "Review", "type": "review", "assignee": "reviewer", "depends_on": ["plan"]},
        ],
    }
    created = client.post(
        "/api/kanban/boards/blocked-wf/tasks",
        headers=headers,
        json={"title": "blocked recovery", "workflowRoute": route},
    )
    assert created.status_code == 201
    task_id = created.json()["task"]["id"]

    blocked = client.patch(
        f"/api/kanban/boards/blocked-wf/tasks/{task_id}/workflow/steps/plan",
        headers=headers,
        json={"status": "blocked"},
    )
    assert blocked.status_code == 200
    assert blocked.json()["task"]["status"] == "blocked"

    passed = client.patch(
        f"/api/kanban/boards/blocked-wf/tasks/{task_id}/workflow/steps/plan",
        headers=headers,
        json={"status": "passed"},
    )
    assert passed.status_code == 200
    task = passed.json()["task"]
    assert task["status"] == "ready"
    assert task["current_step_key"] == "review"
    assert task["assignee"] == "reviewer"



def test_desktop_kanban_workflow_step_allows_clearing_assignee(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    _seed_board(tmp_path, slug="clear-assignee")

    from hermes_cli.web_server import _SESSION_TOKEN, app

    client = TestClient(app)
    headers = {"X-Hermes-Session-Token": _SESSION_TOKEN}
    route = {
        "version": kanban_db.WORKFLOW_ROUTE_VERSION,
        "template_id": "clear-assignee",
        "steps": [{"id": "plan", "title": "Plan", "type": "planning", "assignee": "planner"}],
    }
    created = client.post(
        "/api/kanban/boards/clear-assignee/tasks",
        headers=headers,
        json={"title": "clear assignee", "assignee": "fallback", "workflowRoute": route},
    )
    assert created.status_code == 201
    task_id = created.json()["task"]["id"]

    cleared = client.patch(
        f"/api/kanban/boards/clear-assignee/tasks/{task_id}/workflow/steps/plan",
        headers=headers,
        json={"assignee": None},
    )
    assert cleared.status_code == 200
    step = cleared.json()["task"]["workflowRoute"]["steps"][0]
    assert step["assignee"] is None
    assert cleared.json()["task"]["assignee"] is None



def test_desktop_kanban_workflow_evidence_does_not_unblock_blocked_task(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    _seed_board(tmp_path, slug="blocked-note")

    from hermes_cli.web_server import _SESSION_TOKEN, app

    client = TestClient(app)
    headers = {"X-Hermes-Session-Token": _SESSION_TOKEN}
    route = {
        "version": kanban_db.WORKFLOW_ROUTE_VERSION,
        "template_id": "blocked-note",
        "steps": [{"id": "plan", "title": "Plan", "type": "planning", "assignee": "planner"}],
    }
    created = client.post(
        "/api/kanban/boards/blocked-note/tasks",
        headers=headers,
        json={"title": "blocked note", "status": "blocked", "workflowRoute": route},
    )
    assert created.status_code == 201
    task_id = created.json()["task"]["id"]

    noted = client.patch(
        f"/api/kanban/boards/blocked-note/tasks/{task_id}/workflow/steps/plan",
        headers=headers,
        json={"evidence": "note only"},
    )
    assert noted.status_code == 200
    assert noted.json()["task"]["status"] == "blocked"



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
    workflow = client.post(
        "/api/kanban/boards/disp/tasks",
        headers=headers,
        json={
            "title": "approval task",
            "workflowRoute": {"steps": [{"id": "plan", "title": "Plan", "assignee": "worker"}]},
        },
    )
    assert workflow.status_code == 201
    task_id = workflow.json()["task"]["id"]
    requested = client.post(
        f"/api/kanban/boards/disp/tasks/{task_id}/workflow/steps/plan/approval",
        headers=headers,
        json={"reason": "ops gate"},
    )
    assert requested.status_code == 200

    status = client.get("/api/kanban/boards/disp/dispatcher/status", headers=headers)
    assert status.status_code == 200
    body = status.json()
    assert body["object"] == "hermes.kanban.dispatcher_status"
    assert isinstance(body["dispatch_in_gateway"], bool)
    assert body["ready_count"] >= 1
    assert body["running_count"] >= 1
    assert body["stale_running_count"] == 0
    assert body["pending_approvals_count"] == 1
    assert isinstance(body["active_runs"], list)

def test_desktop_kanban_task_runs_endpoint_returns_ordered_run_ledger(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    db_path = _seed_board(tmp_path, slug="runs")

    from hermes_cli.web_server import _SESSION_TOKEN, app

    client = TestClient(app)
    headers = {"X-Hermes-Session-Token": _SESSION_TOKEN}

    created = client.post(
        "/api/kanban/boards/runs/tasks",
        headers=headers,
        json={"title": "run ledger", "status": "ready"},
    )
    assert created.status_code == 201
    task_id = created.json()["task"]["id"]

    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            """
            INSERT INTO task_runs (
                task_id, profile, step_key, status, claim_lock, claim_expires, worker_pid,
                max_runtime_seconds, last_heartbeat_at, started_at, ended_at, outcome, summary, metadata, error
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                task_id,
                "worker-a",
                "build",
                "done",
                "old-lock",
                1010,
                123,
                900,
                1005,
                1000,
                1020,
                "completed",
                "old summary",
                json.dumps({"groups": [{"kind": "final", "text": "ok"}]}),
                None,
            ),
        )
        conn.execute(
            """
            INSERT INTO task_runs (
                task_id, profile, step_key, status, claim_lock, claim_expires, worker_pid,
                max_runtime_seconds, last_heartbeat_at, started_at, ended_at, outcome, summary, metadata, error
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                task_id,
                "worker-b",
                "review",
                "running",
                "new-lock",
                2020,
                456,
                900,
                2010,
                2000,
                None,
                None,
                None,
                json.dumps({"groups": [{"kind": "tool", "text": "pytest"}]}),
                None,
            ),
        )
        conn.commit()
    finally:
        conn.close()

    response = client.get(f"/api/kanban/boards/runs/tasks/{task_id}/runs", headers=headers)

    assert response.status_code == 200
    body = response.json()
    assert body["object"] == "hermes.kanban.task.runs"
    assert body["task_id"] == task_id
    assert [run["profile"] for run in body["runs"]] == ["worker-b", "worker-a"]
    assert body["runs"][0]["metadata"] == {"groups": [{"kind": "tool", "text": "pytest"}]}
    assert body["runs"][0]["worker_pid"] == 456
    assert body["runs"][1]["summary"] == "old summary"

def test_desktop_kanban_activity_endpoint_orders_normalized_timeline(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    _seed_board(tmp_path, slug="activity")

    from hermes_cli.web_server import _SESSION_TOKEN, app

    client = TestClient(app)
    headers = {"X-Hermes-Session-Token": _SESSION_TOKEN}

    created = client.post(
        "/api/kanban/boards/activity/tasks",
        headers=headers,
        json={"title": "activity task", "status": "ready"},
    )
    assert created.status_code == 201
    task_id = created.json()["task"]["id"]

    updated = client.patch(
        f"/api/kanban/boards/activity/tasks/{task_id}",
        headers=headers,
        json={"status": "blocked"},
    )
    assert updated.status_code == 200

    comment = client.post(
        f"/api/kanban/boards/activity/tasks/{task_id}/comments",
        headers=headers,
        json={"author": "operator", "body": "blocked on review"},
    )
    assert comment.status_code == 201

    response = client.get(f"/api/kanban/boards/activity/tasks/{task_id}/activity", headers=headers)

    assert response.status_code == 200
    body = response.json()
    assert body["object"] == "hermes.kanban.activity"
    assert body["task_id"] == task_id
    kinds = [item["kind"] for item in body["activity"]]
    assert "task.status_changed" in kinds
    assert "comment.added" in kinds
    status_item = next(item for item in body["activity"] if item["kind"] == "task.status_changed")
    assert status_item["payload"]["status"] == {"from": "ready", "to": "blocked"}
    assert body["activity"] == sorted(body["activity"], key=lambda item: (item["created_at"], item["id"]), reverse=True)

    board_response = client.get("/api/kanban/boards/activity/activity", headers=headers)
    assert board_response.status_code == 200
    assert any(item["task_id"] == task_id for item in board_response.json()["activity"])

def test_desktop_kanban_blockers_endpoint_returns_unresolved_parents(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    _seed_board(tmp_path, slug="blockers")

    from hermes_cli import kanban_db
    from hermes_cli.web_server import _SESSION_TOKEN, app

    with kanban_db.connect(board="blockers") as conn:
        blocker = kanban_db.create_task(conn, title="blocking work", assignee="agent-a", board="blockers")
        child = kanban_db.create_task(conn, title="blocked work", assignee="agent-b", parents=[blocker], board="blockers")

    client = TestClient(app)
    response = client.get(
        f"/api/kanban/boards/blockers/tasks/{child}/blockers",
        headers={"X-Hermes-Session-Token": _SESSION_TOKEN},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["object"] == "hermes.kanban.blockers"
    assert body["blocked"] is True
    assert body["blockers"] == [
        {"id": blocker, "title": "blocking work", "status": "ready", "assignee": "agent-a"}
    ]

    with kanban_db.connect(board="blockers") as conn:
        kanban_db.claim_task(conn, blocker)
        kanban_db.complete_task(conn, blocker, result="ok")

    response = client.get(
        f"/api/kanban/boards/blockers/tasks/{child}/blockers",
        headers={"X-Hermes-Session-Token": _SESSION_TOKEN},
    )
    assert response.status_code == 200
    assert response.json()["blocked"] is False
    assert response.json()["blockers"] == []

def test_desktop_kanban_comment_resume_intent_updates_task(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    _seed_board(tmp_path, slug="comment-intent")

    from hermes_cli import kanban_db
    from hermes_cli.web_server import _SESSION_TOKEN, app

    with kanban_db.connect(board="comment-intent") as conn:
        task_id = kanban_db.create_task(conn, title="blocked", assignee="agent", initial_status="blocked", board="comment-intent")

    client = TestClient(app)
    headers = {"X-Hermes-Session-Token": _SESSION_TOKEN}
    response = client.post(
        f"/api/kanban/boards/comment-intent/tasks/{task_id}/comments",
        headers=headers,
        json={"author": "desktop", "body": "retomar", "intent": "resume"},
    )

    assert response.status_code == 201
    with kanban_db.connect(board="comment-intent") as conn:
        assert kanban_db.get_task(conn, task_id).status == "ready"
        events = kanban_db.list_events(conn, task_id)
    assert any(event.kind == "comment_intent" and event.payload["intent"] == "resume" for event in events)


def test_desktop_kanban_comment_interrupt_intent_marks_run(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    _seed_board(tmp_path, slug="comment-interrupt")

    from hermes_cli import kanban_db
    from hermes_cli.web_server import _SESSION_TOKEN, app

    with kanban_db.connect(board="comment-interrupt") as conn:
        task_id = kanban_db.create_task(conn, title="running", assignee="agent", board="comment-interrupt")
        kanban_db.claim_task(conn, task_id, claimer="host:worker")
        run_id = kanban_db.latest_run(conn, task_id).id

    client = TestClient(app)
    response = client.post(
        f"/api/kanban/boards/comment-interrupt/tasks/{task_id}/comments",
        headers={"X-Hermes-Session-Token": _SESSION_TOKEN},
        json={"author": "desktop", "body": "interromper", "intent": "interrupt"},
    )

    assert response.status_code == 201
    with kanban_db.connect(board="comment-interrupt") as conn:
        task = kanban_db.get_task(conn, task_id)
        events = kanban_db.list_events(conn, task_id)
    assert task.status == "running"
    interrupt = next(event for event in events if event.kind == "interrupt_requested")
    assert interrupt.run_id == run_id




def test_desktop_kanban_workflow_approval_request_and_decision(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    _seed_board(tmp_path, slug="approvals")

    from hermes_cli import kanban_db
    from hermes_cli.web_server import _SESSION_TOKEN, app

    route = {
        "version": kanban_db.WORKFLOW_ROUTE_VERSION,
        "template_id": "approval-test",
        "steps": [{"id": "plan", "title": "Plan", "type": "planning", "assignee": "planner"}],
    }
    client = TestClient(app)
    headers = {"X-Hermes-Session-Token": _SESSION_TOKEN}
    created = client.post(
        "/api/kanban/boards/approvals/tasks",
        headers=headers,
        json={"title": "approval api", "workflowRoute": route},
    )
    assert created.status_code == 201
    task_id = created.json()["task"]["id"]

    requested = client.post(
        f"/api/kanban/boards/approvals/tasks/{task_id}/workflow/steps/plan/approval",
        headers=headers,
        json={"reason": "operator must approve"},
    )
    assert requested.status_code == 200
    step = requested.json()["task"]["workflowRoute"]["steps"][0]
    assert step["approval"]["status"] == "pending"

    blocked = client.patch(
        f"/api/kanban/boards/approvals/tasks/{task_id}/workflow/steps/plan",
        headers=headers,
        json={"status": "passed"},
    )
    assert blocked.status_code == 400
    assert "approval pending" in blocked.json()["detail"]

    decided = client.patch(
        f"/api/kanban/boards/approvals/tasks/{task_id}/workflow/steps/plan/approval",
        headers=headers,
        json={"decision": "approved", "reason": "ok"},
    )
    assert decided.status_code == 200
    step = decided.json()["task"]["workflowRoute"]["steps"][0]
    assert step["approval"]["status"] == "approved"



def test_workspace_status_reports_close_readiness(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    from hermes_cli import web_server
    from hermes_cli.web_server import _SESSION_TOKEN, app

    web_server._workspaces_conn = None
    repo = tmp_path / "repo"
    vault = tmp_path / "vault"
    repo.mkdir()
    vault.mkdir()
    client = TestClient(app)
    headers = {"X-Hermes-Session-Token": _SESSION_TOKEN}

    created = client.post(
        "/api/workspaces",
        headers=headers,
        json={"name": "Close Ready", "repo_path": str(repo), "vault_path": str(vault)},
    )
    assert created.status_code == 201
    workspace_id = created.json()["workspace"]["id"]

    status = client.get(f"/api/workspaces/{workspace_id}/status", headers=headers)
    assert status.status_code == 200
    readiness = status.json()["close_readiness"]
    assert readiness["ready"] is True
    assert readiness["blockers"] == []

    conn = web_server._ensure_workspaces_db()
    now = web_server._workspace_now()
    conn.execute(
        "INSERT INTO workspace_tasks (id, workspace_id, status, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        ("t_open", workspace_id, "running", "open task", now, now),
    )
    conn.commit()

    blocked = client.get(f"/api/workspaces/{workspace_id}/status", headers=headers)
    readiness = blocked.json()["close_readiness"]
    assert readiness["ready"] is False
    assert any(item["code"] == "open_tasks" and item["count"] == 1 for item in readiness["blockers"])
