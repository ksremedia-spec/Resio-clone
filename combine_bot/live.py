"""The live bot: polls TopstepX through the ProjectX API and trades the same rules as the backtest.

Safety rules it follows:
- Every entry gets a stop order on Topstep's servers straight away, so a crash or a lost
  connection still leaves the trade protected. A position without a stop is closed.
- At most one trade per day, decided before the order is sent, so a restart can't double up.
- Everything is closed at `flat_time`, before Topstep's 3:10 PM CT deadline.
- Trading stops for the day on the daily loss limit or profit cap, and the position is closed
  if open losses come within `kill_buffer` of the Maximum Loss Limit.
- Practice mode (the default) sends no orders at all; it logs what it would have done.
"""
from __future__ import annotations

import json
import os
import time as _time
from dataclasses import asdict, dataclass, fields, replace
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

from .bars import CT, Bar, round_to_tick
from .config import Config
from .contracts import contract_id, segments, utc_midnight
from .picker import Context, DayStats, context, day_stats, score
from .projectx import BUY, LONG_POSITION, MARKET, SELL, STOP, ProjectXError, ProjectXNetworkError
from .report import money
from .risk import position_size
from .sim import sessions
from .strategy import LONG, SHORT, OpeningRangeBreakout, Signal

COMPLETE_AFTER = timedelta(seconds=2)  # give the server a moment to finish each bar
WATCH_BEFORE = timedelta(minutes=30)  # start watching this long before the opening range
WATCH_AFTER = timedelta(minutes=15)  # and keep watching this long after flat time


@dataclass(frozen=True)
class Position:
    side: int
    size: int
    avg: float

    def open_pnl(self, price: float, point_value: float) -> float:
        return self.side * (price - self.avg) * point_value * self.size


@dataclass
class OpenTrade:
    side: int
    size: int
    entry: float
    stop: float
    target: float
    practice: bool = False


@dataclass
class BotState:
    account_id: int
    mll: float
    best_day: float = 0.0
    trading_days: int = 0
    practice_pnl: float = 0.0
    day: str = ""
    sod_balance: float | None = None
    last_balance: float | None = None
    trade_taken: bool = False
    traded_today: bool = False
    halted: str = ""
    trade: OpenTrade | None = None

    @classmethod
    def load(cls, path: Path, account_id: int, mll: float) -> BotState:
        if path.exists():
            raw = json.loads(path.read_text())
            if raw.get("account_id") == account_id:
                known = {f.name for f in fields(cls)}
                trade = raw.pop("trade", None)
                state = cls(**{k: v for k, v in raw.items() if k in known})
                state.trade = OpenTrade(**trade) if trade else None
                return state
        return cls(account_id=account_id, mll=mll)

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(asdict(self), indent=2))
        os.replace(tmp, path)


def _root_symbol(contract: dict) -> str:
    parts = str(contract.get("id", "")).split(".")
    if len(parts) >= 5 and parts[0] == "CON":
        return parts[3].upper()  # CON.F.US.MES.Z25 -> MES
    name = str(contract.get("name", "")).upper()
    return name[:-2] if len(name) > 2 else name  # MESZ5 -> MES


class LiveBot:
    def __init__(self, client, config: Config, *, live: bool = False, log: Callable[[str], None] = print,
                 clock: Callable[[], datetime] | None = None, sleep: Callable[[float], None] = _time.sleep):
        self.client = client
        self.cfg = config
        self.live = live
        self.log = log
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self.sleep = sleep
        self.inst = config.instrument
        self.p = config.strategy
        self.r = config.risk
        self.rules = config.combine
        self.state_path = Path(config.bot.state_file)
        self.account_id = 0
        self.account_name = ""
        self.contract_id = ""
        self.strategy: OpeningRangeBreakout | None = None
        self.state: BotState | None = None
        self._notes: set[str] = set()
        self._last_bar: datetime | None = None
        self._last_error = ""
        self._context: Context | None = None
        self._context_day = ""

    # ----- setup -----------------------------------------------------------------------

    def connect(self) -> None:
        self.client.login()
        account = self._pick_account()
        self.account_id = int(account["id"])
        self.account_name = str(account.get("name") or account["id"])
        contract = self._pick_contract()
        self.contract_id = str(contract["id"])
        tick = float(contract.get("tickSize") or self.inst.tick_size)
        tick_value = float(contract.get("tickValue") or tick * self.inst.point_value)
        self.inst = replace(self.inst, tick_size=tick, point_value=tick_value / tick)
        self.strategy = OpeningRangeBreakout(self.p, tick)
        start_mll = self.cfg.bot.current_mll or self.rules.start_balance - self.rules.max_loss
        self.state = BotState.load(self.state_path, self.account_id, start_mll)
        if self.cfg.bot.current_mll:
            self.state.mll = max(self.state.mll, self.cfg.bot.current_mll)
        mode = "LIVE: the bot will place orders" if self.live else "PRACTICE: no orders will be sent"
        self.log(f"Account {self.account_name} | {self.contract_id} (tick {tick:g}, ${self.inst.point_value:g} a point) "
                 f"| Maximum Loss Limit {money(self.state.mll)} | {mode}")

    def _pick_account(self) -> dict:
        accounts = [a for a in self.client.accounts() if a.get("canTrade", True)]
        wanted = self.cfg.api.account.strip().lower()
        if wanted:
            accounts = [a for a in accounts if wanted in str(a.get("name", "")).lower() or wanted == str(a.get("id"))]
        if len(accounts) != 1:
            names = ", ".join(str(a.get("name") or a.get("id")) for a in accounts) or "none"
            match = f" matching '{self.cfg.api.account}'" if wanted else ""
            raise ProjectXError(f"expected exactly one tradable account{match}, found: {names}. "
                                "Set [api] account in config.toml to pick one.")
        return accounts[0]

    def _pick_contract(self) -> dict:
        symbol = self.inst.symbol.upper()
        matches = [c for c in self.client.contracts(symbol, live=self.cfg.api.live_data) if _root_symbol(c) == symbol]
        active = [c for c in matches if c.get("activeContract")] or matches
        if not active:
            raise ProjectXError(f"TopstepX returned no contract for {symbol}")
        return active[0]

    # ----- main loop -------------------------------------------------------------------

    def loop(self) -> None:
        try:
            while True:
                try:
                    self.step()
                    self._last_error = ""
                except ProjectXError as exc:
                    message = f"{'Connection problem' if isinstance(exc, ProjectXNetworkError) else 'API error'}: {exc}"
                    if message != self._last_error:
                        self.log(message + " (will keep retrying)")
                        self._last_error = message
                self.sleep(self.cfg.bot.poll_seconds)
        except KeyboardInterrupt:
            self.log("Stopping because you asked.")
            self._shutdown("you stopped the bot")
        except Exception as exc:
            self.log(f"Unexpected error: {exc!r}. Closing any open trade and stopping the bot.")
            self._shutdown("the bot hit an unexpected error")
            raise

    def _shutdown(self, reason: str) -> None:
        try:
            if self.live and self._position():
                self._flatten(reason, halt=True)
        except Exception as exc:  # still save state and exit; the stop order stays on the server
            self.log(f"Couldn't close the position ({exc!r}). Check TopstepX now; the stop order is still there.")
        finally:
            self._save()

    def step(self) -> None:
        now = self.clock()
        local = now.astimezone(CT)
        self._roll_day(local)
        if local.weekday() >= 5 or not self._watching(local):
            return
        st = self.state
        account = self._account()
        balance = float(account["balance"])
        if st.sod_balance is None:
            st.sod_balance = balance
        st.last_balance = balance
        bars = self._today_bars(now, local)
        last = bars[-1].close if bars else None
        position = self._position()
        equity = balance + (position.open_pnl(last, self.inst.point_value) if position and last is not None else 0.0)
        day_pnl = equity - st.sod_balance
        self._status(bars, last, position, day_pnl, balance)

        if position and self.live:
            self._manage_position(position, local, last, equity, day_pnl)
        elif position:
            self._note("manual", "There's an open position on this account. Practice mode won't touch it.")
        else:
            if st.trade and not st.trade.practice:
                self.log(f"Trade closed by its stop (or outside the bot). Balance {money(balance)}, "
                         f"today {money(balance - st.sod_balance)}.")
                st.trade = None
            if self.live:
                self._cancel_orders()  # a leftover order must never open a new position
            if st.trade and st.trade.practice:
                self._manage_practice(local, last)
            else:
                self._maybe_enter(now, local, bars, last, account, balance, equity, day_pnl)
        self._save()

    # ----- entries ---------------------------------------------------------------------

    def _maybe_enter(self, now: datetime, local: datetime, bars: list[Bar], last: float | None,
                     account: dict, balance: float, equity: float, day_pnl: float) -> None:
        st = self.state
        if st.halted or st.trade_taken:
            return
        profit = balance - self.rules.start_balance
        best_day = max(st.best_day, balance - st.sod_balance)
        if (profit >= self.rules.target(best_day)
                and st.trading_days + st.traded_today >= self.rules.min_trading_days):
            st.halted = "profit target reached"
            self.log(f"Profit target reached ({money(profit)}). The bot won't trade. Check TopstepX to confirm you passed.")
            return
        length = timedelta(minutes=self.p.bar_minutes)
        # A bar closing right at last_entry is still a valid signal; it's only visible a moment later.
        if local > datetime.combine(local.date(), self.p.last_entry, tzinfo=CT) + length:
            return
        if not account.get("canTrade", True):
            self._note("cannot-trade", "TopstepX says this account can't trade right now. Waiting.")
            return
        if day_pnl <= -self.r.daily_loss_limit:
            st.halted = "daily loss limit reached"
            self.log("Daily loss limit reached. No more trading today.")
            return
        picker = self.cfg.picker
        ctx = self.picker_context(local) if picker.enabled else None  # loaded before the open
        completed = [b for b in bars if b.start + length + COMPLETE_AFTER <= now]
        signal = self.strategy.signal(completed)
        if signal is None or last is None:
            return
        if now - signal.time > length:
            st.trade_taken = True
            self.log(f"Today's breakout came at {signal.time.astimezone(CT):%H:%M} CT, before the bot was watching. "
                     "Not chasing it: no trade today.")
            return
        picked = ""
        if ctx is not None:
            or_volume = sum(b.volume for b in completed if self.p.range_start <= b.local.time() < self.p.range_end)
            verdict = score(signal, or_volume, ctx, picker)
            if not verdict.ok:
                st.trade_taken = True
                self.log(f"Breakout skipped by the trade picker. {verdict.describe()}.")
                return
            picked = f" Trade picker: {verdict.describe()}."
        risk_points = signal.side * (last - signal.stop)
        if risk_points <= 0:
            st.trade_taken = True
            self.log(f"Price ({last:g}) is already back past the stop level ({signal.stop:g}). No trade today.")
            return
        size = position_size(risk_points, self.inst, self.r, equity - st.mll)
        if size == 0:
            st.trade_taken = True
            if position_size(risk_points, self.inst, self.r) > 0:
                self.log("Too close to the Maximum Loss Limit to trade safely. No trade. Consider resetting the Combine.")
            else:
                self.log(f"The stop would be {risk_points:g} points away, too far for the {money(self.r.risk_per_trade)} "
                         "risk limit. No trade today.")
            return
        st.trade_taken = True
        self._save()  # recorded before any order goes out, so a restart can't trade twice
        word = "BUY" if signal.side == LONG else "SELL"
        if not self.live:
            target = round_to_tick(last + signal.side * self.p.reward_risk * risk_points, self.inst.tick_size)
            st.trade = OpenTrade(signal.side, size, last, signal.stop, target, practice=True)
            self.log(f"[practice] Would {word} {size} {self.inst.symbol} at about {last:g}, "
                     f"stop {signal.stop:g}, target {target:g}.{picked}")
            return
        self._enter(signal, size, word, picked)

    def _enter(self, signal: Signal, size: int, word: str, picked: str = "") -> None:
        st = self.state
        self.log(f"Breakout: {word} {size} {self.inst.symbol} at market, stop {signal.stop:g}.{picked}")
        self.client.place_order(self.account_id, self.contract_id, MARKET, BUY if signal.side == LONG else SELL, size)
        position = None
        for _ in range(10):
            position = self._position()
            if position:
                break
            self.sleep(1)
        if position is None:
            self.log("The entry order didn't fill within 10 seconds. Cancelling it.")
            self._cancel_orders()
            return
        st.traded_today = True
        risk_points = position.side * (position.avg - signal.stop)
        if risk_points <= 0:
            self._flatten("the fill came in beyond the stop level", halt=True)
            return
        target = round_to_tick(position.avg + position.side * self.p.reward_risk * risk_points, self.inst.tick_size)
        st.trade = OpenTrade(position.side, position.size, position.avg, signal.stop, target)
        self._save()
        self.log(f"Filled {position.size} at {position.avg:g}. Stop {signal.stop:g}, target {target:g}.")
        self._ensure_stop(position)

    # ----- open positions --------------------------------------------------------------

    def _manage_position(self, position: Position, local: datetime, last: float | None,
                         equity: float, day_pnl: float) -> None:
        st = self.state
        if local.time() >= self.p.flat_time:
            self._flatten("end-of-day flat time", halt=True)
        elif equity - st.mll <= self.r.kill_buffer:
            self._flatten("too close to the Maximum Loss Limit", halt=True)
        elif day_pnl <= -self.r.daily_loss_limit:
            self._flatten("daily loss limit reached", halt=True)
        elif day_pnl >= self.r.daily_profit_cap:
            self._flatten("daily profit cap reached (consistency rule)", halt=True)
        elif st.trade and last is not None and position.side * (last - st.trade.target) >= 0:
            self._flatten(f"target {st.trade.target:g} reached", halt=False)
        else:
            self._ensure_stop(position)

    def _ensure_stop(self, position: Position) -> None:
        protective_side = SELL if position.side == LONG else BUY
        if any(o.get("type") == STOP and o.get("side") == protective_side for o in self._open_orders()):
            return
        trade = self.state.trade
        if trade is None:
            self._flatten("found a position the bot didn't open, with no stop", halt=True)
            return
        try:
            self.client.place_order(self.account_id, self.contract_id, STOP, protective_side, position.size,
                                    stop_price=trade.stop)
        except ProjectXNetworkError:
            raise  # retried on the next step
        except ProjectXError as exc:
            self._flatten(f"couldn't place the protective stop ({exc})", halt=True)
            return
        self.log(f"Protective stop placed at {trade.stop:g}.")

    def _flatten(self, reason: str, *, halt: bool) -> None:
        st = self.state
        self.log(f"Closing the position: {reason}.")
        if halt:
            st.halted = reason
        self._cancel_orders()  # cancel the stop first so it can't open a new position
        self.client.close_position(self.account_id, self.contract_id)
        for _ in range(5):
            if self._position() is None:
                break
            self.sleep(1)
        else:
            self.log("WARNING: the position still shows as open. Check TopstepX now and close it by hand if needed.")
            return
        st.trade = None
        self._save()
        balance = float(self._account()["balance"])
        self.log(f"Closed. Balance {money(balance)}, today {money(balance - (st.sod_balance or balance))}.")

    def _manage_practice(self, local: datetime, last: float | None) -> None:
        t = self.state.trade
        if last is None:
            return
        if t.side * (last - t.stop) <= 0:
            reason = "stop"
        elif t.side * (last - t.target) >= 0:
            reason = "target"
        elif local.time() >= self.p.flat_time:
            reason = "flat time"
        else:
            return
        pnl = t.size * (t.side * (last - t.entry) * self.inst.point_value - self.inst.commission_rt)
        self.state.practice_pnl += pnl
        self.state.trade = None
        self.log(f"[practice] Would exit at about {last:g} ({reason}): {money(pnl)}. "
                 f"Practice total so far {money(self.state.practice_pnl)}.")

    # ----- trade picker ----------------------------------------------------------------

    def picker_context(self, local: datetime) -> Context:
        """What the trade picker knows before today's open; loaded once a day."""
        key = local.date().isoformat()
        if self._context is None or self._context_day != key:
            history = self._history(local.date())
            self._context = context(history, self.cfg.picker)
            self._context_day = key
            c = self._context
            known = ", ".join(part for part in (
                f"usual opening volume {c.avg_or_volume:,.0f}" if c.avg_or_volume else "",
                f"average day range {c.avg_range:.1f} points" if c.avg_range else "",
                f"{self.cfg.picker.trend_days}-day trend {c.trend:+.1f} points" if c.trend is not None else "",
            ) if part)
            self.log(f"Trade picker loaded {len(history)} past days" + (f": {known}." if known else
                     ". That's not enough history yet, so breakouts will fail its checks."))
        return self._context

    def _history(self, today: date) -> list[DayStats]:
        """Earlier days' summaries, each from the contract that was front month that day,
        exactly as `fetch` builds backtest data."""
        days_back = self.cfg.picker.history_days * 7 // 5 + 12  # trading days plus weekends and holidays
        bars: dict[datetime, Bar] = {}
        for year, month, first, until in segments(today - timedelta(days=days_back), today):
            start, end = utc_midnight(first), utc_midnight(until)
            front = contract_id(self.inst.symbol, year, month)
            try:
                got = self.client.bars(front, start, end, self.p.bar_minutes, live=self.cfg.api.live_data)
            except ProjectXNetworkError:
                raise
            except ProjectXError:  # not a quarterly contract
                got = []
            if not got and front != self.contract_id:
                # No prices for that contract (expired, or not a quarterly symbol): use the one being
                # traded. Its volume before it became the main contract was lower, so the volume
                # check reads high for a few weeks after a roll.
                self._note("history-fallback", f"No price history for {front}; using {self.contract_id} "
                           "for those days instead.")
                got = self.client.bars(self.contract_id, start, end, self.p.bar_minutes, live=self.cfg.api.live_data)
            for bar in got:
                bars[bar.start] = bar
        ordered = [bars[k] for k in sorted(bars)]
        return [day_stats(day, day_bars, self.p) for day, day_bars in sessions(ordered, self.p) if day < today]

    # ----- helpers ---------------------------------------------------------------------

    def _roll_day(self, local: datetime) -> None:
        st = self.state
        key = local.date().isoformat()
        if st.day == key:
            return
        if st.day and st.last_balance is not None:
            st.mll = self.rules.trail(st.mll, st.last_balance)
            if st.sod_balance is not None:
                st.best_day = max(st.best_day, st.last_balance - st.sod_balance)
            if st.traded_today:
                st.trading_days += 1
        if st.trade and st.trade.practice:
            st.trade = None
        st.day, st.sod_balance, st.trade_taken, st.traded_today, st.halted = key, None, False, False, ""
        self._notes.clear()
        self._save()
        if local.weekday() < 5:
            self.log(f"New trading day {key}. Maximum Loss Limit {money(st.mll)}.")

    def _watching(self, local: datetime) -> bool:
        day = local.date()
        begin = datetime.combine(day, self.p.range_start, tzinfo=CT) - WATCH_BEFORE
        end = datetime.combine(day, self.p.flat_time, tzinfo=CT) + WATCH_AFTER
        if begin <= local <= end:
            return True
        self._note("waiting", f"Waiting for the session. The bot watches {begin:%H:%M} to {end:%H:%M} CT on weekdays.")
        return False

    def _today_bars(self, now: datetime, local: datetime) -> list[Bar]:
        begin = datetime.combine(local.date(), self.p.range_start, tzinfo=CT) - WATCH_BEFORE
        return self.client.bars(self.contract_id, begin.astimezone(timezone.utc), now, self.p.bar_minutes,
                                limit=1000, include_partial=True, live=self.cfg.api.live_data)

    def _status(self, bars: list[Bar], last: float | None, position: Position | None,
                day_pnl: float, balance: float) -> None:
        if not bars or bars[-1].start == self._last_bar:
            return
        self._last_bar = bars[-1].start
        held = "flat" if position is None else f"{'long' if position.side == LONG else 'short'} {position.size} at {position.avg:g}"
        self.log(f"Price {last:g} | {held} | today {money(day_pnl)} | balance {money(balance)} "
                 f"| loss limit {money(self.state.mll)}")

    def _account(self) -> dict:
        for account in self.client.accounts():
            if int(account["id"]) == self.account_id:
                return account
        raise ProjectXError("the trading account is no longer listed by TopstepX (closed or failed?)")

    def _position(self) -> Position | None:
        for p in self.client.positions(self.account_id):
            if p.get("contractId") == self.contract_id and int(p.get("size") or 0) > 0:
                side = LONG if int(p.get("type")) == LONG_POSITION else SHORT
                return Position(side, int(p["size"]), float(p["averagePrice"]))
        return None

    def _open_orders(self) -> list[dict]:
        return [o for o in self.client.open_orders(self.account_id) if o.get("contractId") == self.contract_id]

    def _cancel_orders(self) -> None:
        for order in self._open_orders():
            self.client.cancel_order(self.account_id, int(order["id"]))

    def _note(self, key: str, message: str) -> None:
        if key not in self._notes:
            self._notes.add(key)
            self.log(message)

    def _save(self) -> None:
        if self.state is not None:
            self.state.save(self.state_path)
