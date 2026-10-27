"""Q&A agent over the app's inputs and results, backed by any OpenAI-compatible LLM server.

The browser holds all project state, so each request carries a `snapshot` of it. The model is
told to answer only from that snapshot. Default target is a local Ollama server (open-source
models); point LLM_BASE_URL / LLM_MODEL at vLLM, llama.cpp, LM Studio, etc. to change it.
"""
import json
import os
from typing import Literal

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/agent")

MAX_SNAPSHOT_CHARS = 60_000
MAX_HISTORY = 20

SYSTEM_PROMPT = """You are the assistant inside LightenTheLoad, a structural engineering web app.
You answer the user's questions about the INPUTS they entered and the RESULTS the app computed.

How the app works (for "how do I..." questions):
- Gravity: a 6-step flow (Model, Floor types, Wall types, Build assemblies, Type table, Plan view).
  Each floor/wall type gets an assembly of layers (material + thickness). Layer weight in psf is
  density x thickness / 12 for PCF materials, or a per-psf value for PSF materials, unless the
  layer has an override. Assembly psf is the sum of its layers. Floors: kips = psf x SF / 1000.
  Walls: kips = psf x height x LF / 1000. A merged type is a sub-assembly that uses its
  governing assembly's layers.
- Lateral: the user picks a site and risk category, then SkyCiv returns wind, snow and seismic data.
- Materials DB: the material list used by assemblies. Reports: graphical sheets and a spreadsheet
  of the dead load takeoff. Analytics: totals by assembly.

Rules:
1. Use ONLY the PROJECT SNAPSHOT below for project facts. The numbers in it are already computed
   by the app; quote them, do not recompute them differently. You may add, compare or rank them
   and should show the arithmetic when you do.
2. If the snapshot lacks what is needed (for example no lateral report generated yet), say so
   plainly and tell the user which page and action produces it. Never invent values.
3. Name the assembly, material or level you are talking about and give units (psf, kips, SF, LF).
4. The sample material weights are typical wireframe values. If asked about code compliance or
   design adequacy, answer what the data shows and say a licensed engineer must verify it against
   ASCE 7 before design use.
5. Be concise. Use short lists or a small table when comparing items."""


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=8000)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1)
    snapshot: dict = Field(default_factory=dict)


def _settings() -> dict:
    return {
        "base_url": os.environ.get("LLM_BASE_URL", "http://localhost:11434/v1").rstrip("/"),
        "model": os.environ.get("LLM_MODEL", "llama3.1:8b"),
        "api_key": os.environ.get("LLM_API_KEY", ""),
    }


def _headers(cfg: dict) -> dict:
    return {"Authorization": f"Bearer {cfg['api_key']}"} if cfg["api_key"] else {}


def build_messages(req: ChatRequest) -> list[dict]:
    snapshot = json.dumps(req.snapshot, separators=(",", ":"), ensure_ascii=False)
    if len(snapshot) > MAX_SNAPSHOT_CHARS:
        raise HTTPException(413, "Project snapshot is too large for the assistant")
    system = f"{SYSTEM_PROMPT}\n\nPROJECT SNAPSHOT (JSON):\n{snapshot}"
    history = [m.model_dump() for m in req.messages[-MAX_HISTORY:]]
    return [{"role": "system", "content": system}, *history]


@router.get("/status")
def status():
    """Reports the configured model and whether the LLM server is reachable."""
    cfg = _settings()
    try:
        r = httpx.get(f"{cfg['base_url']}/models", headers=_headers(cfg), timeout=3)
        r.raise_for_status()
        return {"ok": True, "model": cfg["model"]}
    except httpx.HTTPError as e:
        return {"ok": False, "model": cfg["model"], "detail": f"{type(e).__name__}: {e}"}


@router.post("/chat")
def chat(req: ChatRequest):
    cfg = _settings()
    if req.messages[-1].role != "user":
        raise HTTPException(422, "Last message must be from the user")
    payload = {
        "model": cfg["model"],
        "messages": build_messages(req),
        "temperature": 0.1,
        "stream": False,
    }
    try:
        r = httpx.post(
            f"{cfg['base_url']}/chat/completions", json=payload, headers=_headers(cfg), timeout=180
        )
    except httpx.HTTPError as e:
        raise HTTPException(
            503,
            f"Cannot reach the language model at {cfg['base_url']} ({type(e).__name__}). "
            f"Start it (for Ollama: `ollama serve` and `ollama pull {cfg['model']}`).",
        )
    if r.status_code != 200:
        raise HTTPException(502, f"Language model error {r.status_code}: {r.text[:300]}")
    try:
        answer = r.json()["choices"][0]["message"]["content"]
    except (KeyError, IndexError, ValueError):
        raise HTTPException(502, "Language model returned an unexpected response")
    return {"answer": (answer or "").strip(), "model": cfg["model"]}
