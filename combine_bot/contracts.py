"""Quarterly equity-index futures (MES, ES, MNQ, NQ, ...): which contract was the front month on a day."""
from __future__ import annotations

from datetime import date, timedelta

QUARTER_CODES = {3: "H", 6: "M", 9: "U", 12: "Z"}


def third_friday(year: int, month: int) -> date:
    first = date(year, month, 1)
    return first + timedelta(days=(4 - first.weekday()) % 7 + 14)


def roll_date(year: int, month: int) -> date:
    """Trading moves to the next contract about eight days before expiry (the second Thursday)."""
    return third_friday(year, month) - timedelta(days=8)


def front_month(day: date) -> tuple[int, int]:
    for month in QUARTER_CODES:
        if day < roll_date(day.year, month):
            return day.year, month
    return day.year + 1, 3


def contract_id(symbol: str, year: int, month: int) -> str:
    """ProjectX contract id, e.g. CON.F.US.MES.Z25 for December 2025 Micro E-mini S&P."""
    return f"CON.F.US.{symbol.upper()}.{QUARTER_CODES[month]}{year % 100:02d}"


def segments(start: date, end: date) -> list[tuple[int, int, date, date]]:
    """Split [start, end) into (year, month, from, to) pieces, each served by one front-month contract."""
    out = []
    day = start
    while day < end:
        year, month = front_month(day)
        until = min(roll_date(year, month), end)
        out.append((year, month, day, until))
        day = until
    return out
