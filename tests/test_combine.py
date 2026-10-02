from datetime import date, datetime, timedelta, timezone

import pytest

from combine_bot.combine import (FAILED, INCOMPLETE, PASSED, STUCK, TIMEOUT, Attempt, CombineRules,
                                 run_attempt, summarize_attempts)
from combine_bot.risk import Instrument, RiskParams
from combine_bot.sim import Trade

INST, RISK, RULES = Instrument(), RiskParams(), CombineRules()
T0 = datetime(2026, 1, 1, tzinfo=timezone.utc)


def weekdays(n: int, start: date = date(2026, 1, 5)) -> list[date]:
    out, day = [], start
    while len(out) < n:
        if day.weekday() < 5:
            out.append(day)
        day += timedelta(days=1)
    return out


def trade(day: date, pnl: float, mae: float | None = None, risk: float = 10.0) -> Trade:
    # risk 10 points -> $56 a contract at risk -> 3 contracts for the $200 limit
    return Trade(day, 1, T0, 5000, 4990, 5015, T0, 5000 + pnl, "x", risk, pnl, min(0.0, pnl) if mae is None else mae)


def test_steady_winner_passes_and_is_billed_one_month():
    days = [(d, trade(d, 15)) for d in weekdays(30)]  # 3 x (15 x $5 - $1) = $222 a day
    attempt = run_attempt(days, 0, RULES, RISK, INST)
    assert attempt.outcome == PASSED
    assert attempt.trading_days == 14  # 14 x 222 = 3108 >= 3000
    assert attempt.cost == pytest.approx(95 + 14.5)


def test_intraday_drawdown_fails_even_if_the_day_recovers():
    d = weekdays(1)[0]
    attempt = run_attempt([(d, trade(d, 5, mae=-200))], 0, RULES, RISK, INST)
    assert attempt.outcome == FAILED


def test_loss_limit_trails_end_of_day_highs():
    d1, d2, d3 = weekdays(3)
    # Day 1 makes $1,497, lifting the limit from $48,000 to $49,497. Day 2 gives back $1,503.
    # Day 3 dips $603 intraday: that breaks the trailed limit even though it's far above $48,000.
    days = [(d1, trade(d1, 100)), (d2, trade(d2, -100)), (d3, trade(d3, 0, mae=-40))]
    attempt = run_attempt(days, 0, RULES, RISK, INST)
    assert attempt.outcome == FAILED and attempt.end == d3
    assert attempt.profit == pytest.approx(49_497 - 50_000)


def test_trail_locks_at_starting_balance_and_consistency_raises_target():
    assert RULES.trail(48_000, 53_500) == 50_000
    assert RULES.trail(49_000, 50_500) == 49_000
    assert RULES.target(1_000) == 3_000
    assert RULES.target(2_000) == 4_000
    assert CombineRules(consistency=0).target(2_000) == 3_000


def test_losing_streak_ends_stuck_near_the_limit_instead_of_failing():
    days = [(d, trade(d, -11)) for d in weekdays(20)]
    attempt = run_attempt(days, 0, RULES, RISK, INST)
    assert attempt.outcome == STUCK
    assert attempt.profit > -RULES.max_loss


def test_timeout_and_incomplete():
    quiet = [(d, None) for d in weekdays(40)]
    assert run_attempt(quiet, 0, CombineRules(max_calendar_days=20), RISK, INST).outcome == TIMEOUT
    assert run_attempt(quiet[:5], 0, RULES, RISK, INST).outcome == INCOMPLETE


def test_summary_counts_cost_per_pass():
    d = date(2026, 1, 5)
    attempts = [
        Attempt(d, d + timedelta(days=40), PASSED, 20, 3000, 219),
        Attempt(d, d + timedelta(days=10), FAILED, 5, -2000, 109.5),
        Attempt(d, d + timedelta(days=10), FAILED, 5, -2000, 109.5),
        Attempt(d, d + timedelta(days=3), INCOMPLETE, 1, 0, 109.5),
    ]
    s = summarize_attempts(attempts)
    assert s.pass_rate == pytest.approx(1 / 3)
    assert s.spend_per_pass == pytest.approx(438)
    assert s.median_days_to_pass == 40
