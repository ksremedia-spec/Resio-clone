"""Did the trade picker actually help? Compares the trades each check kept with the ones it
skipped, separately on the older two-thirds and the newest third of the history.

With a few hundred trades, differences of several dollars per trade are often just luck, and
with enough rules some will always fit the past by chance. So a check only counts as having
helped when its kept trades beat its skipped trades by a statistically clear margin (a
one-sided Welch t-test at about the 5% level) in BOTH periods. A check with no real effect
passes that by chance roughly 1 time in 400.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date
from statistics import mean, variance
from typing import Callable

from .picker import Score
from .risk import Instrument, RiskParams, position_size
from .sim import Day, trade_pnl

MIN_TRADES = 15  # kept and skipped trades needed in a period to judge it
T_CLEAR = 1.65  # t-statistic for "clearly better" (one-sided, about 95% confidence)


@dataclass(frozen=True)
class Slice:
    trades: int
    total: float
    t_stat: float | None = None  # kept versus skipped trades; None if too few to judge

    @property
    def per_trade(self) -> float | None:
        return self.total / self.trades if self.trades else None


@dataclass(frozen=True)
class LabRow:
    label: str
    older: Slice
    newer: Slice
    verdict: str  # empty for the "every breakout" baseline
    check: str = ""  # "volume", "range" or "trend" for the single-check rows


@dataclass(frozen=True)
class PickerLab:
    split: date  # first day of the newer period
    rows: list[LabRow]
    has_volume: bool


def t_stat(kept: list[float], skipped: list[float]) -> float | None:
    """Welch's t-statistic for kept trades averaging more than skipped ones."""
    if len(kept) < MIN_TRADES or len(skipped) < MIN_TRADES:
        return None
    gap = mean(kept) - mean(skipped)
    se = math.sqrt(variance(kept) / len(kept) + variance(skipped) / len(skipped))
    if se == 0:
        return math.copysign(math.inf, gap) if gap else 0.0
    return gap / se


def verdict(older: Slice, newer: Slice) -> str:
    if older.t_stat is None or newer.t_stat is None:
        return "too few trades to judge"
    if older.t_stat >= T_CLEAR and newer.t_stat >= T_CLEAR:
        return "helped in both periods"
    if older.t_stat <= -T_CLEAR and newer.t_stat <= -T_CLEAR:
        return "hurt in both periods"
    return "no clear effect: could be luck"


def run_lab(days: list[Day], inst: Instrument, risk: RiskParams, room: float) -> PickerLab | None:
    if len(days) < 3:
        return None
    split = days[len(days) * 2 // 3].day
    results: list[tuple[date, Score, float]] = []
    for d in days:
        if d.trade is None:
            continue
        n = position_size(d.trade.risk_points, inst, risk, room)
        if n:
            results.append((d.day, d.score, trade_pnl(d.trade, n, inst)))
    if not results:
        return None

    def period(keep: Callable[[Score], bool], newer: bool, compare: bool) -> Slice:
        rows = [(s, pnl) for day, s, pnl in results if (day >= split) == newer]
        kept = [pnl for s, pnl in rows if keep(s)]
        skipped = [pnl for s, pnl in rows if not keep(s)]
        return Slice(len(kept), sum(kept), t_stat(kept, skipped) if compare else None)

    def row(label: str, keep: Callable[[Score], bool], check: str = "") -> LabRow:
        older, newer = period(keep, False, True), period(keep, True, True)
        return LabRow(label, older, newer, verdict(older, newer), check)

    everything = lambda s: True  # noqa: E731
    rows = [LabRow("Every breakout", period(everything, False, False), period(everything, True, False), "")]
    sample = results[0][1]  # which checks count, and how many are needed, is the same every day
    if sample.counted:
        rows.append(row(f"Picker as set up ({sample.needed} of {len(sample.counted)})", lambda s: s.ok))
    has_volume = any(s.volume is not None for _, s, _ in results)
    for label, name in (("Volume check alone", "volume"), ("Range check alone", "range"), ("Trend check alone", "trend")):
        if name == "volume" and not has_volume:
            continue
        rows.append(row(label, lambda s, name=name: getattr(s, name) is True, name))
    return PickerLab(split, rows, has_volume)


def suggested_checks(lab: PickerLab) -> list[str]:
    """The checks that clearly helped in both periods."""
    return [r.check for r in lab.rows if r.check and r.verdict == "helped in both periods"]
