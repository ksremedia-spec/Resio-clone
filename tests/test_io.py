import io
import json
import urllib.error
from datetime import date, datetime, time, timezone

import pytest

from combine_bot.bars import CT, Bar, load_csv, resample
from combine_bot.config import load_config
from combine_bot.contracts import contract_id, front_month, segments
from combine_bot.projectx import ProjectXClient, ProjectXError


def test_csv_with_date_and_time_columns_in_exchange_time(tmp_path):
    path = tmp_path / "bars.csv"
    path.write_text("Date,Time,Open,High,Low,Close,Volume\n2026-10-05,08:30,1,2,0.5,1.5,10\n")
    [b] = load_csv(path, tz="America/Chicago")
    assert b.local == datetime(2026, 10, 5, 8, 30, tzinfo=CT)
    assert (b.open, b.high, b.low, b.close, b.volume) == (1, 2, 0.5, 1.5, 10)


def test_csv_with_iso_and_epoch_times(tmp_path):
    earlier = datetime(2025, 10, 6, 13, 35, tzinfo=timezone.utc)
    path = tmp_path / "bars.csv"
    path.write_text(f"timestamp,o,h,l,c\n2026-10-05T13:35:00Z,1,1,1,1\n{int(earlier.timestamp())},2,2,2,2\n")
    bars = load_csv(path)
    assert [b.start for b in bars] == [earlier, datetime(2026, 10, 5, 13, 35, tzinfo=timezone.utc)]
    assert [b.close for b in bars] == [2, 1]


def test_resample_one_minute_to_five():
    start = datetime(2026, 10, 5, 13, 30, tzinfo=timezone.utc)
    ones = [Bar(start.replace(minute=30 + i), 10 + i, 20 + i, 5 + i, 11 + i, 1) for i in range(10)]
    first, second = resample(ones, 5)
    assert (first.open, first.high, first.low, first.close, first.volume) == (10, 24, 5, 15, 5)
    assert second.start == start.replace(minute=35)


def test_front_month_rolls_eight_days_before_expiry():
    assert front_month(date(2025, 12, 10)) == (2025, 12)  # Dec 2025 expires Fri 19th, rolls Thu 11th
    assert front_month(date(2025, 12, 11)) == (2026, 3)
    assert contract_id("mes", 2025, 12) == "CON.F.US.MES.Z25"
    pieces = segments(date(2025, 11, 1), date(2026, 4, 1))
    assert [(y, m) for y, m, _, _ in pieces] == [(2025, 12), (2026, 3), (2026, 6)]
    assert all(a[3] == b[2] for a, b in zip(pieces, pieces[1:]))


def test_config_file_and_environment(tmp_path, monkeypatch):
    path = tmp_path / "config.toml"
    path.write_text('[strategy]\nlast_entry = "10:30"\nreward_risk = 2\n[api]\nusername = "file-user"\n')
    monkeypatch.setenv("PROJECTX_API_KEY", "from-env")
    cfg = load_config(path)
    assert cfg.strategy.last_entry == time(10, 30) and cfg.strategy.reward_risk == 2
    assert (cfg.api.username, cfg.api.api_key) == ("file-user", "from-env")
    path.write_text("[risk]\nrisk_per_trad = 100\n")
    with pytest.raises(ValueError, match="risk_per_trad"):
        load_config(path)


class Response:
    def __init__(self, payload):
        self.body = json.dumps(payload).encode()

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def fake_api(handler):
    seen = []

    def opener(request, timeout):
        body = json.loads(request.data)
        seen.append((request.full_url.split("/api/")[1], body, request.get_header("Authorization")))
        if request.full_url.endswith("Auth/loginKey"):
            return Response({"success": True, "errorCode": 0, "token": f"tok{len(seen)}"})
        return handler(request.full_url.split("/api/")[1], body)

    return seen, opener


def test_client_logs_in_and_sends_the_token():
    seen, opener = fake_api(lambda path, body: Response({"success": True, "errorCode": 0, "accounts": [{"id": 1}]}))
    client = ProjectXClient("https://api.example.com/", "me", "secret", opener=opener)
    assert client.accounts() == [{"id": 1}]
    assert seen[0][:2] == ("Auth/loginKey", {"userName": "me", "apiKey": "secret"})
    assert seen[1] == ("Account/search", {"onlyActiveAccounts": True}, "Bearer tok1")


def test_client_parses_and_sorts_bars_and_builds_orders():
    def handler(path, body):
        if path == "History/retrieveBars":
            return Response({"success": True, "errorCode": 0, "bars": [
                {"t": "2026-10-05T13:35:00+00:00", "o": 2, "h": 2, "l": 2, "c": 2, "v": 5},
                {"t": "2026-10-05T13:30:00+00:00", "o": 1, "h": 1, "l": 1, "c": 1, "v": 5},
            ]})
        return Response({"success": True, "errorCode": 0, "orderId": 42})

    seen, opener = fake_api(handler)
    client = ProjectXClient("https://api.example.com", "me", "secret", opener=opener)
    bars = client.bars("CON.F.US.MES.Z26", datetime(2026, 10, 5, tzinfo=timezone.utc),
                       datetime(2026, 10, 6, tzinfo=timezone.utc), 5)
    assert [b.close for b in bars] == [1, 2]
    assert seen[1][1]["startTime"] == "2026-10-05T00:00:00.000Z" and seen[1][1]["unitNumber"] == 5
    assert client.place_order(7, "CON.F.US.MES.Z26", 4, 1, 2, stop_price=4999.0) == 42
    assert seen[2][1] == {"accountId": 7, "contractId": "CON.F.US.MES.Z26", "type": 4, "side": 1, "size": 2,
                          "stopPrice": 4999.0}


def test_client_reports_api_errors_and_relogs_on_401():
    calls = {"n": 0}

    def handler(path, body):
        calls["n"] += 1
        if calls["n"] == 1:
            raise urllib.error.HTTPError("u", 401, "Unauthorized", {}, io.BytesIO(b""))
        return Response({"success": False, "errorCode": 2, "errorMessage": "Contract not found"})

    seen, opener = fake_api(handler)
    client = ProjectXClient("https://api.example.com", "me", "secret", opener=opener)
    with pytest.raises(ProjectXError, match="Contract not found"):
        client.contracts("XYZ")
    assert [s[0] for s in seen] == ["Auth/loginKey", "Contract/search", "Auth/loginKey", "Contract/search"]
