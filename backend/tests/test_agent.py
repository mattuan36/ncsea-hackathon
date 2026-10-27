"""Agent endpoint tests. No database or LLM needed: httpx is stubbed."""
import httpx
from fastapi.testclient import TestClient

from app import agent
from app.main import app

client = TestClient(app)  # not used as a context manager, so the DB lifespan does not run

SNAPSHOT = {"project": "Riverside", "gravity": {"totalKips": 123.4}}


def _resp(status, body):
    return httpx.Response(status, json=body, request=httpx.Request("POST", "http://llm"))


def test_chat_sends_snapshot_and_history_and_returns_answer(monkeypatch):
    seen = {}

    def fake_post(url, json=None, headers=None, timeout=None):
        seen.update(url=url, json=json)
        return _resp(200, {"choices": [{"message": {"content": " 123.4 kips. "}}]})

    monkeypatch.setattr(agent.httpx, "post", fake_post)
    r = client.post(
        "/api/agent/chat",
        json={
            "messages": [
                {"role": "user", "content": "hi"},
                {"role": "assistant", "content": "hello"},
                {"role": "user", "content": "total load?"},
            ],
            "snapshot": SNAPSHOT,
        },
    )
    assert r.status_code == 200
    assert r.json()["answer"] == "123.4 kips."
    sent = seen["json"]["messages"]
    assert sent[0]["role"] == "system" and '"totalKips":123.4' in sent[0]["content"]
    assert [m["role"] for m in sent[1:]] == ["user", "assistant", "user"]
    assert seen["url"].endswith("/chat/completions")


def test_chat_rejects_trailing_assistant_message():
    r = client.post(
        "/api/agent/chat",
        json={"messages": [{"role": "assistant", "content": "x"}], "snapshot": {}},
    )
    assert r.status_code == 422


def test_chat_unreachable_llm_is_503_with_hint(monkeypatch):
    def boom(*a, **k):
        raise httpx.ConnectError("refused")

    monkeypatch.setattr(agent.httpx, "post", boom)
    r = client.post(
        "/api/agent/chat", json={"messages": [{"role": "user", "content": "q"}], "snapshot": {}}
    )
    assert r.status_code == 503
    assert "ollama" in r.json()["detail"].lower()


def test_chat_llm_error_status_is_502(monkeypatch):
    monkeypatch.setattr(agent.httpx, "post", lambda *a, **k: _resp(500, {"error": "x"}))
    r = client.post(
        "/api/agent/chat", json={"messages": [{"role": "user", "content": "q"}], "snapshot": {}}
    )
    assert r.status_code == 502


def test_oversized_snapshot_is_413():
    big = {"blob": "x" * (agent.MAX_SNAPSHOT_CHARS + 10)}
    r = client.post(
        "/api/agent/chat", json={"messages": [{"role": "user", "content": "q"}], "snapshot": big}
    )
    assert r.status_code == 413


def test_status_reports_unreachable(monkeypatch):
    def boom(*a, **k):
        raise httpx.ConnectError("refused")

    monkeypatch.setattr(agent.httpx, "get", boom)
    body = client.get("/api/agent/status").json()
    assert body["ok"] is False and body["model"]
