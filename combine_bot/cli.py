"""Command line: demo, backtest, check, fetch and run."""
from __future__ import annotations

import argparse
import time as _time
from dataclasses import replace
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

from .bars import CT, Bar, bar_minutes, load_csv, resample, save_csv
from .combine import simulate_attempts, summarize_attempts
from .config import Config, load_config
from .contracts import contract_id, segments
from .live import LiveBot
from .projectx import MAX_BARS, ProjectXClient, ProjectXError
from .report import format_backtest, format_combine, write_trades
from .sim import backtest, backtest_stats
from .strategy import OpeningRangeBreakout
from .synthetic import synthetic_bars


def _report(cfg: Config, bars: list[Bar], trades_out: str | None = None) -> int:
    strategy = OpeningRangeBreakout(cfg.strategy, cfg.instrument.tick_size)
    days = backtest(bars, strategy, cfg.instrument)
    stats = backtest_stats(days, cfg.instrument, cfg.risk, room=cfg.combine.max_loss)
    if stats is None:
        print("No trades in this data. Check that it covers the 8:30 AM to 3:00 PM CT day session.")
        return 1
    print(format_backtest(stats, cfg.instrument))
    print()
    attempts = simulate_attempts(days, cfg.combine, cfg.risk, cfg.instrument)
    print(format_combine(summarize_attempts(attempts), cfg.combine))
    if trades_out:
        write_trades(days, cfg.instrument, cfg.risk, cfg.combine.max_loss, trades_out)
        print(f"\nEvery trade was written to {trades_out}")
    return 0


def _load_bars(cfg: Config, path: str, tz: str) -> list[Bar]:
    bars = load_csv(path, tz)
    size, want = bar_minutes(bars), cfg.strategy.bar_minutes
    if size == want:
        return bars
    if size < want and want % size == 0:
        return resample(bars, want)
    raise SystemExit(f"{path} has {size}-minute bars, but the strategy needs {want}-minute bars "
                     f"(or smaller bars that add up to {want} minutes).")


def _client(cfg: Config) -> ProjectXClient:
    return ProjectXClient(cfg.api.base_url, cfg.api.username, cfg.api.api_key)


def _utc_midnight(d: date) -> datetime:
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc)


def _logger(path: str):
    Path(path).parent.mkdir(parents=True, exist_ok=True)

    def log(message: str) -> None:
        line = f"{datetime.now(CT):%Y-%m-%d %H:%M:%S} CT  {message}"
        print(line, flush=True)
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")

    return log


def cmd_demo(cfg: Config, args: argparse.Namespace) -> int:
    print("DEMO ON MADE-UP PRICES. This shows what the reports look like; "
          "the numbers say nothing about real markets.\n")
    return _report(cfg, synthetic_bars(days=args.days, seed=args.seed))


def cmd_backtest(cfg: Config, args: argparse.Namespace) -> int:
    return _report(cfg, _load_bars(cfg, args.data, args.tz), args.trades)


def cmd_check(cfg: Config, args: argparse.Namespace) -> int:
    client = _client(cfg)
    client.login()
    print("Logged in to TopstepX. Accounts:")
    for a in client.accounts():
        status = "can trade" if a.get("canTrade") else "cannot trade"
        print(f"  {a.get('id')}  {a.get('name')}  balance {a.get('balance')}  ({status})")
    bot = LiveBot(client, cfg, live=False)
    bot.connect()
    now = datetime.now(timezone.utc)
    bars = client.bars(bot.contract_id, now - timedelta(days=5), now, cfg.strategy.bar_minutes,
                       limit=2000, live=cfg.api.live_data)
    if bars:
        print(f"Latest {cfg.strategy.bar_minutes}-minute bar: {bars[-1].local:%Y-%m-%d %H:%M} CT, close {bars[-1].close:g}")
    else:
        print("TopstepX returned no recent price bars.")
    print("The connection works. Nothing was traded.")
    return 0


def cmd_fetch(cfg: Config, args: argparse.Namespace) -> int:
    client = _client(cfg)
    client.login()
    minutes = args.minutes or cfg.strategy.bar_minutes
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=args.days)
    if args.contract:
        pieces = [(args.contract, start, end)]
    else:
        pieces = [(contract_id(cfg.instrument.symbol, y, m), _utc_midnight(a), _utc_midnight(b))
                  for y, m, a, b in segments(start.date(), end.date() + timedelta(days=1))]
    chunk = timedelta(days=max(1, int(MAX_BARS * minutes / 1440 * 0.8)))
    collected: dict[datetime, Bar] = {}
    print(f"Downloading {minutes}-minute bars, {args.days} days back:")
    for cid, a, b in pieces:
        count = 0
        t = a
        while t < b:
            u = min(t + chunk, b)
            try:
                got = client.bars(cid, t, u, minutes, live=cfg.api.live_data)
            except ProjectXError as exc:
                print(f"  {cid}: {exc}")
                break
            for bar in got:
                collected[bar.start] = bar
            count += len(got)
            t = u
            _time.sleep(0.7)  # the bars endpoint allows 50 requests per 30 seconds
        print(f"  {cid}  {a:%Y-%m-%d} to {b:%Y-%m-%d}: {count} bars")
    if not collected:
        print("No bars came back. TopstepX may not keep history that far back; try a smaller --days.")
        return 1
    bars = [collected[k] for k in sorted(collected)]
    save_csv(bars, args.out)
    print(f"Saved {len(bars)} bars ({bars[0].local:%Y-%m-%d} to {bars[-1].local:%Y-%m-%d}) to {args.out}")
    print(f"Next: python -m combine_bot backtest --data {args.out}")
    return 0


def cmd_run(cfg: Config, args: argparse.Namespace) -> int:
    if args.flat_time:
        cfg = replace(cfg, strategy=replace(cfg.strategy, flat_time=time.fromisoformat(args.flat_time)))
    log = _logger(cfg.bot.log_file)
    bot = LiveBot(_client(cfg), cfg, live=args.live, log=log)
    bot.connect()
    if args.live and not args.yes:
        answer = input(f"Type YES to let the bot place orders on account {bot.account_name}: ")
        if answer.strip() != "YES":
            print("Not started.")
            return 1
    stop_note = " Any open bot trade will be closed." if args.live else ""
    log(f"Running. Keep this window open and the computer awake. Press Ctrl+C to stop.{stop_note}")
    bot.loop()
    return 0


def main(argv: list[str] | None = None) -> int:
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--config", default="config.toml", help="settings file (default: config.toml)")
    parser = argparse.ArgumentParser(
        prog="python -m combine_bot",
        description="Opening-range breakout bot and Topstep Combine simulator.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    demo = sub.add_parser("demo", parents=[common], help="see the reports on made-up prices")
    demo.add_argument("--days", type=int, default=500, help="trading days of fake data (default 500)")
    demo.add_argument("--seed", type=int, default=1, help="change for a different fake history")

    bt = sub.add_parser("backtest", parents=[common], help="test the strategy and the Combine on real price history")
    bt.add_argument("--data", required=True, help="CSV of price bars (from 'fetch' or elsewhere)")
    bt.add_argument("--tz", default="UTC", help="time zone for CSV times without an offset (default UTC)")
    bt.add_argument("--trades", help="also write every trade to this CSV file")

    sub.add_parser("check", parents=[common], help="test the TopstepX connection; never trades")

    fetch = sub.add_parser("fetch", parents=[common], help="download price history from TopstepX")
    fetch.add_argument("--days", type=int, default=365, help="how far back to go (default 365)")
    fetch.add_argument("--out", default="data/MES_5m.csv", help="where to save (default data/MES_5m.csv)")
    fetch.add_argument("--minutes", type=int, help="bar size (default: the strategy's bar_minutes)")
    fetch.add_argument("--contract", help="fetch one contract id instead of rolling front months")

    run = sub.add_parser("run", parents=[common], help="run the bot (practice mode unless --live)")
    run.add_argument("--live", action="store_true", help="actually place orders")
    run.add_argument("--yes", action="store_true", help="skip the confirmation question for --live")
    run.add_argument("--flat-time", help="close earlier today, e.g. 11:45 on early-close holidays")

    args = parser.parse_args(argv)
    try:
        cfg = load_config(args.config)
    except (ValueError, OSError) as exc:
        print(f"Problem with the settings in {args.config}: {exc}")
        return 2
    handlers = {"demo": cmd_demo, "backtest": cmd_backtest, "check": cmd_check, "fetch": cmd_fetch, "run": cmd_run}
    try:
        return handlers[args.command](cfg, args)
    except ProjectXError as exc:
        print(f"TopstepX problem: {exc}")
    except (OSError, ValueError) as exc:
        print(f"Problem: {exc}")
    return 1
