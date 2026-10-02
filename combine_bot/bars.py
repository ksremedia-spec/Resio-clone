"""OHLCV bars: the Bar type, CSV import/export, resampling and grouping by trading day."""
from __future__ import annotations

import csv
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

CT = ZoneInfo("America/Chicago")


@dataclass(frozen=True, slots=True)
class Bar:
    start: datetime  # timezone-aware time the bar opened
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0

    @property
    def local(self) -> datetime:
        """Bar start in Chicago time, the clock CME and Topstep rules use."""
        return self.start.astimezone(CT)


def round_to_tick(price: float, tick: float) -> float:
    return round(round(price / tick) * tick, 10)


_FALLBACK_FORMATS = ("%m/%d/%Y %H:%M:%S", "%m/%d/%Y %H:%M", "%Y%m%d %H%M%S", "%Y%m%d %H:%M:%S")


def parse_time(value: str, assume_tz: ZoneInfo | timezone = timezone.utc) -> datetime:
    """Parse ISO 8601, common US formats or epoch seconds/milliseconds into a UTC datetime."""
    value = value.strip()
    if value.replace(".", "", 1).isdigit():
        num = float(value)
        return datetime.fromtimestamp(num / 1000 if num > 1e11 else num, tz=timezone.utc)
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        for fmt in _FALLBACK_FORMATS:
            try:
                dt = datetime.strptime(value, fmt)
                break
            except ValueError:
                continue
        else:
            raise ValueError(f"unrecognised time: {value!r}") from None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=assume_tz)
    return dt.astimezone(timezone.utc)


_TIME_COLUMNS = ("timestamp", "datetime", "time", "t", "date")
_PRICE_COLUMNS = {
    "open": ("open", "o"),
    "high": ("high", "h"),
    "low": ("low", "l"),
    "close": ("close", "c", "last"),
    "volume": ("volume", "v", "vol"),
}


def load_csv(path: str | Path, tz: str = "UTC") -> list[Bar]:
    """Load bars from a CSV with a time column and open/high/low/close (volume optional).

    Accepts one timestamp column or separate `date` and `time` columns. Times without a UTC
    offset are read in `tz`, e.g. "America/Chicago" for exports in exchange time.
    """
    assume = ZoneInfo(tz)
    with open(path, newline="") as fh:
        reader = csv.DictReader(fh)
        if not reader.fieldnames:
            raise ValueError(f"{path}: the file is empty")
        cols = {name.strip().lower(): name for name in reader.fieldnames}
        split = "date" in cols and "time" in cols
        time_col = None if split else next((cols[c] for c in _TIME_COLUMNS if c in cols), None)
        if not split and time_col is None:
            raise ValueError(f"{path}: no time column (expected one of {', '.join(_TIME_COLUMNS)})")
        price_cols: dict[str, str | None] = {}
        for field, names in _PRICE_COLUMNS.items():
            price_cols[field] = next((cols[n] for n in names if n in cols), None)
            if price_cols[field] is None and field != "volume":
                raise ValueError(f"{path}: missing a '{field}' column")
        bars: dict[datetime, Bar] = {}
        for row in reader:
            raw = f"{row[cols['date']]} {row[cols['time']]}" if split else row[time_col]
            start = parse_time(raw, assume)
            vol_col = price_cols["volume"]
            bars[start] = Bar(
                start,
                float(row[price_cols["open"]]),
                float(row[price_cols["high"]]),
                float(row[price_cols["low"]]),
                float(row[price_cols["close"]]),
                float(row[vol_col] or 0) if vol_col else 0.0,
            )
    return [bars[k] for k in sorted(bars)]


def save_csv(bars: list[Bar], path: str | Path) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["timestamp", "open", "high", "low", "close", "volume"])
        for b in bars:
            writer.writerow([b.start.astimezone(timezone.utc).isoformat(), b.open, b.high, b.low, b.close, b.volume])


def bar_minutes(bars: list[Bar]) -> int:
    """The bar interval in minutes: the smallest gap between consecutive bars."""
    gaps = [b.start - a.start for a, b in zip(bars[:1000], bars[1:1001]) if b.start > a.start]
    if not gaps:
        raise ValueError("need at least two bars to work out the bar size")
    return max(1, int(min(gaps).total_seconds() // 60))


def resample(bars: list[Bar], minutes: int) -> list[Bar]:
    """Combine bars into clock-aligned `minutes`-long bars (e.g. 1-minute into 5-minute)."""
    width = minutes * 60
    buckets: dict[int, list[Bar]] = defaultdict(list)
    for b in bars:
        ts = int(b.start.timestamp())
        buckets[ts - ts % width].append(b)
    return [
        Bar(
            datetime.fromtimestamp(key, tz=timezone.utc),
            group[0].open,
            max(b.high for b in group),
            min(b.low for b in group),
            group[-1].close,
            sum(b.volume for b in group),
        )
        for key, group in sorted(buckets.items())
    ]


def by_day(bars: list[Bar]) -> list[tuple[date, list[Bar]]]:
    """Group bars by Chicago calendar date (the strategy only trades the day session)."""
    days: dict[date, list[Bar]] = defaultdict(list)
    for b in bars:
        days[b.local.date()].append(b)
    return sorted(days.items())
