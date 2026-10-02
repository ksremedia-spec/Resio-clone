from datetime import time

import pytest

from combine_bot.bars import round_to_tick
from combine_bot.risk import Instrument, RiskParams, position_size
from combine_bot.sim import backtest, backtest_stats, simulate_day
from combine_bot.strategy import LONG, SHORT, ORBParams, OpeningRangeBreakout
from combine_bot.synthetic import synthetic_bars
from helpers import MONDAY, bar, ct, opening_day

INST = Instrument()
STRAT = OpeningRangeBreakout(ORBParams(), INST.tick_size)


def test_long_breakout_signal():
    signal = STRAT.signal(opening_day()[:4])
    assert signal.side == LONG
    assert signal.stop == 4999
    assert (signal.range_high, signal.range_low) == (5010, 4999)
    assert signal.time == ct(MONDAY, "08:50")


def test_short_breakout_with_mid_stop():
    bars = opening_day()[:3] + [bar(MONDAY, "08:45", 5004, 5004, 4996, 4997)]
    signal = OpeningRangeBreakout(ORBParams(stop_mode="mid"), 0.25).signal(bars)
    assert signal.side == SHORT
    assert signal.stop == round_to_tick((5010 + 4999) / 2, 0.25)


def test_no_signal_without_complete_range_or_after_last_entry():
    bars = opening_day()
    assert STRAT.signal([bars[0]] + bars[2:]) is None  # 08:35 bar missing
    late = bars[:3] + [bar(MONDAY, "10:55", 5004, 5004, 5004, 5004), bar(MONDAY, "11:00", 5004, 5020, 5003, 5015)]
    assert STRAT.signal(late) is None  # breakout bar closes at 11:05, after last_entry


def test_range_width_filter():
    bars = opening_day()[:4]
    assert OpeningRangeBreakout(ORBParams(max_range_points=10), 0.25).signal(bars) is None
    assert OpeningRangeBreakout(ORBParams(min_range_points=12), 0.25).signal(bars) is None


def test_flat_time_must_beat_topstep_deadline():
    with pytest.raises(ValueError):
        ORBParams(flat_time=time(15, 9))


def _day_with(*after):
    return opening_day() + [bar(MONDAY, hhmm, *ohlc) for hhmm, *ohlc in after]


def test_target_exit_with_slippage():
    trade = simulate_day(MONDAY, _day_with(("08:55", 5013, 5040, 5012, 5035)), STRAT, INST)
    entry = 5012.5 + 0.25
    target = round_to_tick(entry + 1.5 * (entry - 4999), 0.25)
    assert (trade.entry, trade.target, trade.reason) == (entry, target, "target")
    assert trade.exit == target - 0.25
    assert trade.pnl_points == pytest.approx(target - 0.25 - entry)


def test_stop_exit_and_worst_case_when_both_touched():
    stopped = simulate_day(MONDAY, _day_with(("08:55", 5012, 5013, 4998, 5000)), STRAT, INST)
    both = simulate_day(MONDAY, _day_with(("08:55", 5012, 5060, 4990, 5020)), STRAT, INST)
    for trade in (stopped, both):
        assert trade.reason == "stop"
        assert trade.exit == 4999 - 0.25
        assert trade.mae_points == trade.pnl_points == pytest.approx(4998.75 - 5012.75)


def test_gap_through_stop_fills_at_the_open():
    trade = simulate_day(MONDAY, _day_with(("08:55", 4990, 4995, 4985, 4992)), STRAT, INST)
    assert (trade.reason, trade.exit) == ("stop", 4990 - 0.25)


def _quiet_until(end: str):
    """Sideways 5-minute bars from 08:55 up to (not including) `end`, never near stop or target."""
    out, minute, stop = [], 8 * 60 + 55, int(end[:2]) * 60 + int(end[3:])
    while minute < stop:
        out.append((f"{minute // 60:02d}:{minute % 60:02d}", 5013, 5015, 5011, 5014))
        minute += 5
    return out


def test_flat_time_exit():
    trade = simulate_day(MONDAY, _day_with(*_quiet_until("15:00"), ("15:00", 5016, 5017, 5015, 5016)), STRAT, INST)
    assert (trade.reason, trade.exit) == ("flat", 5016 - 0.25)


def test_early_close_exits_at_the_last_bar():
    trade = simulate_day(MONDAY, _day_with(*_quiet_until("12:00"), ("17:00", 5030, 5031, 5029, 5030)), STRAT, INST)
    assert (trade.reason, trade.exit) == ("session_end", 5014 - 0.25)
    assert trade.exit_time == ct(MONDAY, "11:55")


def test_position_size_respects_risk_and_room():
    risk = RiskParams()
    # 13.5 points + 4 ticks slippage at $5 a point, plus $1 fees = $73.50 a contract
    assert position_size(13.5, INST, risk) == 2
    assert position_size(13.5, INST, risk, room=250 + 73.5) == 1
    assert position_size(13.5, INST, risk, room=300) == 0
    assert position_size(0, INST, risk) == 0
    assert position_size(1, INST, RiskParams(risk_per_trade=10_000, max_contracts=5)) == 5


def test_random_prices_give_no_edge():
    """On a pure random walk the average trade should lose about its costs, never show a profit."""
    days = backtest(synthetic_bars(days=1500, seed=3), STRAT, INST)
    stats = backtest_stats(days, INST, RiskParams(), room=2000)
    assert stats.trades > 1000
    per_trade = stats.total / stats.trades
    assert -40 < per_trade < 5
