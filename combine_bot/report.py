"""Plain-English text reports for the backtest and the Combine simulation."""
from __future__ import annotations

import csv
from datetime import date, datetime
from pathlib import Path

from .bars import CT
from .combine import FAILED, INCOMPLETE, PASSED, STUCK, TIMEOUT, CombineRules, CombineSummary
from .risk import Instrument, RiskParams, position_size
from .sim import BacktestStats, Trade, trade_pnl
from .strategy import LONG


def money(x: float) -> str:
    return f"-${-x:,.0f}" if x < 0 else f"${x:,.0f}"


def format_backtest(s: BacktestStats, inst: Instrument) -> str:
    pf = f"{s.profit_factor:.2f}" if s.profit_factor is not None else "n/a (no losing trades)"
    lines = [
        f"STRATEGY RESULTS  {s.first_day} to {s.last_day}  ({s.trading_days} trading days)",
        f"  Trades                {s.trades}" + (f"   (skipped {s.skipped}: stop too far for the risk limit)" if s.skipped else ""),
        f"  Winners               {s.wins} ({s.win_rate:.0%})",
        f"  Average win / loss    {money(s.avg_win)} / {money(s.avg_loss)}",
        f"  Profit factor         {pf}   (above 1.0 means it made money overall)",
        f"  Total profit          {money(s.total)}   (about {s.avg_contracts:.1f} {inst.symbol} contracts per trade)",
        f"  Biggest drop          {money(-s.max_drawdown)}   (from a high point to the next low)",
        f"  Best / worst trade    {money(s.best_trade)} / {money(s.worst_trade)}",
        "  How trades ended      " + ", ".join(f"{name} {count}" for name, count in sorted(s.exits.items())),
        "  By year               " + "; ".join(f"{y}: {n} trades, {money(p)}" for y, (n, p) in s.by_year.items()),
    ]
    return "\n".join(lines)


def format_combine(s: CombineSummary, rules: CombineRules) -> str:
    c = s.counts
    finished = s.attempts - c.get(INCOMPLETE, 0)
    lines = [
        f"TOPSTEP COMBINE SIMULATION  ({money(rules.start_balance)} account, +{money(rules.profit_target)} "
        f"target, {money(rules.max_loss)} Maximum Loss Limit)",
        f"  Started the Combine on each of {s.attempts} past days. Of the {finished} attempts that finished:",
        f"    Passed                          {c.get(PASSED, 0)}",
        f"    Failed (hit the loss limit)     {c.get(FAILED, 0)}",
        f"    Stuck too close to the limit    {c.get(STUCK, 0)}",
        f"    {f'Not passed within {rules.max_calendar_days} days':<32}{c.get(TIMEOUT, 0)}",
    ]
    if c.get(INCOMPLETE):
        lines.append(f"  ({c[INCOMPLETE]} more were still going when the data ran out; not counted)")
    if s.pass_rate is None:
        lines.append("  Not enough data to finish any attempt. Use a longer price history.")
        return "\n".join(lines)
    lines.append(f"  PASS RATE                         {s.pass_rate:.0%}")
    if s.median_days_to_pass is not None:
        lines.append(f"  Typical time to pass              {s.median_days_to_pass:.0f} calendar days "
                     f"({s.median_trading_days_to_pass:.0f} trading days)")
    monthly = rules.monthly_fee + rules.api_monthly_fee
    lines.append(f"  Average cost per attempt          {money(s.avg_cost)}   ({money(monthly)}/month incl. API)")
    if s.spend_per_pass is not None:
        lines.append(f"  Expected spend to get one pass    {money(s.spend_per_pass)}")
    else:
        lines.append("  Expected spend to get one pass    never passed in this data")
    if len(s.by_year) > 1:
        lines.append("  Pass rate by start year           " + "; ".join(
            f"{y}: {p / n:.0%} of {n}" for y, (p, n) in s.by_year.items()))
    lines.append("  Attempts that start on nearby days overlap, so there are fewer truly separate tries than it looks.")
    return "\n".join(lines)


def write_trades(days: list[tuple[date, Trade | None]], inst: Instrument, risk: RiskParams,
                 room: float, path: str | Path) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["day", "side", "entry_time_ct", "entry", "stop", "target", "exit_time_ct", "exit",
                         "exit_reason", "contracts", "pnl"])
        for day, t in days:
            if t is None:
                continue
            n = position_size(t.risk_points, inst, risk, room)
            if n == 0:
                continue
            writer.writerow([
                day, "long" if t.side == LONG else "short", _hhmm(t.entry_time), t.entry, t.stop, t.target,
                _hhmm(t.exit_time), t.exit, t.reason, n, round(trade_pnl(t, n, inst), 2),
            ])


def _hhmm(dt: datetime) -> str:
    return dt.astimezone(CT).strftime("%H:%M")
