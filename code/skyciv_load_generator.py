#!/usr/bin/env python3
"""Georeferenced SkyCiv Load Generator client.

This module calls the SkyCiv v3 API at ``https://api.skyciv.com/v3`` and
always locates the site with latitude and longitude. It does not send a
street address. Two calls are wrapped:

* ``LoadGenerator.site_data`` runs ``standalone.loads.getSiteData`` and
  returns wind, snow, and seismic values for that coordinate.
* ``LoadGenerator.loads`` runs ``standalone.loads.getLoads`` for a building
  placed on that same coordinate.

Every request starts with ``standalone.loads.start``. ``S3D.session.start``
does not open a Load Generator session. Design codes, ``site_data``, and
``building_data`` are specified in ``docs/skyciv/load-gen-api/SKILL.md``.
The auth envelope is in ``docs/skyciv/skyciv-api-v3/SKILL.md``.

Credentials are read from the ``username`` and ``key`` arguments, then
``SKYCIV_USERNAME`` and ``SKYCIV_KEY`` in the environment or a ``.env``
file, then a gitignored ``API_Key.txt`` in the repo root. This file never
contains a key, and error text has the key removed before it is raised.

Run the site check from the repo root:

    python code/skyciv_load_generator.py --lat 37.795143 --lng -122.404312 --site-class D

The command prints one JSON object with ``seismic``, ``wind``, and ``snow``.
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
    """The Load Generator call failed or returned no usable data.

    Raised for a missing credential, an HTTP error, a non-JSON body, or a
    SkyCiv ``response.status`` other than 0 (success) or 1 (warning with
    data). The message never includes the API key.
    """


def _repo_root() -> Path:
    """Return the repository root, the parent of the ``code`` directory.

    Credential files and ``.env`` are resolved from this directory so the
    script works when it is launched from another working directory.
    """
    return Path(__file__).resolve().parent.parent


def _read_key_file() -> dict[str, str]:
    """Read ``API_Key.txt`` in the repo root as ``NAME=value`` lines.

    Blank lines and ``#`` comments are ignored. A missing file returns an
    empty mapping so the caller can fall through to the environment.
    The file is gitignored and must not be committed.

    Returns:
        Mapping of the names found in the file. Typical names are
        ``USERNAME`` and ``SKY_CIV_KEY``.
    """
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
    """Load the repo-root ``.env`` when ``python-dotenv`` is installed.

    Existing environment variables are left unchanged. If dotenv is not
    installed, credentials still come from the process environment or
    ``API_Key.txt``.
    """
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    load_dotenv(_repo_root() / ".env")


def resolve_credentials(username: str | None = None, key: str | None = None) -> tuple[str, str]:
    """Resolve a SkyCiv username and API key without printing either.

    Lookup order for each value is the explicit argument, then the
    environment (after ``.env`` is loaded), then ``API_Key.txt``.
    Username names are ``SKYCIV_USERNAME`` and ``USERNAME``. Key names are
    ``SKYCIV_KEY`` and ``SKY_CIV_KEY``.

    Args:
        username: Account email. Skips lookup when provided.
        key: API key from the SkyCiv account settings. Skips lookup when provided.

    Returns:
        The username and key to place in the request ``auth`` object.

    Raises:
        SkyCivError: Either value is missing after every lookup.
    """
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
    """Reject a latitude or longitude outside the geographic range.

    Args:
        lat: Decimal degrees, from -90 (south) to 90 (north).
        lng: Decimal degrees, from -180 (west) to 180 (east).

    Raises:
        ValueError: ``lat`` or ``lng`` is outside that range.
    """
    if not -90 <= lat <= 90:
        raise ValueError(f"latitude must be between -90 and 90, got {lat}")
    if not -180 <= lng <= 180:
        raise ValueError(f"longitude must be between -180 and 180, got {lng}")


def _scrub(message: str, secret: str) -> str:
    """Remove the API key from ``message`` before it can be logged or raised.

    Args:
        message: Text that might echo the request, including the key.
        secret: The key to replace. An empty secret leaves ``message`` as it is.

    Returns:
        ``message`` with every copy of ``secret`` replaced by ``***``.
    """
    if secret and secret in message:
        return message.replace(secret, "***")
    return message


def _post(payload: dict, secret: str, timeout: float) -> dict:
    """POST one JSON body to the SkyCiv v3 endpoint.

    Args:
        payload: The full request, including ``auth``, ``options``, and ``functions``.
        secret: API key stripped from any HTTP error body.
        timeout: Seconds to wait for the response. Site calls often take about 20 seconds.

    Returns:
        The decoded JSON object.

    Raises:
        SkyCivError: The HTTP call failed, the body was not a JSON object, or the host was unreachable.
    """
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
    """Pull the last function's data out of a SkyCiv response.

    Status 0 is success. Status 1 is a warning: the data is kept and the
    message is returned as a note. Any other status, or a body with no
    ``response.data`` object, is a failure. Per-function warning text is
    collected the same way.

    Args:
        body: Decoded response from ``_post``.

    Returns:
        The ``response.data`` object and the warning strings, if any.

    Raises:
        SkyCivError: The call failed or returned no data object.
    """
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
    """Wind, snow, and seismic values for one coordinate.

    ``latitude`` and ``longitude`` are the values sent to SkyCiv.
    ``resolved_latitude``, ``resolved_longitude``, ``address``, and
    ``elevation_m`` are what SkyCiv returned for that point. Elevation is
    in meters. ``wind_speed`` is the entry in ``wind_by_category`` for
    ``risk_category``, not the API's headline speed when those differ.
    ``seismic`` holds the scalar design parameters. Response spectra stay
    in ``spectra`` until ``as_json`` is asked to include them.

    Attributes:
        latitude: Requested latitude in decimal degrees.
        longitude: Requested longitude in decimal degrees.
        resolved_latitude: Latitude SkyCiv associated with the site.
        resolved_longitude: Longitude SkyCiv associated with the site.
        address: Formatted address SkyCiv resolved from the coordinate.
        elevation_m: Site elevation in meters.
        country: Country name from the site record.
        design_code: API design code used for the call, such as ``asce7-22``.
        risk_category: ASCE risk category used to pick ``wind_speed``.
        site_class: Site class sent for seismic coefficients. ``None`` if omitted.
        wind_speed: Speed for ``risk_category`` from ``all_wind_speed``.
        wind_speed_unit: Unit string from the API, usually ``mph``.
        wind_by_category: Speeds keyed by risk category and return period.
        snow: Ground-snow fields from ``snow_data``.
        seismic: Scalar seismic parameters, without spectrum arrays.
        spectra: Multi-period and two-period spectrum arrays.
        notes: Warnings, including a mismatched headline wind speed.
    """

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
        """Build the site-check document.

        The first three keys are always ``seismic``, ``wind``, and ``snow``.
        ``site`` records the requested coordinate and the address SkyCiv
        resolved. ``notes`` is included only when the call produced warnings.

        Args:
            include_spectra: When true, copy ``spectra`` onto ``seismic``
                under the key ``spectra``. The default leaves those arrays out
                so the document stays a summary of the design parameters.

        Returns:
            A JSON-ready dictionary. Spectrum arrays are omitted unless
            ``include_spectra`` is true.
        """
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
    """Client for one SkyCiv account.

    Each public method sends its own session: ``standalone.loads.start``
    with ``keep_open`` false, then one load function. The site is always
    passed as ``lat`` and ``lng``. A ``project_address`` on the site object
    is removed so a caller cannot switch the call back to geocoding.

    Args:
        username: SkyCiv account email. Looked up when omitted.
        key: SkyCiv API key. Looked up when omitted.
        validate_input: Ask SkyCiv to validate the payload before it runs.
        api_version: Load Generator payload version. The current default is 2.1.
        timeout: Seconds allowed for one HTTP call.
    """

    def __init__(
        self,
        username: str | None = None,
        key: str | None = None,
        *,
        validate_input: bool = True,
        api_version: float = 2.1,
        timeout: float = 120,
    ) -> None:
        """Store credentials and the options applied to every call.

        Args:
            username: SkyCiv account email. Looked up when omitted.
            key: SkyCiv API key. Looked up when omitted.
            validate_input: Ask SkyCiv to validate the payload before it runs.
            api_version: Load Generator payload version. The current default is 2.1.
            timeout: Seconds allowed for one HTTP call.
        """
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

        This calls ``standalone.loads.getSiteData``. For ASCE 7, pass
        ``site_class`` or ``seismic`` comes back empty. On ASCE 7-16, Site
        Class D with ``S1`` of at least 0.2 can omit ``Fv``, ``SM1``, and
        ``SD1`` and cite Section 11.4.8. Extra keyword arguments are copied
        onto ``site_data`` for code-specific fields such as ``exposure``.

        Args:
            lat: Latitude in decimal degrees.
            lng: Longitude in decimal degrees.
            design_code: API code, for example ``asce7-22`` or ``asce7-16``.
            risk_category: ASCE risk category ``I``, ``II``, ``III``, or ``IV``.
            site_class: Seismic site class. Required for ASCE 7 seismic values.
            **extra_site: Further ``site_data`` fields. ``project_address`` is dropped.

        Returns:
            A ``SiteLoads`` value whose ``as_json`` method is the command output.
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
        """Run ``standalone.loads.getLoads`` for a building at a coordinate.

        ``building_data`` follows ``docs/skyciv/load-gen-api/SKILL.md`` and
        should name the structure, roof, dimensions, and which of wind, snow,
        and seismic to calculate. Any ``project_address`` in ``site_data`` is
        dropped so the call stays tied to ``lat`` and ``lng``.

        Args:
            lat: Latitude in decimal degrees.
            lng: Longitude in decimal degrees.
            building_data: Structure geometry and the load parameters to run.
            design_code: API code written onto ``site_data``.
            risk_category: ASCE risk category written onto ``site_data``.
            site_class: Seismic site class. Required for ASCE 7 seismic values.
            project_details: Report header. Defaults to imperial units.
            site_data: Extra site fields merged under the coordinate.
            report: When true, SkyCiv includes a viewable report link.

        Returns:
            ``latitude``, ``longitude``, the raw ``data`` object, and ``notes``.
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
        """Open a Load Generator session and run ``functions`` inside it.

        ``standalone.loads.start`` is always first. The session is not kept
        open. The API key is stripped from any ``SkyCivError`` raised while
        the body is interpreted.

        Args:
            functions: Load functions that follow the session start. Each item
                has ``function`` and ``arguments``.

        Returns:
            Data from the last function, plus warning strings.

        Raises:
            SkyCivError: The session or the load function failed.
        """
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
    """Map a ``getSiteData`` payload onto ``SiteLoads``.

    Wind for the requested risk category is taken from
    ``wind_data.all_wind_speed``. When that value differs from the API's
    scalar ``wind_speed``, a note records both numbers. The scalar has been
    the Category IV speed even when Category II was requested. Spectrum
    arrays are split into ``spectra`` so the scalar seismic map stays small.
    An ASCE call with no site class and an empty seismic object gets a note
    explaining that the class is required.

    Args:
        lat: Latitude that was sent.
        lng: Longitude that was sent.
        design_code: Design code that was sent.
        risk_category: Risk category used to choose the reported wind speed.
        site_class: Site class that was sent, or ``None``.
        data: ``response.data`` from ``getSiteData``.
        notes: Warnings already collected from the response. This function may append more.

    Returns:
        The structured site result.
    """
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
    """Run a georeferenced site check and write its JSON document.

    Arguments are the command-line flags. ``--output`` writes the document
    to a file; otherwise it is written to stdout. ``--full`` includes
    ``seismic.spectra``. Failures are printed to stderr and return 1.

    Args:
        argv: Flags to parse. ``None`` reads ``sys.argv``.

    Returns:
        ``0`` when the JSON document was written, ``1`` when the call or the
        coordinates were rejected.
    """
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
