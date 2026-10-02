"""Topstep Trading Combine rules, and a simulator that starts the Combine on every past day."""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date
from statistics import median

from .risk import Instrument, RiskParams, position_size
from .sim import Trade

PASSED, FAILED, STUCK, TIMEOUT, INCOMPLETE = "passed", "failed", "stuck", "timeout", "incomplete"


@dataclass(frozen=True)
class CombineRules:
    start_balance: float = 50_000.0
    profit_target: float = 3_000.0
    max_loss: float = 2_000.0  # Maximum Loss Limit distance, trailing end-of-day balance highs
    consistency: float = 0.5  # best day may be at most this share of the profit; 0 turns it off
    min_trading_days: int = 2
    monthly_fee: float = 95.0
    activation_fee: float = 0.0
    api_monthly_fee: float = 14.50
    max_calendar_days: int = 180  # give up on an attempt that hasn't passed after this long

    def target(self, best_day: float) -> float:
        """Profit needed to pass. A single big day raises it under the consistency rule."""
        if self.consistency > 0:
            return max(self.profit_target, best_day / self.consistency)
        return self.profit_target

    def trail(self, mll: float, eod_balance: float) -> float:
        """The Maximum Loss Limit follows end-of-day balance highs and locks at the starting balance."""
        return min(self.start_balance, max(mll, eod_balance - self.max_loss))

    def cost(self, calendar_days: int, passed: bool) -> float:
        """Subscription months started (any part of a month is billed) plus activation on a pass."""
        months = calendar_days // 30 + 1
        return months * (self.monthly_fee + self.api_monthly_fee) + (self.activation_fee if passed else 0.0)


@dataclass(frozen=True)
class Attempt:
    start: date
    end: date
    outcome: str
    trading_days: int
    profit: float
    cost: float

    @property
    def calendar_days(self) -> int:
        return (self.end - self.start).days


def run_attempt(days: list[tuple[date, Trade | None]], first: int, rules: CombineRules,
                risk: RiskParams, inst: Instrument) -> Attempt:
    """Play the Combine from `days[first]` until it passes, fails or runs out of time or data.

    Failure is checked against the worst open loss inside each trade, because Topstep enforces
    the Maximum Loss Limit in real time, unrealised losses included.
    """
    start = days[first][0]
    balance = rules.start_balance
    mll = rules.start_balance - rules.max_loss
    best_day = 0.0
    traded = 0

    def finish(outcome: str, end: date, final_balance: float) -> Attempt:
        return Attempt(start, end, outcome, traded, final_balance - rules.start_balance,
                       rules.cost((end - start).days, outcome == PASSED))

    day = start
    for day, trade in days[first:]:
        if (day - start).days >= rules.max_calendar_days:
            return finish(TIMEOUT, day, balance)
        if trade is not None:
            n = position_size(trade.risk_points, inst, risk, balance - mll)
            if n == 0 and position_size(trade.risk_points, inst, risk) > 0:
                # The trade was fine but the account is too close to the limit to take it safely.
                return finish(STUCK, day, balance)
            if n > 0:
                fees = n * inst.commission_rt
                if balance + n * trade.mae_points * inst.point_value - fees <= mll:
                    return finish(FAILED, day, mll)
                pnl = n * trade.pnl_points * inst.point_value - fees
                balance += pnl
                best_day = max(best_day, pnl)
                traded += 1
        mll = rules.trail(mll, balance)
        if balance - rules.start_balance >= rules.target(best_day) and traded >= rules.min_trading_days:
            return finish(PASSED, day, balance)
    return finish(INCOMPLETE, day, balance)


def simulate_attempts(days: list[tuple[date, Trade | None]], rules: CombineRules,
                      risk: RiskParams, inst: Instrument) -> list[Attempt]:
    return [run_attempt(days, i, rules, risk, inst) for i in range(len(days))]


@dataclass(frozen=True)
class CombineSummary:
    attempts: int
    counts: dict[str, int]
    pass_rate: float | None
    median_days_to_pass: float | None
    median_trading_days_to_pass: float | None
    avg_cost: float | None
    spend_per_pass: float | None
    by_year: dict[int, tuple[int, int]]  # start year -> (passed, finished)


def summarize_attempts(attempts: list[Attempt]) -> CombineSummary:
    finished = [a for a in attempts if a.outcome != INCOMPLETE]
    passed = [a for a in finished if a.outcome == PASSED]
    years: dict[int, list[int]] = defaultdict(lambda: [0, 0])
    for a in finished:
        years[a.start.year][0] += a.outcome == PASSED
        years[a.start.year][1] += 1
    total_cost = sum(a.cost for a in finished)
    return CombineSummary(
        attempts=len(attempts),
        counts=dict(Counter(a.outcome for a in attempts)),
        pass_rate=len(passed) / len(finished) if finished else None,
        median_days_to_pass=median(a.calendar_days for a in passed) if passed else None,
        median_trading_days_to_pass=median(a.trading_days for a in passed) if passed else None,
        avg_cost=total_cost / len(finished) if finished else None,
        spend_per_pass=total_cost / len(passed) if passed else None,
        by_year={y: (p, n) for y, (p, n) in sorted(years.items())},
    )
