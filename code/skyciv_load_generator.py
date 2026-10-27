#!/usr/bin/env python3
"""Georeferenced SkyCiv Load Generator client.

Sends latitude and longitude to ``standalone.loads.getSiteData`` and
``standalone.loads.getLoads``. Request shape and design codes are documented
in ``docs/skyciv/load-gen-api/SKILL.md``.

Credentials are read from ``SKYCIV_USERNAME`` and ``SKYCIV_KEY``, or from a
gitignored ``API_Key.txt`` in the repo root. This file never contains a key.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

API_URL = "https://api.skyciv.com/v3"
SPECTRUM_KEYS = (
    "multiPeriodDesignSpectrum",
    "multiPeriodMCErSpectrum",
    "twoPeriodDesignSpectrum",
    "twoPeriodMCErSpectrum",
    "verticalDesignSpectrum",
    "verticalMCErSpectrum",
    "underlyingData",
)


class SkyCivError(RuntimeError):
    """The Load Generator call did not return usable data."""


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _read_key_file() -> dict[str, str]:
    path = _repo_root() / "API_Key.txt"
    if not path.is_file():
        return {}
    values: dict[str, str] = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        values[name.strip()] = value.strip()
    return values


def _load_env_file() -> None:
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    load_dotenv(_repo_root() / ".env")


def resolve_credentials(username: str | None = None, key: str | None = None) -> tuple[str, str]:
    """Resolve a SkyCiv username and API key without printing either."""
    _load_env_file()
    file_values = _read_key_file()
    resolved_username = (
        username
        or os.getenv("SKYCIV_USERNAME")
        or file_values.get("SKYCIV_USERNAME")
        or file_values.get("USERNAME")
    )
    resolved_key = (
        key
        or os.getenv("SKYCIV_KEY")
        or file_values.get("SKYCIV_KEY")
        or file_values.get("SKY_CIV_KEY")
    )
    if not resolved_username or not resolved_key:
        raise SkyCivError(
            "Set SKYCIV_USERNAME and SKYCIV_KEY, or add them to a gitignored API_Key.txt. "
            "Do not commit that file."
        )
    return resolved_username, resolved_key


def _validate_coords(lat: float, lng: float) -> None:
    if not -90 <= lat <= 90:
        raise ValueError(f"latitude must be between -90 and 90, got {lat}")
    if not -180 <= lng <= 180:
        raise ValueError(f"longitude must be between -180 and 180, got {lng}")


def _scrub(message: str, secret: str) -> str:
    if secret and secret in message:
        return message.replace(secret, "***")
    return message


def _post(payload: dict, secret: str, timeout: float) -> dict:
    request = urllib.request.Request(
        API_URL,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        raise SkyCivError(_scrub(f"HTTP {exc.code}: {detail}", secret)) from exc
    except urllib.error.URLError as exc:
        raise SkyCivError(f"Could not reach SkyCiv: {exc.reason}") from exc
    try:
        body = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SkyCivError("SkyCiv returned a response that was not JSON") from exc
    if not isinstance(body, dict):
        raise SkyCivError("SkyCiv returned an unexpected response")
    return body


def _interpret(body: dict) -> tuple[dict, list[str]]:
    envelope = body.get("response") if isinstance(body.get("response"), dict) else {}
    status = envelope.get("status")
    message = str(envelope.get("msg") or "").strip()
    data = envelope.get("data") if isinstance(envelope.get("data"), dict) else {}
    notes: list[str] = []

    if status not in (0, 1):
        raise SkyCivError(message or f"SkyCiv status {status}")
    if status == 1 and message:
        notes.append(message)
    if not data:
        raise SkyCivError(message or "SkyCiv returned no data")

    for function in body.get("functions") or []:
        if not isinstance(function, dict):
            continue
        function_status = function.get("status")
        function_message = str(function.get("msg") or "").strip()
        if function_status not in (0, 1, None) and not data:
            raise SkyCivError(function_message or f"{function.get('function')} failed")
        if function_status == 1 and function_message and function_message not in notes:
            notes.append(function_message)
    return data, notes


@dataclass
class SiteLoads:
    """Site wind, snow, and seismic values for one coordinate."""

    latitude: float
    longitude: float
    resolved_latitude: float | None
    resolved_longitude: float | None
    address: str | None
    elevation_m: float | None
    country: str | None
    design_code: str
    risk_category: str
    site_class: str | None
    wind_speed: float | int | str | None
    wind_speed_unit: str | None
    wind_by_category: dict
    snow: dict
    seismic: dict
    spectra: dict = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)

    def as_json(self, *, include_spectra: bool = False) -> dict:
        """JSON document whose data keys are seismic, wind, and snow."""
        seismic = dict(self.seismic)
        if include_spectra and self.spectra:
            seismic["spectra"] = self.spectra
        document = {
            "seismic": seismic,
            "wind": {
                "wind_speed": self.wind_speed,
                "wind_speed_unit": self.wind_speed_unit,
                "all_wind_speed": self.wind_by_category,
            },
            "snow": self.snow,
            "site": {
                "latitude": self.latitude,
                "longitude": self.longitude,
                "resolved_latitude": self.resolved_latitude,
                "resolved_longitude": self.resolved_longitude,
                "address": self.address,
                "elevation_m": self.elevation_m,
                "country": self.country,
                "design_code": self.design_code,
                "risk_category": self.risk_category,
                "site_class": self.site_class,
            },
        }
        if self.notes:
            document["notes"] = self.notes
        return document


class LoadGenerator:
    """Client for the SkyCiv Load Generator, located by latitude and longitude."""

    def __init__(
        self,
        username: str | None = None,
        key: str | None = None,
        *,
        validate_input: bool = True,
        api_version: float = 2.1,
        timeout: float = 120,
    ) -> None:
        self.username, self.key = resolve_credentials(username, key)
        self.validate_input = validate_input
        self.api_version = api_version
        self.timeout = timeout

    def site_data(
        self,
        lat: float,
        lng: float,
        *,
        design_code: str = "asce7-22",
        risk_category: str = "II",
        site_class: str | None = None,
        **extra_site: object,
    ) -> SiteLoads:
        """Return wind, snow, and seismic parameters for a coordinate.

        ``site_class`` is required for ASCE 7 seismic values. Without it the
        API returns an empty ``seismic_data`` object.
        """
        _validate_coords(lat, lng)
        site = {
            "design_code": design_code,
            "lat": lat,
            "lng": lng,
            "risk_category": risk_category,
        }
        if site_class:
            site["site_class"] = site_class
        site.update(extra_site)
        site.pop("project_address", None)

        data, notes = self._call(
            [
                {
                    "function": "standalone.loads.getSiteData",
                    "arguments": {"site_data": site, "api_version": self.api_version},
                }
            ]
        )
        return _site_loads(lat, lng, design_code, risk_category, site_class, data, notes)

    def loads(
        self,
        lat: float,
        lng: float,
        building_data: dict,
        *,
        design_code: str = "asce7-22",
        risk_category: str = "II",
        site_class: str | None = None,
        project_details: dict | None = None,
        site_data: dict | None = None,
        report: bool = False,
    ) -> dict:
        """Run ``getLoads`` for a building at a coordinate.

        ``building_data`` follows ``docs/skyciv/load-gen-api/SKILL.md``. Any
        ``project_address`` in ``site_data`` is dropped so the call stays tied
        to ``lat`` and ``lng``. Set ``report`` to include the viewable report link.
        """
        _validate_coords(lat, lng)
        site = dict(site_data or {})
        site.pop("project_address", None)
        site["design_code"] = design_code
        site["lat"] = lat
        site["lng"] = lng
        site["risk_category"] = risk_category
        if site_class:
            site["site_class"] = site_class

        arguments: dict = {
            "project_details": project_details or {"units": "imperial"},
            "site_data": site,
            "building_data": building_data,
            "api_version": self.api_version,
            "report": report,
        }
        data, notes = self._call(
            [{"function": "standalone.loads.getLoads", "arguments": arguments}]
        )
        return {"latitude": lat, "longitude": lng, "data": data, "notes": notes}

    def _call(self, functions: list[dict]) -> tuple[dict, list[str]]:
        payload = {
            "auth": {"username": self.username, "key": self.key},
            "options": {"validate_input": self.validate_input},
            "functions": [
                {"function": "standalone.loads.start", "arguments": {"keep_open": False}},
                *functions,
            ],
        }
        body = _post(payload, self.key, self.timeout)
        try:
            return _interpret(body)
        except SkyCivError as exc:
            raise SkyCivError(_scrub(str(exc), self.key)) from exc


def _site_loads(
    lat: float,
    lng: float,
    design_code: str,
    risk_category: str,
    site_class: str | None,
    data: dict,
    notes: list[str],
) -> SiteLoads:
    site = data.get("site_data") if isinstance(data.get("site_data"), dict) else {}
    wind = data.get("wind_data") if isinstance(data.get("wind_data"), dict) else {}
    snow = data.get("snow_data") if isinstance(data.get("snow_data"), dict) else {}
    seismic_raw = data.get("seismic_data") if isinstance(data.get("seismic_data"), dict) else {}

    by_category = wind.get("all_wind_speed")
    if not isinstance(by_category, dict):
        by_category = {}
    selected = by_category.get(risk_category, wind.get("wind_speed"))
    headline = wind.get("wind_speed")
    if selected is not None and headline is not None and selected != headline:
        notes.append(
            f"wind_data.wind_speed is {headline}, which is not risk category {risk_category}. "
            f"Reported wind speed is all_wind_speed[{risk_category}] = {selected}."
        )
    if design_code.startswith("asce7") and not site_class and not seismic_raw:
        notes.append("site_class was omitted, so ASCE 7 seismic parameters are empty.")

    spectra = {name: seismic_raw[name] for name in SPECTRUM_KEYS if name in seismic_raw}
    seismic = {name: value for name, value in seismic_raw.items() if name not in SPECTRUM_KEYS}

    return SiteLoads(
        latitude=lat,
        longitude=lng,
        resolved_latitude=site.get("lat"),
        resolved_longitude=site.get("lng"),
        address=site.get("formatted_address"),
        elevation_m=site.get("elevation"),
        country=site.get("country"),
        design_code=design_code,
        risk_category=risk_category,
        site_class=site_class,
        wind_speed=selected,
        wind_speed_unit=wind.get("wind_speed_unit"),
        wind_by_category=by_category,
        snow=snow,
        seismic=seismic,
        spectra=spectra,
        notes=notes,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Georeferenced SkyCiv Load Generator site check"
    )
    parser.add_argument("--lat", type=float, required=True, help="Latitude")
    parser.add_argument("--lng", type=float, required=True, help="Longitude")
    parser.add_argument("--design-code", default="asce7-22")
    parser.add_argument("--risk-category", default="II")
    parser.add_argument("--site-class", default=None)
    parser.add_argument(
        "--full",
        action="store_true",
        help="Include response spectra in the seismic object",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Write the JSON document to this path instead of stdout",
    )
    args = parser.parse_args(argv)
    try:
        result = LoadGenerator().site_data(
            args.lat,
            args.lng,
            design_code=args.design_code,
            risk_category=args.risk_category,
            site_class=args.site_class,
        )
    except (SkyCivError, ValueError) as exc:
        print(exc, file=sys.stderr)
        return 1

    text = json.dumps(result.as_json(include_spectra=args.full), indent=2) + "\n"
    if args.output:
        args.output.write_text(text)
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
