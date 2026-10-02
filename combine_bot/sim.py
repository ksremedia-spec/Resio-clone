"""Backtest: replays each past day's bars through the strategy with conservative fills."""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from .bars import Bar, by_day, round_to_tick
from .picker import DayStats, PickerParams, Score, context, day_stats, score
from .risk import Instrument, RiskParams, position_size
from .strategy import ORBParams, OpeningRangeBreakout, Signal

# A pause this long between bars means the session ended (early close or missing data).
SESSION_GAP = timedelta(minutes=30)


@dataclass(frozen=True)
class Trade:
    day: date
    side: int
    entry_time: datetime
    entry: float
    stop: float
    target: float
    exit_time: datetime
    exit: float
    reason: str  # "target", "stop", "flat" or "session_end"
    risk_points: float  # entry-to-stop distance per contract
    pnl_points: float  # realised per contract after slippage, before fees
    mae_points: float  # worst open loss per contract during the trade (<= 0)


def simulate_day(day: date, bars: list[Bar], strategy: OpeningRangeBreakout, inst: Instrument,
                 signal: Signal | None = None) -> Trade | None:
    """Trade one day. Fills: market entry at the next bar's open, stop first when a bar touches
    both stop and target, gaps through the stop fill at the open, slippage on every market exit."""
    p = strategy.p
    signal = signal or strategy.signal(bars)
    if signal is None or signal.index + 1 >= len(bars):
        return None
    k = signal.index + 1
    entry_bar = bars[k]
    if entry_bar.local.time() >= p.flat_time or entry_bar.start - bars[signal.index].start > SESSION_GAP:
        return None
    side, stop = signal.side, signal.stop
    slip = inst.slippage_ticks * inst.tick_size
    entry = entry_bar.open + side * slip
    risk = side * (entry - stop)
    if risk <= 0:
        return None
    target = round_to_tick(entry + side * p.reward_risk * risk, inst.tick_size)
    worst = 0.0
    exit_price = exit_time = reason = None
    for j in range(k, len(bars)):
        b = bars[j]
        if j > k:
            prev = bars[j - 1]
            if b.start - prev.start > SESSION_GAP:
                exit_price, exit_time, reason = prev.close - side * slip, prev.start, "session_end"
                break
            if b.local.time() >= p.flat_time:
                exit_price, exit_time, reason = b.open - side * slip, b.start, "flat"
                break
        adverse, favourable = (b.low, b.high) if side > 0 else (b.high, b.low)
        if side * (adverse - stop) <= 0:
            fill = b.open if side * (b.open - stop) < 0 else stop
            exit_price, exit_time, reason = fill - side * slip, b.start, "stop"
            break
        worst = min(worst, side * (adverse - entry))
        if side * (favourable - target) >= 0:
            fill = b.open if side * (b.open - target) > 0 else target
            exit_price, exit_time, reason = fill - side * slip, b.start, "target"
            break
    if exit_price is None:
        last = bars[-1]
        exit_price, exit_time, reason = last.close - side * slip, last.start, "session_end"
    pnl = side * (exit_price - entry)
    return Trade(
        day, side, entry_bar.start, entry, stop, target, exit_time, exit_price, reason,
        risk, pnl, min(worst, pnl),
    )


def sessions(bars: list[Bar], params: ORBParams) -> list[tuple[date, list[Bar]]]:
    """Trading days: weekdays with bars inside the strategy's trading hours."""
    return [
        (day, day_bars) for day, day_bars in by_day(bars)
        if day.weekday() < 5 and any(params.range_start <= b.local.time() < params.flat_time for b in day_bars)
    ]


@dataclass(frozen=True)
class Day:
    day: date
    trade: Trade | None  # the day's first breakout, before the trade picker
    score: Score | None  # the picker's verdict on that breakout


def backtest(bars: list[Bar], strategy: OpeningRangeBreakout, inst: Instrument,
             picker: PickerParams | None = None) -> list[Day]:
    """Every trading day with its first breakout (if any) and the trade picker's score for it.

    The picker only sees earlier days plus today's opening range, as the live bot would."""
    picker = picker or PickerParams()
    has_volume = any(b.volume > 0 for b in bars)
    history: list[DayStats] = []
    out = []
    for day, day_bars in sessions(bars, strategy.p):
        stats = day_stats(day, day_bars, strategy.p)
        signal = strategy.signal(day_bars)
        trade = simulate_day(day, day_bars, strategy, inst, signal) if signal else None
        verdict = score(signal, stats.or_volume, context(history, picker), picker, has_volume=has_volume) if trade else None
        out.append(Day(day, trade, verdict))
        history.append(stats)
    return out


def chosen(days: list[Day], use_picker: bool = True) -> list[tuple[date, Trade | None]]:
    """The trades actually taken: only those the picker passes, or every breakout."""
    return [(d.day, d.trade if d.trade and (not use_picker or d.score.ok) else None) for d in days]


def trade_pnl(trade: Trade, contracts: int, inst: Instrument) -> float:
    return contracts * (trade.pnl_points * inst.point_value - inst.commission_rt)


@dataclass(frozen=True)
class BacktestStats:
    first_day: date
    last_day: date
    trading_days: int
    trades: int
    skipped: int
    wins: int
    avg_win: float
    avg_loss: float
    profit_factor: float | None
    total: float
    max_drawdown: float
    best_trade: float
    worst_trade: float
    avg_contracts: float
    exits: dict[str, int]
    by_year: dict[int, tuple[int, float]]

    @property
    def win_rate(self) -> float:
        return self.wins / self.trades if self.trades else 0.0


def backtest_stats(days: list[tuple[date, Trade | None]], inst: Instrument, risk: RiskParams, room: float) -> BacktestStats | None:
    """Results with every trade sized as on a fresh account (`room` = distance to the loss limit)."""
    pnls: list[float] = []
    contracts: list[int] = []
    exits: Counter[str] = Counter()
    years: dict[int, list[float]] = defaultdict(list)
    skipped = 0
    for day, trade in days:
        if trade is None:
            continue
        n = position_size(trade.risk_points, inst, risk, room)
        if n == 0:
            skipped += 1
            continue
        pnl = trade_pnl(trade, n, inst)
        pnls.append(pnl)
        contracts.append(n)
        exits[trade.reason] += 1
        years[day.year].append(pnl)
    if not days or not pnls:
        return None
    equity = peak = drawdown = 0.0
    for pnl in pnls:
        equity += pnl
        peak = max(peak, equity)
        drawdown = max(drawdown, peak - equity)
    wins = [x for x in pnls if x > 0]
    losses = [x for x in pnls if x <= 0]
    gross_loss = -sum(losses)
    return BacktestStats(
        first_day=days[0][0],
        last_day=days[-1][0],
        trading_days=len(days),
        trades=len(pnls),
        skipped=skipped,
        wins=len(wins),
        avg_win=sum(wins) / len(wins) if wins else 0.0,
        avg_loss=sum(losses) / len(losses) if losses else 0.0,
        profit_factor=sum(wins) / gross_loss if gross_loss > 0 else None,
        total=sum(pnls),
        max_drawdown=drawdown,
        best_trade=max(pnls),
        worst_trade=min(pnls),
        avg_contracts=sum(contracts) / len(contracts),
        exits=dict(exits),
        by_year={y: (len(v), sum(v)) for y, v in sorted(years.items())},
    )
