import math
import random
from datetime import date, datetime, time, timedelta, timezone

import pytest

from combine_bot.bars import CT, Bar, round_to_tick
from combine_bot.lab import Slice, run_lab, suggested_checks, verdict
from combine_bot.report import format_picker
from combine_bot.picker import Context, DayStats, PickerParams, Score, context, score
from combine_bot.risk import Instrument, RiskParams
from combine_bot.sim import Day, Trade, backtest, chosen
from combine_bot.strategy import LONG, SHORT, ORBParams, OpeningRangeBreakout, Signal
from combine_bot.synthetic import synthetic_bars

P = PickerParams()
T0 = datetime(2026, 10, 5, 13, 50, tzinfo=timezone.utc)


def stats(day: date, o: float, h: float, low: float, c: float, volume: float = 300.0) -> DayStats:
    return DayStats(day, o, h, low, c, volume)


def breakout(side: int) -> Signal:
    """A breakout of a 4999-5010 opening range (11 points wide)."""
    return Signal(side, 3, T0, 4999.0 if side == LONG else 5010.0, 5010.0, 4999.0)


def test_context_needs_enough_history():
    days = [stats(date(2026, 7, 1) + timedelta(days=i), 100, 110, 90, 105) for i in range(10)]
    assert context(days, P) == Context(None, None, None)


def test_context_averages_and_trend():
    days = [stats(date(2026, 7, 1) + timedelta(days=i), 100 + i, 120 + i, 90 + i, 101 + i, 200 + i)
            for i in range(30)]
    ctx = context(days, P)
    assert ctx.avg_range == 30
    assert ctx.avg_or_volume == pytest.approx(sum(d.or_volume for d in days[-14:]) / 14)
    assert ctx.trend == 20  # twenty daily moves of +1


def test_trend_ignores_the_price_gap_between_contracts():
    # 2026-09-10 is the roll from the September to the December contract, which trades about 60 higher.
    before = [stats(date(2026, 9, 1) + timedelta(days=i), 5000, 5010, 4990, 5000) for i in range(9)]
    roll_day = stats(date(2026, 9, 10), 5060, 5075, 5055, 5070)  # the day itself rose 10
    ctx = context(before + [roll_day], PickerParams(trend_days=9, lookback_days=2))
    assert ctx.trend == 10  # not 70


def test_score_counts_passing_checks():
    ctx = Context(avg_range=44.0, avg_or_volume=300.0, trend=50.0)
    good = score(breakout(LONG), 450.0, ctx, P)
    assert (good.volume, good.range, good.trend, good.passed, good.needed, good.ok) == (True, True, True, 3, 2, True)
    bad = score(breakout(SHORT), 150.0, ctx, P)
    assert (bad.volume, bad.range, bad.trend, bad.passed, bad.ok) == (False, True, False, 1, False)


def test_switched_off_and_impossible_checks_dont_count():
    ctx = Context(avg_range=44.0, avg_or_volume=None, trend=-50.0)
    no_volume = score(breakout(LONG), 0.0, ctx, P, has_volume=False)
    assert no_volume.volume is None and no_volume.counted == ("range", "trend") and no_volume.needed == 2
    assert not no_volume.ok  # the long goes against the trend
    only_range = score(breakout(LONG), 0.0, ctx, PickerParams(use_trend=False), has_volume=False)
    assert only_range.counted == ("range",) and only_range.needed == 1 and only_range.ok
    assert only_range.trend is False  # still recorded for the report
    assert score(breakout(LONG), 0.0, Context(None, None, None), PickerParams(min_score=0)).ok


def test_describe_reads_plainly():
    text = score(breakout(SHORT), 150.0, Context(44.0, 300.0, 50.0), P).describe()
    assert text.startswith("1 of 3 checks passed, 2 needed")
    assert "quieter than usual (0.5x)" in text
    assert "tight range (25% of a normal day)" in text
    assert "against the 20-day trend (+50 points)" in text


def test_backtest_scores_breakouts_and_needs_history_first():
    days = backtest(synthetic_bars(days=150, seed=4), OpeningRangeBreakout(ORBParams(), 0.25), Instrument())
    warm_up = [d for d in days[:P.lookback_days] if d.trade]
    assert warm_up and not any(d.score.ok for d in warm_up)
    later = [d for d in days[P.history_days + 1:] if d.trade]
    assert any(d.score.ok for d in later) and any(not d.score.ok for d in later)
    taken = [t for _, t in chosen(days) if t is not None]
    assert len(taken) == sum(1 for d in days if d.trade and d.score.ok)
    assert len([t for _, t in chosen(days, use_picker=False) if t]) == sum(1 for d in days if d.trade)


def _trade(day: date, pnl: float) -> Trade:
    return Trade(day, LONG, T0, 5000, 4990, 5015, T0, 5000 + pnl, "x", 10.0, pnl, min(0.0, pnl))


def _score(volume: bool | None, rng: bool, trend: bool) -> Score:
    counted = tuple(n for n, v in (("volume", volume), ("range", rng), ("trend", trend)) if v is not None)
    return Score(volume, rng, trend, 1.0, 0.2, 10.0, counted, min(2, len(counted)), 20)


def test_lab_separates_real_help_from_luck():
    days = []
    for i in range(120):
        win, older = i % 2 == 0, i < 80
        # volume passes exactly the winners; range passes everything;
        # trend passes the winners in the older data but the losers in the newer data
        s = _score(win, True, win if older else not win)
        days.append(Day(date(2026, 1, 5) + timedelta(days=i), _trade(date(2026, 1, 5), 15 if win else -10), s))
    lab = run_lab(days, Instrument(), RiskParams(), room=2000)
    rows = {r.label: r.verdict for r in lab.rows}
    assert rows["Every breakout"] == ""
    assert rows["Volume check alone"] == "helped in both periods"
    assert rows["Range check alone"] == "too few trades to judge"  # it never skipped anything
    assert rows["Trend check alone"] == "no clear effect: could be luck"
    assert rows["Picker as set up (2 of 3)"] == "too few trades to judge"  # kept every newer trade
    assert lab.split == date(2026, 1, 5) + timedelta(days=80)


def test_lab_without_volume_data_and_small_samples():
    days = [Day(date(2026, 1, 5) + timedelta(days=i), _trade(date(2026, 1, 5), 15 if i % 2 else -10),
                _score(None, True, i % 2 == 1)) for i in range(30)]
    lab = run_lab(days, Instrument(), RiskParams(), room=2000)
    assert not lab.has_volume
    assert [r.label for r in lab.rows] == ["Every breakout", "Picker as set up (2 of 2)",
                                           "Range check alone", "Trend check alone"]
    assert verdict(Slice(5, 100, None), Slice(30, 100, 3.0)) == "too few trades to judge"
    assert verdict(Slice(50, 100, 2.0), Slice(30, 100, -1.0)) == "no clear effect: could be luck"
    assert verdict(Slice(50, -100, -2.0), Slice(30, -100, -1.7)) == "hurt in both periods"


def in_play_bars(days: int, seed: int) -> list[Bar]:
    """Random prices, except that a busy open is followed by a trending day: a planted pattern."""
    rng = random.Random(seed)
    bars, price, day, count = [], 5000.0, date(2021, 1, 1), 0
    while count < days:
        day += timedelta(days=1)
        if day.weekday() >= 5:
            continue
        count += 1
        busy = rng.random() < 0.4
        drift = rng.choice((-1.0, 1.0)) * 0.8 if busy else 0.0
        open_time = datetime.combine(day, time(8, 30), tzinfo=CT)
        for i in range(81):
            noise = 2.0 + 3.0 * math.exp(-i / 8)
            o = round_to_tick(price, 0.25)
            c = round_to_tick(o + (drift if i >= 3 else 0.0) + rng.gauss(0, noise), 0.25)
            h = round_to_tick(max(o, c) + abs(rng.gauss(0, noise / 2)), 0.25)
            low = round_to_tick(min(o, c) - abs(rng.gauss(0, noise / 2)), 0.25)
            volume = rng.randint(500, 5000) * (2 if busy and i < 3 else 1)
            bars.append(Bar((open_time + timedelta(minutes=5 * i)).astimezone(timezone.utc), o, h, low, c, volume))
            price = c
    return bars


def test_lab_detects_a_real_pattern():
    days = backtest(in_play_bars(1000, seed=8), OpeningRangeBreakout(ORBParams(), 0.25), Instrument())
    lab = run_lab(days, Instrument(), RiskParams(), room=2000)
    rows = {r.label: r.verdict for r in lab.rows}
    assert rows["Volume check alone"] == "helped in both periods"
    assert rows["Range check alone"] != "helped in both periods"
    assert rows["Trend check alone"] != "helped in both periods"
    assert suggested_checks(lab) == ["volume"]
    text = format_picker(lab, PickerParams())
    assert "use_volume = true, use_range = false, use_trend = false" in text


@pytest.mark.parametrize("seed", [1, 2, 3])
def test_lab_finds_nothing_in_random_prices(seed):
    """Volume, range and trend carry no information in a random walk: the report must not claim they help."""
    days = backtest(synthetic_bars(days=1500, seed=seed), OpeningRangeBreakout(ORBParams(), 0.25), Instrument())
    lab = run_lab(days, Instrument(), RiskParams(), room=2000)
    assert all(not r.verdict.startswith("helped") for r in lab.rows)
    assert "None of the checks clearly picked better trades" in format_picker(lab, PickerParams())
