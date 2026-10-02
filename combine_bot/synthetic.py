"""Made-up 5-minute day-session bars for the demo and tests. They prove nothing about real markets.

By default the prices are a pure random walk: there is no pattern for any strategy to find, so
a fair simulator should show the strategy losing roughly its fees and slippage. That makes the
demo a check that the backtest isn't flattering itself. `trend` adds a per-day drift, which a
breakout strategy feeds on; it's only for tests that need trending days.
"""
from __future__ import annotations

import math
import random
from datetime import date, datetime, time, timedelta, timezone

from .bars import CT, Bar, round_to_tick

BARS_PER_SESSION = 81  # 08:30 to 15:15 CT in 5-minute bars


def synthetic_bars(days: int = 500, seed: int = 1, end: date = date(2026, 9, 30),
                   start_price: float = 5000.0, tick: float = 0.25, trend: float = 0.0) -> list[Bar]:
    rng = random.Random(seed)
    sessions: list[date] = []
    day = end
    while len(sessions) < days:
        if day.weekday() < 5:
            sessions.append(day)
        day -= timedelta(days=1)
    bars = []
    price = start_price
    for day in reversed(sessions):
        price += rng.gauss(0, 12)  # overnight gap
        drift = rng.gauss(0, trend)  # points per bar; zero means no intraday trend at all
        open_time = datetime.combine(day, time(8, 30), tzinfo=CT)
        for i in range(BARS_PER_SESSION):
            noise = 2.0 + 3.0 * math.exp(-i / 8)  # busier right after the open
            o = round_to_tick(price, tick)
            c = round_to_tick(o + drift + rng.gauss(0, noise), tick)
            h = round_to_tick(max(o, c) + abs(rng.gauss(0, noise / 2)), tick)
            low = round_to_tick(min(o, c) - abs(rng.gauss(0, noise / 2)), tick)
            start = (open_time + timedelta(minutes=5 * i)).astimezone(timezone.utc)
            bars.append(Bar(start, o, h, low, c, float(rng.randint(500, 5000))))
            price = c
    return bars
