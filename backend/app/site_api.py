"""Site-report API. SkyCiv credentials stay on the server.

The browser sends a coordinate and design choices. The username and key
are read from the environment or a gitignored ``API_Key.txt``. They are
never accepted from the client and are removed from any error text.
"""

from __future__ import annotations

import os
import sys
import threading
import time
from pathlib import Path

from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "code"))

from skyciv_load_generator import LoadGenerator, SiteLoads, SkyCivError  # noqa: E402

SITE_CLASSES = {
    "asce7-22": {"A", "B", "BC", "C", "CD", "D", "DE", "E"},
    "asce7-16": {"A", "B", "C", "D", "D-default", "E"},
}
RISK_CATEGORIES = {"I", "II", "III", "IV"}
WINDOW_SECONDS = 3600
IP_LIMIT = 12
GLOBAL_LIMIT = 40

router = APIRouter()
_lock = threading.Lock()
_hits: dict[str, list[float]] = {}
_global_hits: list[float] = []


class SiteReportRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    lat: float
    lng: float
    designCode: str = "asce7-22"
    riskCategory: str = "II"
    siteClass: str = "D"


def cors_origins() -> list[str]:
    configured = os.getenv("API_CORS_ORIGINS", "").strip()
    if configured:
        return [item.strip() for item in configured.split(",") if item.strip()]
    return [
        "http://localhost:5180",
        "http://127.0.0.1:5180",
        "https://mattuan36.github.io",
    ]


def _in_service_box(lat: float, lng: float) -> bool:
    if not 17 <= lat <= 72:
        return False
    return -180 <= lng <= -64 or 170 <= lng <= 180


def _allow(ip: str) -> bool:
    if ip in {"127.0.0.1", "::1", "testclient"}:
        return True
    now = time.monotonic()

    def fresh(stamps: list[float]) -> list[float]:
        return [stamp for stamp in stamps if now - stamp < WINDOW_SECONDS]

    with _lock:
        recent = fresh(_global_hits)
        mine = fresh(_hits.get(ip, []))
        if len(recent) >= GLOBAL_LIMIT or len(mine) >= IP_LIMIT:
            _global_hits[:] = recent
            _hits[ip] = mine
            return False
        recent.append(now)
        mine.append(now)
        _global_hits[:] = recent
        _hits[ip] = mine
        return True


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip() or "unknown"
    if request.client is None:
        return "unknown"
    return request.client.host


def _scrub(value: object, secret: str) -> object:
    if not secret or not isinstance(value, str):
        if isinstance(value, dict):
            return {key: _scrub(item, secret) for key, item in value.items()}
        if isinstance(value, list):
            return [_scrub(item, secret) for item in value]
        return value
    return value.replace(secret, "***")


def _report(loads: SiteLoads, secret: str) -> dict:
    document = {
        "latitude": loads.latitude,
        "longitude": loads.longitude,
        "address": loads.address,
        "elevationM": loads.elevation_m,
        "country": loads.country,
        "designCode": loads.design_code,
        "riskCategory": loads.risk_category,
        "siteClass": loads.site_class,
        "windSpeed": loads.wind_speed,
        "windUnit": loads.wind_speed_unit,
        "windByCategory": loads.wind_by_category,
        "snow": loads.snow,
        "seismic": loads.seismic,
        "spectra": loads.spectra,
        "notes": loads.notes,
        "raw": loads.as_json(include_spectra=True),
    }
    return _scrub(document, secret)  # type: ignore[return-value]


def clear_limits() -> None:
    with _lock:
        _hits.clear()
        _global_hits.clear()


@router.get("/api/site-health")
def site_health():
    try:
        LoadGenerator()
    except SkyCivError:
        return {"ok": True, "configured": False}
    return {"ok": True, "configured": True}


@router.post("/api/site-report")
def site_report(body: SiteReportRequest, request: Request):
    if body.designCode not in SITE_CLASSES:
        raise HTTPException(400, "Design code must be asce7-22 or asce7-16.")
    if body.riskCategory not in RISK_CATEGORIES:
        raise HTTPException(400, "Risk category must be I, II, III, or IV.")
    if body.siteClass not in SITE_CLASSES[body.designCode]:
        raise HTTPException(400, "That site class is not valid for the selected design code.")
    if not -90 <= body.lat <= 90 or not -180 <= body.lng <= 180:
        raise HTTPException(400, "Latitude or longitude is outside the geographic range.")
    if not _in_service_box(body.lat, body.lng):
        raise HTTPException(
            400,
            "That coordinate is outside the United States and Puerto Rico. Alaska is included.",
        )
    if not _allow(_client_ip(request)):
        raise HTTPException(429, "Too many site reports from this network. Try again later.")
    try:
        generator = LoadGenerator()
    except SkyCivError as exc:
        raise HTTPException(503, str(exc)) from exc
    try:
        loads = generator.site_data(
            body.lat,
            body.lng,
            design_code=body.designCode,
            risk_category=body.riskCategory,
            site_class=body.siteClass,
        )
    except SkyCivError as exc:
        raise HTTPException(502, str(exc).replace(generator.key, "***")) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return _report(loads, generator.key)


def create_app() -> FastAPI:
    app = FastAPI(title="Site load API")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins(),
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type"],
    )
    app.include_router(router)
    return app


app = create_app()
