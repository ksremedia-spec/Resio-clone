"""Minimal client for the ProjectX Gateway API that TopstepX uses (standard library only).

Endpoints and enum values follow https://gateway.docs.projectx.com.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

from .bars import Bar, parse_time

# Order types, sides and position types as numbered by the API.
LIMIT, MARKET, STOP = 1, 2, 4
BUY, SELL = 0, 1
LONG_POSITION, SHORT_POSITION = 1, 2
UNIT_MINUTE = 2

TOKEN_LIFETIME = 23 * 3600  # session tokens last 24 hours; log in again a little before that
MAX_BARS = 20_000  # per retrieveBars request


class ProjectXError(Exception):
    """The API refused a request."""


class ProjectXNetworkError(ProjectXError):
    """The API couldn't be reached (network trouble, timeout, rate limit or server error)."""


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


class ProjectXClient:
    def __init__(self, base_url: str, username: str, api_key: str, *, timeout: float = 20.0, opener=None):
        if not username or not api_key:
            raise ProjectXError(
                "missing API username or key: put them in config.toml, or set "
                "PROJECTX_USERNAME and PROJECTX_API_KEY"
            )
        self.base_url = base_url.rstrip("/")
        self._username = username
        self._api_key = api_key
        self._timeout = timeout
        self._open = opener or urllib.request.urlopen
        self._token: str | None = None
        self._token_at = 0.0

    def login(self) -> None:
        data = self._post("/api/Auth/loginKey", {"userName": self._username, "apiKey": self._api_key}, auth=False)
        self._token = data["token"]
        self._token_at = time.monotonic()

    def _post(self, path: str, body: dict, *, auth: bool = True, retry_auth: bool = True) -> dict:
        headers = {"Content-Type": "application/json", "Accept": "application/json, text/plain"}
        if auth:
            if self._token is None or time.monotonic() - self._token_at > TOKEN_LIFETIME:
                self.login()
            headers["Authorization"] = f"Bearer {self._token}"
        request = urllib.request.Request(
            self.base_url + path, data=json.dumps(body).encode(), headers=headers, method="POST"
        )
        try:
            with self._open(request, timeout=self._timeout) as response:
                raw = response.read()
        except urllib.error.HTTPError as exc:
            if exc.code == 401 and auth and retry_auth:
                self._token = None
                return self._post(path, body, auth=auth, retry_auth=False)
            detail = exc.read()[:300].decode(errors="replace")
            error = ProjectXNetworkError if exc.code == 429 or exc.code >= 500 else ProjectXError
            raise error(f"{path}: HTTP {exc.code} {detail}".strip()) from exc
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
            raise ProjectXNetworkError(f"{path}: {exc}") from exc
        try:
            data = json.loads(raw or b"{}")
        except json.JSONDecodeError as exc:
            raise ProjectXNetworkError(f"{path}: unreadable response") from exc
        if not data.get("success") or data.get("errorCode"):
            message = data.get("errorMessage") or f"error code {data.get('errorCode')}"
            raise ProjectXError(f"{path}: {message}")
        return data

    def accounts(self, only_active: bool = True) -> list[dict]:
        return self._post("/api/Account/search", {"onlyActiveAccounts": only_active})["accounts"]

    def contracts(self, search_text: str, live: bool = False) -> list[dict]:
        return self._post("/api/Contract/search", {"searchText": search_text, "live": live})["contracts"]

    def bars(self, contract_id: str, start: datetime, end: datetime, minutes: int, *,
             limit: int = MAX_BARS, include_partial: bool = False, live: bool = False) -> list[Bar]:
        data = self._post("/api/History/retrieveBars", {
            "contractId": contract_id,
            "live": live,
            "startTime": _iso(start),
            "endTime": _iso(end),
            "unit": UNIT_MINUTE,
            "unitNumber": minutes,
            "limit": min(limit, MAX_BARS),
            "includePartialBar": include_partial,
        })
        bars = [
            Bar(parse_time(b["t"]), float(b["o"]), float(b["h"]), float(b["l"]), float(b["c"]), float(b.get("v") or 0))
            for b in data.get("bars") or []
        ]
        return sorted(bars, key=lambda b: b.start)

    def place_order(self, account_id: int, contract_id: str, order_type: int, side: int, size: int, *,
                    limit_price: float | None = None, stop_price: float | None = None) -> int:
        body = {"accountId": account_id, "contractId": contract_id, "type": order_type, "side": side, "size": size}
        if limit_price is not None:
            body["limitPrice"] = limit_price
        if stop_price is not None:
            body["stopPrice"] = stop_price
        return int(self._post("/api/Order/place", body)["orderId"])

    def cancel_order(self, account_id: int, order_id: int) -> None:
        self._post("/api/Order/cancel", {"accountId": account_id, "orderId": order_id})

    def open_orders(self, account_id: int) -> list[dict]:
        return self._post("/api/Order/searchOpen", {"accountId": account_id})["orders"]

    def positions(self, account_id: int) -> list[dict]:
        return self._post("/api/Position/searchOpen", {"accountId": account_id})["positions"]

    def close_position(self, account_id: int, contract_id: str) -> None:
        self._post("/api/Position/closeContract", {"accountId": account_id, "contractId": contract_id})
