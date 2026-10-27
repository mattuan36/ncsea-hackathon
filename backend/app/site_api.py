"""Site-report API. SkyCiv credentials stay on the server.

The browser sends a coordinate and design choices. The username and key
are read from the environment or a gitignored ``API_Key.txt``. They are
never accepted from the client and are removed from any error text.
"""

from __future__ import annotations

import math
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .seismic_api import router as seismic_router

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "code"))

from calculation import SeismicInput, calculate  # noqa: E402
from skyciv_load_generator import LoadGenerator, SiteLoads, SkyCivError  # noqa: E402

SITE_CLASSES = {
    "asce7-22": {"A", "B", "BC", "C", "CD", "D", "DE", "E"},
    "asce7-16": {"A", "B", "C", "D", "D-default", "E"},
}
COMPARE_CLASSES = ("A", "B", "BC", "C", "CD", "D", "DE", "E")
SDC_LETTERS = {"A", "B", "C", "D", "E", "F"}
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


class KnownSiteClass(BaseModel):
    model_config = ConfigDict(extra="ignore")

    siteClass: str
    sds: float = Field(ge=0, le=10)
    sd1: float = Field(ge=0, le=10)
    s1: float = Field(ge=0, le=10)
    tl: float = Field(gt=0, le=100)
    sdc: str = ""


class SiteClassCompareRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    lat: float
    lng: float
    designCode: str = "asce7-22"
    riskCategory: str = "II"
    inputs: SeismicInput
    known: list[KnownSiteClass] = Field(default_factory=list, max_length=8)


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


def _fresh(stamps: list[float], now: float) -> list[float]:
    return [stamp for stamp in stamps if now - stamp < WINDOW_SECONDS]


def _allow(ip: str) -> bool:
    return _reserve(ip, 1)


def _reserve(ip: str, global_hits: int) -> bool:
    """Count one request against the per-network cap and ``global_hits`` against the hourly cap.

    Local and test clients are not counted. ``global_hits`` is 1 for a single
    site report. A site-class comparison passes 1 plus each live SkyCiv call.
    """
    if ip in {"127.0.0.1", "::1", "testclient"}:
        return True
    cost = max(1, global_hits)
    now = time.monotonic()
    with _lock:
        recent = _fresh(_global_hits, now)
        mine = _fresh(_hits.get(ip, []), now)
        if len(recent) + cost > GLOBAL_LIMIT or len(mine) >= IP_LIMIT:
            _global_hits[:] = recent
            _hits[ip] = mine
            return False
        recent.extend([now] * cost)
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


def _check_site(lat: float, lng: float) -> None:
    if not -90 <= lat <= 90 or not -180 <= lng <= 180:
        raise HTTPException(400, "Latitude or longitude is outside the geographic range.")
    if not _in_service_box(lat, lng):
        raise HTTPException(
            400,
            "That coordinate is outside the United States and Puerto Rico. Alaska is included.",
        )


def _sdc_letter(value: object) -> str:
    text = str(value or "").strip().upper()
    return text if text in SDC_LETTERS else ""


def _scalar(seismic: dict, key: str) -> float | None:
    folded = {str(name).lower(): item for name, item in seismic.items()}
    raw = folded.get(key)
    if raw is None or raw == "":
        return None
    try:
        number = float(raw)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return number


def _scalars(seismic: dict) -> tuple[dict | None, str | None]:
    values = {key: _scalar(seismic, key) for key in ("sds", "sd1", "s1", "tl")}
    missing = [key.upper() for key, value in values.items() if value is None]
    if missing:
        return None, f"SkyCiv did not return {', '.join(missing)}."
    if values["tl"] <= 0:
        return None, "SkyCiv returned a long-period transition that is not greater than zero."
    folded = {str(name).lower(): item for name, item in seismic.items()}
    return {**values, "sdc": _sdc_letter(folded.get("sdc"))}, None


def _fetch_class(generator: LoadGenerator, lat: float, lng: float, risk: str, site_class: str):
    try:
        loads = generator.site_data(
            lat,
            lng,
            design_code="asce7-22",
            risk_category=risk,
            site_class=site_class,
        )
    except SkyCivError as exc:
        return site_class, None, str(exc).replace(generator.key, "***")
    except Exception as exc:
        return site_class, None, str(exc).replace(generator.key, "***")
    scalars, error = _scalars(loads.seismic if isinstance(loads.seismic, dict) else {})
    return site_class, scalars, error


def _calculate_row(site_class: str, scalars: dict | None, error: str | None, inputs: SeismicInput, risk: str) -> dict:
    row = {
        "siteClass": site_class,
        "sds": None if scalars is None else scalars["sds"],
        "sd1": None if scalars is None else scalars["sd1"],
        "s1": None if scalars is None else scalars["s1"],
        "tl": None if scalars is None else scalars["tl"],
        "sdc": "" if scalars is None else scalars["sdc"],
        "error": error,
        "result": None,
    }
    if scalars is None or error:
        return row
    try:
        calculated = calculate(inputs.model_copy(update={
            "sds": scalars["sds"],
            "sd1": scalars["sd1"],
            "s1": scalars["s1"],
            "tl": scalars["tl"],
            "site_class": site_class,
            "risk_category": risk,
            "part1_sdc": scalars["sdc"],
        }))
    except ValidationError as exc:
        messages = exc.errors()
        row["error"] = messages[0]["msg"] if messages else "Hazard values are outside the calculation range."
        return row
    except Exception as exc:
        row["error"] = str(exc)
        return row
    row["result"] = calculated
    return row


@router.post("/api/site-report/site-classes")
def site_class_comparison(body: SiteClassCompareRequest, request: Request):
    if body.designCode != "asce7-22":
        raise HTTPException(400, "Site class comparison calculates ASCE 7-22 only.")
    if body.riskCategory not in RISK_CATEGORIES:
        raise HTTPException(400, "Risk category must be I, II, III, or IV.")
    _check_site(body.lat, body.lng)
    known = {
        item.siteClass: item
        for item in body.known
        if item.siteClass in COMPARE_CLASSES
    }
    live = [site_class for site_class in COMPARE_CLASSES if site_class not in known]
    fetched: dict[str, tuple[dict | None, str | None]] = {}
    secret = ""
    generator = None
    if live:
        try:
            generator = LoadGenerator()
        except SkyCivError as exc:
            raise HTTPException(503, str(exc)) from exc
        secret = generator.key
    if not _reserve(_client_ip(request), 1 + len(live)):
        raise HTTPException(429, "Too many site reports from this network. Try again later.")
    if generator is not None:
        with ThreadPoolExecutor(max_workers=len(live)) as pool:
            futures = [
                pool.submit(_fetch_class, generator, body.lat, body.lng, body.riskCategory, site_class)
                for site_class in live
            ]
            for future in as_completed(futures):
                site_class, scalars, error = future.result()
                fetched[site_class] = (scalars, error)

    rows = []
    for site_class in COMPARE_CLASSES:
        if site_class in known:
            item = known[site_class]
            scalars = {
                "sds": item.sds,
                "sd1": item.sd1,
                "s1": item.s1,
                "tl": item.tl,
                "sdc": _sdc_letter(item.sdc),
            }
            rows.append(_calculate_row(site_class, scalars, None, body.inputs, body.riskCategory))
            continue
        scalars, error = fetched.get(site_class, (None, "Site class was not returned."))
        rows.append(_calculate_row(site_class, scalars, error, body.inputs, body.riskCategory))
    return _scrub({"siteClasses": rows}, secret)


def create_app() -> FastAPI:
    app = FastAPI(title="Site load API")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins(),
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type"],
    )
    app.include_router(router)
    app.include_router(seismic_router)
    return app


app = create_app()
