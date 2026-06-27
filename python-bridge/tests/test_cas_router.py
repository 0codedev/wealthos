"""Integration test for /api/cas/parse endpoint (CC51)."""
import io
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from app import app
    return TestClient(app)


def _mock_normalized_result():
    return {
        "investorName": "Jane Doe",
        "statementDate": "2026-03-31",
        "warnings": [],
        "folios": [
            {
                "folio": "1234/5678",
                "amc": "Axis Mutual Fund",
                "pan": "ABCDE1234F",
                "schemes": [
                    {
                        "isin": "INF846K01EW2",
                        "amfiCode": "120503",
                        "name": "Axis Bluechip Fund - Direct Growth",
                        "units": 50.0,
                        "currentValue": 25000.0,
                        "nav": 500.0,
                        "navDate": "2026-03-31",
                    }
                ]
            }
        ]
    }


def test_parse_endpoint_returns_normalized_json(client):
    """POST a fake PDF + PAN form field, verify the response shape."""
    from unittest.mock import patch

    with patch("routers.cas.parse_cas_pdf", return_value=_mock_normalized_result()) as mock_call:
        response = client.post(
            "/api/cas/parse",
            data={"password": "ABCDE1234F"},
            files={"file": ("test.pdf", b"%PDF-1.4 fake content", "application/pdf")},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "success"
    assert body["result"]["investorName"] == "Jane Doe"
    assert body["result"]["statementDate"] == "2026-03-31"
    assert body["result"]["warnings"] == []
    assert len(body["result"]["folios"]) == 1
    assert body["result"]["folios"][0]["schemes"][0]["amfiCode"] == "120503"
    assert body["result"]["folios"][0]["schemes"][0]["navDate"] == "2026-03-31"
    # Verify the file-like object + password were forwarded
    args, kwargs = mock_call.call_args
    assert hasattr(args[0], "read")
    if len(args) >= 2:
        assert args[1] == "ABCDE1234F"
    else:
        assert kwargs.get("password") == "ABCDE1234F"


def test_parse_endpoint_returns_422_for_unreadable(client):
    from unittest.mock import patch
    from routers.shared import CASUnreadableError

    with patch("routers.cas.parse_cas_pdf", side_effect=CASUnreadableError("eCAS is unreadable: corrupted header")):
        response = client.post(
            "/api/cas/parse",
            data={"password": ""},
            files={"file": ("bad.pdf", b"%PDF-1.4 fake content", "application/pdf")},
        )

    assert response.status_code == 422, response.text
    assert "unreadable" in response.json()["detail"].lower()


def test_parse_endpoint_returns_422_for_wrong_password(client):
    from unittest.mock import patch
    from routers.shared import CASWrongPasswordError

    with patch("routers.cas.parse_cas_pdf", side_effect=CASWrongPasswordError("PAN is incorrect for this eCAS")):
        response = client.post(
            "/api/cas/parse",
            data={"password": "WRONG"},
            files={"file": ("locked.pdf", b"%PDF-1.4 fake content", "application/pdf")},
        )

    assert response.status_code == 422, response.text
    detail = response.json()["detail"].lower()
    assert "pan" in detail or "password" in detail


def test_parse_endpoint_returns_422_for_nsdl_cdsl(client):
    from unittest.mock import patch
    from routers.shared import NSDLNotSupportedError

    with patch("routers.cas.parse_cas_pdf", side_effect=NSDLNotSupportedError("NSDL")):
        response = client.post(
            "/api/cas/parse",
            data={"password": ""},
            files={"file": ("nsdl.pdf", b"%PDF-1.4 fake content", "application/pdf")},
        )

    assert response.status_code == 422, response.text
    detail = response.json()["detail"].lower()
    assert "nsdl" in detail or "cdsl" in detail


def test_parse_endpoint_returns_503_when_casparser_unavailable(client):
    from unittest.mock import patch
    from routers.shared import CASParserUnavailableError

    with patch("routers.cas.parse_cas_pdf", side_effect=CASParserUnavailableError("not installed")):
        response = client.post(
            "/api/cas/parse",
            data={"password": ""},
            files={"file": ("test.pdf", b"%PDF-1.4 fake content", "application/pdf")},
        )

    assert response.status_code == 503, response.text
    assert "not installed" in response.json()["detail"].lower()


def test_parse_endpoint_rejects_non_pdf(client):
    """Reject content-types that are clearly not PDFs."""
    response = client.post(
        "/api/cas/parse",
        data={"password": ""},
        files={"file": ("data.txt", b"hello", "text/plain")},
    )
    assert response.status_code in (400, 415)


def test_parse_endpoint_does_not_write_to_disk(client, monkeypatch):
    """Critical: PDF must never be persisted to disk."""
    from unittest.mock import patch

    files_written = []

    original_open = open
    def tracking_open(path, *args, **kwargs):
        if isinstance(path, (str, bytes)) and (
            str(path).endswith(".pdf") or str(path).endswith(".tmp")
        ):
            files_written.append(path)
        return original_open(path, *args, **kwargs)

    monkeypatch.setattr("builtins.open", tracking_open)

    with patch("routers.cas.parse_cas_pdf", return_value=_mock_normalized_result()):
        response = client.post(
            "/api/cas/parse",
            data={"password": ""},
            files={"file": ("test.pdf", b"%PDF-1.4", "application/pdf")},
        )

    assert response.status_code == 200
    assert files_written == [], f"PDF was written to disk: {files_written}"


def test_parse_endpoint_forwards_empty_password(client):
    """Missing password is allowed at HTTP level; forwarded as empty string."""
    from unittest.mock import patch

    with patch("routers.cas.parse_cas_pdf", return_value=_mock_normalized_result()) as mock_call:
        response = client.post(
            "/api/cas/parse",
            files={"file": ("test.pdf", b"%PDF-1.4", "application/pdf")},
        )

    assert response.status_code == 200
    args, kwargs = mock_call.call_args
    pwd = args[1] if len(args) >= 2 else kwargs.get("password")
    assert pwd == ""
