"""Round-trip tests against the docker Postgres (docker compose up -d first)."""
from fastapi.testclient import TestClient

from app.main import app


def _folder_id(client, name):
    return next(f["id"] for f in client.get("/api/folders").json() if f["name"] == name)


def test_upload_download_delete_round_trip():
    with TestClient(app) as client:
        plans = _folder_id(client, "Plans")
        project_docs = _folder_id(client, "Project Documents")
        before = {f["id"]: f["file_count"] for f in client.get("/api/folders").json()}

        payload = b"%PDF-1.4 test \x00\xff bytes"
        r = client.post(
            "/api/documents",
            data={"folder_id": str(plans)},
            files=[("files", ("S-101 Framing Plan.pdf", payload, "application/pdf"))],
        )
        assert r.status_code == 201
        doc = r.json()[0]
        assert doc["size_bytes"] == len(payload)

        # Counts are recursive: parent folder goes up too.
        after = {f["id"]: f["file_count"] for f in client.get("/api/folders").json()}
        assert after[plans] == before[plans] + 1
        assert after[project_docs] == before[project_docs] + 1

        listed = client.get("/api/documents", params={"folder_id": project_docs, "recursive": True}).json()
        assert doc["id"] in [d["id"] for d in listed]

        r = client.get(f"/api/documents/{doc['id']}/download")
        assert r.status_code == 200
        assert r.content == payload
        assert "S-101%20Framing%20Plan.pdf" in r.headers["content-disposition"]

        assert client.delete(f"/api/documents/{doc['id']}").status_code == 204
        assert client.get(f"/api/documents/{doc['id']}/download").status_code == 404
        assert client.delete(f"/api/documents/{doc['id']}").status_code == 404


def test_site_report_archive_lands_in_documents():
    with TestClient(app) as client:
        project_docs = _folder_id(client, "Project Documents")
        r = client.post(
            "/api/site-reports/archive",
            files=[
                ("files", ("Riverside_Hazard_Studio_Revit_Import.csv", b"parameter_name,value\n", "text/csv")),
                ("files", ("Riverside_Hazard_Studio_Site_Criteria.pdf", b"%PDF-1.4 archived", "application/pdf")),
            ],
        )
        assert r.status_code == 201
        body = r.json()
        assert body["folder_path"][-1] == "Site Reports"
        assert [doc["filename"] for doc in body["documents"]] == [
            "Riverside_Hazard_Studio_Revit_Import.csv",
            "Riverside_Hazard_Studio_Site_Criteria.pdf",
        ]
        listed = client.get("/api/documents", params={"folder_id": project_docs, "recursive": True}).json()
        names = {doc["filename"] for doc in listed}
        assert "Riverside_Hazard_Studio_Revit_Import.csv" in names
        assert "Riverside_Hazard_Studio_Site_Criteria.pdf" in names


def test_upload_to_missing_folder_is_404():
    with TestClient(app) as client:
        r = client.post(
            "/api/documents",
            data={"folder_id": "999999"},
            files=[("files", ("a.txt", b"x", "text/plain"))],
        )
        assert r.status_code == 404
