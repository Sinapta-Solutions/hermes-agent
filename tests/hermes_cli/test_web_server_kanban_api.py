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
