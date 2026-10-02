"""Plain-English text reports for the backtest, the trade picker and the Combine simulation."""
from __future__ import annotations

import csv
from datetime import datetime
from pathlib import Path

from .bars import CT
from .combine import FAILED, INCOMPLETE, PASSED, STUCK, TIMEOUT, CombineRules, CombineSummary
from .lab import PickerLab, suggested_checks
from .picker import PickerParams
from .risk import Instrument, RiskParams, position_size
from .sim import BacktestStats, Day, trade_pnl
from .strategy import LONG


def money(x: float) -> str:
    return f"-${-x:,.0f}" if x < 0 else f"${x:,.0f}"


def format_backtest(s: BacktestStats, inst: Instrument, picker_note: str = "") -> str:
    pf = f"{s.profit_factor:.2f}" if s.profit_factor is not None else "n/a (no losing trades)"
    lines = [
        f"STRATEGY RESULTS  {s.first_day} to {s.last_day}  ({s.trading_days} trading days)",
    ]
    if picker_note:
        lines.append(f"  {picker_note}")
    lines += [
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


def format_picker(lab: PickerLab, params: PickerParams) -> str:
    state = "on" if params.enabled else "OFF (enabled = false), shown for comparison"
    lines = [
        f"TRADE PICKER  (the 'secret sauce'; currently {state})",
        f"  Average result per trade, older data (before {lab.split}) vs newer data (from then on):",
        f"  {'':<34}{'Older data':>22}{'Newer data':>22}",
        f"  {'':<34}{'trades':>10}{'per trade':>12}{'trades':>10}{'per trade':>12}   Verdict",
    ]
    for row in lab.rows:
        cells = "".join(
            f"{part.trades:>10}{money(part.per_trade) if part.per_trade is not None else '-':>12}"
            for part in (row.older, row.newer)
        )
        lines.append(f"  {row.label:<34}{cells}   {row.verdict}".rstrip())
    if not lab.has_volume:
        lines.append("  This price file has no volume figures, so the volume check can't run on it.")
    helped = suggested_checks(lab)
    if helped:
        flags = ", ".join(f"use_{name} = {'true' if name in helped else 'false'}"
                          for name in ("volume", "range", "trend") if name != "volume" or lab.has_volume)
        lines += [
            f"  Checks that picked clearly better trades here: {', '.join(helped)}. To use only those, set",
            f"  under [picker] in config.toml: enabled = true, {flags}",
            "  then run the backtest again and compare the Combine PASS RATE columns below. Skipping trades",
            "  also means passing more slowly, so better trades don't always mean more passes.",
        ]
    else:
        lines += [
            "  None of the checks clearly picked better trades on this data. Simplest choice: switch the",
            "  picker off (enabled = false under [picker] in config.toml).",
        ]
    lines.append("  Don't keep adjusting thresholds until every row looks good: that just fits the past.")
    return "\n".join(lines)


def format_combine(columns: list[tuple[str, CombineSummary]], rules: CombineRules) -> str:
    def row(label: str, values: list[str]) -> str:
        return f"  {label:<48}" + "".join(f"{v:>16}" for v in values)

    summaries = [s for _, s in columns]
    lines = [
        f"TOPSTEP COMBINE SIMULATION  ({money(rules.start_balance)} account, +{money(rules.profit_target)} "
        f"target, {money(rules.max_loss)} Maximum Loss Limit)",
        f"  Started the Combine on each of {summaries[0].attempts} past days.",
        row("", [label for label, _ in columns]),
        row("Passed", [str(s.counts.get(PASSED, 0)) for s in summaries]),
        row("Failed (hit the loss limit)", [str(s.counts.get(FAILED, 0)) for s in summaries]),
        row("Stuck too close to the limit", [str(s.counts.get(STUCK, 0)) for s in summaries]),
        row(f"Not passed within {rules.max_calendar_days} days", [str(s.counts.get(TIMEOUT, 0)) for s in summaries]),
        row("Still going when the data ran out (not counted)", [str(s.counts.get(INCOMPLETE, 0)) for s in summaries]),
        row("PASS RATE", [f"{s.pass_rate:.0%}" if s.pass_rate is not None else "-" for s in summaries]),
        row("Typical calendar days to pass",
            [f"{s.median_days_to_pass:.0f}" if s.median_days_to_pass is not None else "-" for s in summaries]),
        row("Average cost per attempt", [money(s.avg_cost) if s.avg_cost is not None else "-" for s in summaries]),
        row("Expected spend to get one pass",
            [money(s.spend_per_pass) if s.spend_per_pass is not None else "never passed" for s in summaries]),
    ]
    for label, s in columns:
        if len(s.by_year) > 1:
            lines.append(f"  Pass rate by start year ({label.lower()}): " + "; ".join(
                f"{y}: {p / n:.0%} of {n}" for y, (p, n) in s.by_year.items()))
    if len(summaries) == 2 and None not in (summaries[0].pass_rate, summaries[1].pass_rate):
        with_picker, every = summaries[0].pass_rate, summaries[1].pass_rate
        if with_picker > every + 0.02:
            lines.append(f"  BOTTOM LINE: the picker raised the pass rate on this data ({with_picker:.0%} vs {every:.0%}).")
        elif with_picker < every - 0.02:
            lines.append(f"  BOTTOM LINE: the picker lowered the pass rate on this data ({with_picker:.0%} vs {every:.0%}); "
                         "taking every breakout did better.")
        else:
            lines.append(f"  BOTTOM LINE: the picker made little difference to the pass rate ({with_picker:.0%} vs {every:.0%}).")
    monthly = rules.monthly_fee + rules.api_monthly_fee
    lines += [
        f"  Costs assume {money(monthly)}/month (Combine plus API). Attempts that start on nearby days",
        "  overlap, so there are fewer truly separate tries than the count suggests.",
    ]
    return "\n".join(lines)


def write_trades(days: list[Day], inst: Instrument, risk: RiskParams, room: float, path: str | Path,
                 use_picker: bool = True) -> None:
    """Every breakout, whether it was taken, and the picker's readings."""
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["day", "side", "picked", "entry_time_ct", "entry", "stop", "target", "exit_time_ct",
                         "exit", "exit_reason", "contracts", "pnl", "volume_vs_usual", "range_share",
                         "trend_points"])
        for d in days:
            t, s = d.trade, d.score
            if t is None:
                continue
            n = position_size(t.risk_points, inst, risk, room)
            writer.writerow([
                d.day, "long" if t.side == LONG else "short", "yes" if s.ok or not use_picker else "no",
                _hhmm(t.entry_time), t.entry, t.stop, t.target, _hhmm(t.exit_time), t.exit, t.reason, n,
                round(trade_pnl(t, n, inst), 2) if n else 0,
                _num(s.rvol, 2), _num(s.range_share, 2), _num(s.trend_points, 2),
            ])


def _hhmm(dt: datetime) -> str:
    return dt.astimezone(CT).strftime("%H:%M")


def _num(x: float | None, digits: int) -> str:
    return "" if x is None else f"{x:.{digits}f}"
