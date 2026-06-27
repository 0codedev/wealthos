"""Tests for parse_cas_pdf helper in shared.py (CC51)."""
import io
import pytest
from unittest.mock import patch, MagicMock


def test_parse_cas_pdf_returns_normalized_dict():
    """Mock casparser.read_cas_pdf and verify normalization from CASData pydantic model."""
    from routers.shared import parse_cas_pdf

    mock_result = MagicMock()
    mock_result.model_dump.return_value = {
        "statement_period": {"from_": "2026-01-01", "to": "2026-03-31"},
        "investor_info": {"name": "John Doe", "email": "x@y.z", "address": "...", "mobile": "..."},
        "folios": [
            {
                "folio": "9111/2233",
                "amc": "HDFC Mutual Fund",
                "PAN": "ABCDE1234F",
                "KYC": None,
                "PANKYC": None,
                "schemes": [
                    {
                        "scheme": "HDFC Flexi Cap Fund - Direct Growth",
                        "isin": "INF179K01BE8",
                        "amfi": "119597",
                        "valuation": {
                            "date": "2026-03-31",
                            "nav": 405.123,
                            "value": 50000.0,
                            "cost": None,
                        },
                        "close": 123.456,
                    }
                ],
            }
        ],
        "parse_warnings": [],
    }

    with patch("routers.shared._import_casparser") as mock_import:
        mock_casparser = MagicMock()
        mock_casparser.read_cas_pdf.return_value = mock_result
        mock_import.return_value = mock_casparser

        result = parse_cas_pdf(io.BytesIO(b"%PDF fake"), password="ABCDE1234F")

    assert result["investorName"] == "John Doe"
    assert result["statementDate"] == "2026-03-31"
    assert result["warnings"] == []
    assert len(result["folios"]) == 1
    f = result["folios"][0]
    assert f["folio"] == "9111/2233"
    assert f["amc"] == "HDFC Mutual Fund"
    assert f["pan"] == "ABCDE1234F"
    assert len(f["schemes"]) == 1
    s = f["schemes"][0]
    assert s["isin"] == "INF179K01BE8"
    assert s["amfiCode"] == "119597"
    assert s["name"] == "HDFC Flexi Cap Fund - Direct Growth"
    assert s["units"] == 123.456
    assert s["currentValue"] == 50000.0
    assert s["nav"] == 405.123
    assert s["navDate"] == "2026-03-31"


def test_parse_cas_pdf_raises_on_nsdl_cdsl():
    """NSDLCASData (has 'accounts', not 'folios') -> friendly NSDLNotSupportedError."""
    from routers.shared import parse_cas_pdf, NSDLNotSupportedError

    mock_result = MagicMock()
    mock_result.model_dump.return_value = {
        "statement_period": {"from_": "2026-01-01", "to": "2026-03-31"},
        "investor_info": {"name": "John", "email": "x", "address": "x", "mobile": "x"},
        "accounts": [{"depository": "NSDL", "demat": "...", "mutual_funds": []}],
        "file_type": "NSDL",
    }

    with patch("routers.shared._import_casparser") as mock_import:
        mock_casparser = MagicMock()
        mock_casparser.read_cas_pdf.return_value = mock_result
        mock_import.return_value = mock_casparser

        with pytest.raises(NSDLNotSupportedError) as exc_info:
            parse_cas_pdf(io.BytesIO(b"%PDF"), password="")
        # CC55: friendlier error mentions the depository + workaround
        assert "NSDL" in str(exc_info.value)
        assert "CAMS" in str(exc_info.value) or "KFintech" in str(exc_info.value)


def test_parse_cas_pdf_raises_on_cdsl_cdsl():
    """CDSL eCAS (depository=CDSL) → message says CDSL specifically."""
    from routers.shared import parse_cas_pdf, NSDLNotSupportedError

    mock_result = MagicMock()
    mock_result.model_dump.return_value = {
        "statement_period": {"from_": "2026-01-01", "to": "2026-03-31"},
        "investor_info": {"name": "Jane", "email": "x", "address": "x", "mobile": "x"},
        "accounts": [{"depository": "CDSL", "demat": "...", "mutual_funds": []}],
        "file_type": "CDSL",
    }

    with patch("routers.shared._import_casparser") as mock_import:
        mock_casparser = MagicMock()
        mock_casparser.read_cas_pdf.return_value = mock_result
        mock_import.return_value = mock_casparser

        with pytest.raises(NSDLNotSupportedError) as exc_info:
            parse_cas_pdf(io.BytesIO(b"%PDF"), password="")
        assert "CDSL" in str(exc_info.value)


def test_parse_cas_pdf_raises_on_wrong_password():
    """IncorrectPasswordError -> normalized CASWrongPasswordError.

    The production except clause uses `_IncorrectPasswordError` (a module-level
    name in routers.shared set by the function-local import). We patch that
    name to a real class so a raised exception matches.
    """
    from routers.shared import parse_cas_pdf, CASWrongPasswordError
    from routers import shared as shared_mod

    # Create a sentinel exception class and inject it as the module-level name
    # that production code's `except _IncorrectPasswordError` matches against.
    class _SentinelIP(BaseException):
        pass
    shared_mod._IncorrectPasswordError = _SentinelIP

    with patch("routers.shared._import_casparser") as mock_import:
        mock_casparser = MagicMock()
        mock_casparser.read_cas_pdf.side_effect = _SentinelIP("bad password")
        mock_import.return_value = mock_casparser

        with pytest.raises(CASWrongPasswordError):
            parse_cas_pdf(io.BytesIO(b"%PDF"), password="WRONG")


def test_parse_cas_pdf_raises_on_parse_error():
    """CASParseError -> normalized CASUnreadableError."""
    from routers.shared import parse_cas_pdf, CASUnreadableError
    from routers import shared as shared_mod

    class _SentinelPE(BaseException):
        pass
    shared_mod._CASParseError = _SentinelPE

    with patch("routers.shared._import_casparser") as mock_import:
        mock_casparser = MagicMock()
        mock_casparser.read_cas_pdf.side_effect = _SentinelPE("bad PDF")
        mock_import.return_value = mock_casparser

        with pytest.raises(CASUnreadableError):
            parse_cas_pdf(io.BytesIO(b"%PDF"), password="")
