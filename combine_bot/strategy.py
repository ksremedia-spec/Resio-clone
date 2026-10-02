"""Opening-range breakout: the one rule set shared by the backtest and the live bot.

After the 8:30 CT open, the bot marks the high and low of the first `range_minutes`. The first
bar that closes beyond that range (by at least `breakout_ticks`) before `last_entry` triggers a
trade in the breakout direction. The stop goes at the other side of the range (or its middle),
the target at `reward_risk` times the risk, and anything still open is closed at `flat_time`.
At most one trade per day.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from .bars import CT, Bar, round_to_tick

LONG, SHORT = 1, -1

# Topstep starts force-closing positions at 15:08 CT and everything must be flat by 15:10 CT.
LATEST_FLAT_TIME = time(15, 5)


@dataclass(frozen=True)
class ORBParams:
    bar_minutes: int = 5
    range_start: time = time(8, 30)
    range_minutes: int = 15
    last_entry: time = time(11, 0)
    flat_time: time = time(15, 0)
    min_range_points: float = 3.0
    max_range_points: float = 40.0
    breakout_ticks: int = 1
    stop_mode: str = "range"  # "range": stop at the far side of the range; "mid": at its middle
    reward_risk: float = 1.5
    direction: str = "both"  # "both", "long" or "short"

    def __post_init__(self) -> None:
        if self.bar_minutes <= 0 or self.range_minutes <= 0 or self.range_minutes % self.bar_minutes:
            raise ValueError("range_minutes must be a positive multiple of bar_minutes")
        if self.stop_mode not in ("range", "mid"):
            raise ValueError("stop_mode must be 'range' or 'mid'")
        if self.direction not in ("both", "long", "short"):
            raise ValueError("direction must be 'both', 'long' or 'short'")
        if self.reward_risk <= 0:
            raise ValueError("reward_risk must be positive")
        if self.flat_time > LATEST_FLAT_TIME:
            raise ValueError("flat_time must be 15:05 or earlier: Topstep force-closes from 15:08 CT")
        if not self.range_end <= self.last_entry < self.flat_time:
            raise ValueError("times must run range_start + range_minutes <= last_entry < flat_time")

    @property
    def range_end(self) -> time:
        start = datetime.combine(date(2000, 1, 3), self.range_start)
        return (start + timedelta(minutes=self.range_minutes)).time()


@dataclass(frozen=True)
class Signal:
    side: int  # LONG or SHORT
    index: int  # position of the trigger bar in the day's bar list
    time: datetime  # when the trigger bar closed, i.e. when the signal became known
    stop: float
    range_high: float
    range_low: float


class OpeningRangeBreakout:
    def __init__(self, params: ORBParams, tick_size: float):
        self.p = params
        self.tick = tick_size

    def opening_range(self, bars: list[Bar]) -> tuple[float, float] | None:
        """High and low of the opening range, or None if any of its bars is missing."""
        p = self.p
        window = [b for b in bars if p.range_start <= b.local.time() < p.range_end]
        if len(window) != p.range_minutes // p.bar_minutes or window[0].local.time() != p.range_start:
            return None
        return max(b.high for b in window), min(b.low for b in window)

    def signal(self, bars: list[Bar]) -> Signal | None:
        """The day's first breakout among `bars` (one day's completed bars, oldest first)."""
        p = self.p
        rng = self.opening_range(bars)
        if rng is None:
            return None
        high, low = rng
        if not p.min_range_points <= high - low <= p.max_range_points:
            return None
        buffer = p.breakout_ticks * self.tick
        mid = round_to_tick((high + low) / 2, self.tick)
        length = timedelta(minutes=p.bar_minutes)
        for i, b in enumerate(bars):
            if b.local.time() < p.range_end:
                continue
            closed = b.start + length
            if closed.astimezone(CT).time() > p.last_entry:
                break
            if p.direction != "short" and b.close >= high + buffer:
                return Signal(LONG, i, closed, low if p.stop_mode == "range" else mid, high, low)
            if p.direction != "long" and b.close <= low - buffer:
                return Signal(SHORT, i, closed, high if p.stop_mode == "range" else mid, high, low)
        return None
