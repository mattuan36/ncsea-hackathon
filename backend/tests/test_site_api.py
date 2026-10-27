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
