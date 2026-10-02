"""The trade picker: scores each day's first breakout on three checks before the bot takes it.

The checks come from published trading research, but none is guaranteed to help on your market
and period. The backtest's TRADE PICKER report tests each one on your own data, separately on
older and newer history, so you can keep only what holds up.

- Volume: is the opening range busier than usual? Breakouts with real participation behind them
  tend to follow through. This is the "stocks in play" idea from Zarattini, Barbon & Aziz (2024),
  who found opening-range breakouts worked best on unusually active names.
- Range: is the opening range tight compared with a normal day's range? A tight range leaves room
  to run, and narrow ranges tend to come before range expansion (Toby Crabel, "Day Trading with
  Short Term Price Patterns and Opening Range Breakout", 1990).
- Trend: does the breakout go the same way as the last few weeks' move? Markets have tended to
  keep trending over weeks to months (Moskowitz, Ooi & Pedersen, "Time Series Momentum", 2012).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, time

from .bars import Bar
from .contracts import front_month
from .strategy import ORBParams, Signal

SESSION_END = time(15, 15)  # the CME equity index day session ends at 15:15 CT


@dataclass(frozen=True)
class PickerParams:
    enabled: bool = True
    min_score: int = 2  # how many of the switched-on checks a breakout must pass
    lookback_days: int = 14  # days averaged for "usual" opening volume and daily range
    use_volume: bool = True
    min_rvol: float = 1.0  # opening-range volume at least this multiple of its recent average
    use_range: bool = True
    max_range_share: float = 0.35  # opening range at most this share of an average day's range
    use_trend: bool = True
    trend_days: int = 20  # the trend is the net move over this many days

    def __post_init__(self) -> None:
        if not 0 <= self.min_score <= 3:
            raise ValueError("min_score must be between 0 and 3")
        if self.lookback_days < 2 or self.trend_days < 2:
            raise ValueError("lookback_days and trend_days must be at least 2")
        if self.min_rvol < 0 or self.max_range_share <= 0:
            raise ValueError("min_rvol can't be negative and max_range_share must be positive")

    @property
    def history_days(self) -> int:
        """Trading days of history the checks need before they can pass."""
        return max(self.lookback_days, self.trend_days + 1)


@dataclass(frozen=True)
class DayStats:
    day: date
    open: float
    high: float
    low: float
    close: float
    or_volume: float  # volume traded during the opening range


def day_stats(day: date, bars: list[Bar], params: ORBParams) -> DayStats | None:
    """The day session's open, high, low, close and opening-range volume."""
    session = [b for b in bars if params.range_start <= b.local.time() < SESSION_END]
    if not session:
        return None
    or_volume = sum(b.volume for b in session if b.local.time() < params.range_end)
    return DayStats(day, session[0].open, max(b.high for b in session), min(b.low for b in session),
                    session[-1].close, or_volume)


@dataclass(frozen=True)
class Context:
    """What the picker knows before the open, from earlier days only."""
    avg_range: float | None
    avg_or_volume: float | None
    trend: float | None


def _move(prev: DayStats, cur: DayStats) -> float:
    """One day's move. On a contract roll day only the day's own move counts: the price gap
    between the old and the new contract isn't a real market move."""
    if front_month(prev.day) != front_month(cur.day):
        return cur.close - cur.open
    return cur.close - prev.close


def context(history: list[DayStats], p: PickerParams) -> Context:
    recent = history[-p.lookback_days:]
    full = len(recent) == p.lookback_days
    avg_range = sum(d.high - d.low for d in recent) / len(recent) if full else None
    avg_volume = sum(d.or_volume for d in recent) / len(recent) if full else None
    trend = None
    if len(history) > p.trend_days:
        window = history[-(p.trend_days + 1):]
        trend = sum(_move(a, b) for a, b in zip(window, window[1:]))
    return Context(avg_range, avg_volume or None, trend)


CHECKS = ("volume", "range", "trend")


@dataclass(frozen=True)
class Score:
    # Raw result of every check, switched on or not, so the backtest report can compare them:
    # True passed; False failed (including "not enough history yet"); None impossible with
    # this data (the volume check, when the price file has no volume figures).
    volume: bool | None
    range: bool | None
    trend: bool | None
    rvol: float | None
    range_share: float | None
    trend_points: float | None
    counted: tuple[str, ...]  # the switched-on checks that could run; only these decide `ok`
    needed: int
    trend_days: int

    @property
    def passed(self) -> int:
        return sum(1 for name in self.counted if getattr(self, name))

    @property
    def ok(self) -> bool:
        return self.passed >= self.needed

    def describe(self) -> str:
        parts = []
        if "volume" in self.counted:
            if self.rvol is None:
                parts.append("[-] no volume history yet")
            else:
                busy = "busier" if self.rvol >= 1 else "quieter"
                parts.append(f"[{'+' if self.volume else '-'}] {busy} than usual ({self.rvol:.1f}x)")
        if "range" in self.counted:
            if self.range_share is None:
                parts.append("[-] no range history yet")
            else:
                tight = "tight" if self.range else "wide"
                parts.append(f"[{'+' if self.range else '-'}] {tight} range ({self.range_share:.0%} of a normal day)")
        if "trend" in self.counted:
            if self.trend_points is None:
                parts.append("[-] no trend history yet")
            else:
                way = "with" if self.trend else "against"
                parts.append(f"[{'+' if self.trend else '-'}] {way} the {self.trend_days}-day trend "
                             f"({self.trend_points:+.0f} points)")
        return f"{self.passed} of {len(self.counted)} checks passed, {self.needed} needed: " + "; ".join(parts)


def score(signal: Signal, or_volume: float, ctx: Context, p: PickerParams, *, has_volume: bool = True) -> Score:
    rvol = or_volume / ctx.avg_or_volume if ctx.avg_or_volume else None
    share = (signal.range_high - signal.range_low) / ctx.avg_range if ctx.avg_range else None
    results = {
        "volume": (rvol is not None and rvol >= p.min_rvol) if has_volume else None,
        "range": share is not None and share <= p.max_range_share,
        "trend": ctx.trend is not None and signal.side * ctx.trend > 0,
    }
    switched_on = {"volume": p.use_volume, "range": p.use_range, "trend": p.use_trend}
    counted = tuple(name for name in CHECKS if switched_on[name] and results[name] is not None)
    return Score(**results, rvol=rvol, range_share=share, trend_points=ctx.trend, counted=counted,
                 needed=min(p.min_score, len(counted)), trend_days=p.trend_days)
