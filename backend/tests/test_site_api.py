"""The site API keeps SkyCiv credentials off the response."""

from fastapi.testclient import TestClient

from app import site_api
from skyciv_load_generator import SiteLoads, SkyCivError


class FakeGenerator:
    def __init__(self) -> None:
        self.username = "person@example.com"
        self.key = "super-secret"

    def site_data(self, lat, lng, **kwargs):
        return SiteLoads(
            latitude=lat,
            longitude=lng,
            resolved_latitude=lat,
            resolved_longitude=lng,
            address="1 super-secret street",
            elevation_m=12,
            country="United States",
            design_code=kwargs["design_code"],
            risk_category=kwargs["risk_category"],
            site_class=kwargs["site_class"],
            wind_speed=99,
            wind_speed_unit="mph",
            wind_by_category={"II": 99},
            snow={"ground_snow_load": 0},
            seismic={"sdc": "D", "sds": 1.0, "sd1": 0.6},
            spectra={},
            notes=["echo super-secret"],
        )


def test_report_scrubs_the_key(monkeypatch):
    monkeypatch.setattr(site_api, "LoadGenerator", FakeGenerator)
    site_api.clear_limits()
    with TestClient(site_api.app) as client:
        response = client.post(
            "/api/site-report",
            json={
                "lat": 37.795143,
                "lng": -122.404312,
                "designCode": "asce7-22",
                "riskCategory": "II",
                "siteClass": "D",
                "key": "should-be-ignored",
                "username": "should-be-ignored",
            },
        )
    assert response.status_code == 200
    body = response.json()
    assert body["windSpeed"] == 99
    assert "super-secret" not in response.text
    assert body["address"] == "1 *** street"
    assert body["notes"] == ["echo ***"]


def test_rejects_a_coordinate_outside_the_service_area():
    site_api.clear_limits()
    with TestClient(site_api.app) as client:
        response = client.post("/api/site-report", json={"lat": 48.8, "lng": 2.3, "siteClass": "D"})
    assert response.status_code == 400


COMPARE_CLASSES = ["A", "B", "BC", "C", "CD", "D", "DE", "E"]
SDS_BY_CLASS = {"A": 0.2, "B": 0.35, "BC": 0.5, "C": 0.7, "CD": 0.9, "D": 1.1, "DE": 1.3, "E": 1.5}


def compare_body(known=None, design_code="asce7-22"):
    return {
        "lat": 37.795143,
        "lng": -122.404312,
        "designCode": design_code,
        "riskCategory": "II",
        "known": known or [],
        "inputs": {
            "project_number": "P",
            "asce_edition": "7-22",
            "source_status": "SKYCIV_GETSITEDATA",
            "sds": 1.0,
            "sd1": 0.6,
            "s1": 0.4,
            "tl": 8,
            "risk_category": "II",
            "site_class": "D",
            "part1_sdc": "D",
            "hn_ft": 30,
            "directions": [
                {"direction": "X", "combination": "single", "system_ids": ["B2"]},
                {"direction": "Y", "combination": "single", "system_ids": ["C1"], "moment_frames_resist_100pct": True},
            ],
        },
    }


def loads_for(lat, lng, **kwargs):
    site_class = kwargs["site_class"]
    sds = SDS_BY_CLASS[site_class]
    return SiteLoads(
        latitude=lat,
        longitude=lng,
        resolved_latitude=lat,
        resolved_longitude=lng,
        address="1 super-secret street",
        elevation_m=12,
        country="United States",
        design_code=kwargs["design_code"],
        risk_category=kwargs["risk_category"],
        site_class=site_class,
        wind_speed=99,
        wind_speed_unit="mph",
        wind_by_category={"II": 99},
        snow={},
        seismic={"sdc": "D", "sds": sds, "sd1": 2.0, "s1": 0.2, "tl": 12, "spectra": [1, 2, 3]},
        spectra={"multi": {"periods": [0, 1], "ordinates": [1, 1]}},
        notes=["echo super-secret"],
    )


class MatrixGenerator:
    def __init__(self) -> None:
        self.username = "person@example.com"
        self.key = "super-secret"
        self.calls: list[str] = []

    def site_data(self, lat, lng, **kwargs):
        self.calls.append(kwargs["site_class"])
        if kwargs["site_class"] == "E":
            raise SkyCivError("site class E failed super-secret")
        return loads_for(lat, lng, **kwargs)


def test_site_classes_returns_every_class_and_cs_follows_sds(monkeypatch):
    generator = MatrixGenerator()
    monkeypatch.setattr(site_api, "LoadGenerator", lambda: generator)
    site_api.clear_limits()
    with TestClient(site_api.app) as client:
        response = client.post("/api/site-report/site-classes", json=compare_body())
    assert response.status_code == 200
    rows = response.json()["siteClasses"]
    assert [row["siteClass"] for row in rows] == COMPARE_CLASSES
    usable = [row for row in rows if row["siteClass"] != "E"]
    assert [row["sds"] for row in usable] == [SDS_BY_CLASS[row["siteClass"]] for row in usable]
    cs = [row["result"]["directions"]["X"]["cs"] for row in usable]
    assert cs == sorted(cs)
    assert cs[0] < cs[-1]
    assert all("Y" in row["result"]["directions"] for row in usable)
    failed = rows[-1]
    assert failed["siteClass"] == "E"
    assert failed["result"] is None
    assert "super-secret" not in response.text
    assert failed["error"] == "site class E failed ***"
    assert "spectra" not in response.json()
    assert generator.calls.count("D") == 1


def test_known_site_class_is_not_requested(monkeypatch):
    generator = MatrixGenerator()
    monkeypatch.setattr(site_api, "LoadGenerator", lambda: generator)
    site_api.clear_limits()
    known = [{"siteClass": "D", "sds": 0.42, "sd1": 2.0, "s1": 0.2, "tl": 12, "sdc": "C"}]
    with TestClient(site_api.app) as client:
        response = client.post("/api/site-report/site-classes", json=compare_body(known))
    assert response.status_code == 200
    assert "D" not in generator.calls
    row = next(item for item in response.json()["siteClasses"] if item["siteClass"] == "D")
    assert row["sds"] == 0.42
    assert row["sdc"] == "C"
    assert row["result"]["directions"]["X"]["cs"] > 0


def test_cached_hazards_do_not_call_skyciv(monkeypatch):
    def explode():
        raise AssertionError("SkyCiv should not be called")

    monkeypatch.setattr(site_api, "LoadGenerator", explode)
    site_api.clear_limits()
    known = [
        {"siteClass": site_class, "sds": SDS_BY_CLASS[site_class], "sd1": 2.0, "s1": 0.2, "tl": 12, "sdc": "D"}
        for site_class in COMPARE_CLASSES
    ]
    with TestClient(site_api.app) as client:
        response = client.post("/api/site-report/site-classes", json=compare_body(known))
    assert response.status_code == 200
    assert all(row["result"]["directions"]["X"]["cs"] > 0 for row in response.json()["siteClasses"])


def test_site_class_comparison_rejects_asce_7_16():
    site_api.clear_limits()
    with TestClient(site_api.app) as client:
        response = client.post("/api/site-report/site-classes", json=compare_body(design_code="asce7-16"))
    assert response.status_code == 400


def test_comparison_charges_one_network_hit_and_each_live_call():
    site_api.clear_limits()
    assert site_api._reserve("203.0.113.5", 1 + 7)
    assert len(site_api._hits["203.0.113.5"]) == 1
    assert len(site_api._global_hits) == 8
    site_api._global_hits.extend([site_api.time.monotonic()] * 33)
    assert site_api._reserve("203.0.113.6", 1 + 7) is False


def test_missing_credentials_do_not_call_skyciv(monkeypatch):
    class Missing:
        def __init__(self) -> None:
            raise SkyCivError(
                "Set SKYCIV_USERNAME and SKYCIV_KEY, or add them to a gitignored API_Key.txt. "
                "Do not commit that file."
            )

    monkeypatch.setattr(site_api, "LoadGenerator", Missing)
    site_api.clear_limits()
    with TestClient(site_api.app) as client:
        response = client.post(
            "/api/site-report",
            json={"lat": 37.79, "lng": -122.40, "designCode": "asce7-22", "riskCategory": "II", "siteClass": "D"},
        )
    assert response.status_code == 503
    assert "API key" not in response.text.lower() or "commit" in response.text.lower()
