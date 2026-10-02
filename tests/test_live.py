from datetime import timedelta

import pytest

from combine_bot.config import BotSettings, Config
from combine_bot.live import LiveBot
from combine_bot.picker import PickerParams
from combine_bot.projectx import BUY, MARKET, SELL, STOP
from helpers import MONDAY, FakeTopstep, bar, ct, history, opening_day


@pytest.fixture
def config(tmp_path):
    """Order handling tests run without the trade picker (it has its own tests below)."""
    return Config(picker=PickerParams(enabled=False),
                  bot=BotSettings(state_file=str(tmp_path / "state.json"), log_file=str(tmp_path / "bot.log")))


@pytest.fixture
def picker_config(tmp_path):
    return Config(bot=BotSettings(state_file=str(tmp_path / "state.json"), log_file=str(tmp_path / "bot.log")))


def make_bot(fake, config, live=True):
    lines = []
    bot = LiveBot(fake, config, live=live, log=lines.append, clock=lambda: fake.now, sleep=lambda s: None)
    bot.connect()
    bot.lines = lines
    return bot


def at(fake, hhmm, second=0):
    fake.now = ct(MONDAY, hhmm, second)


def entered(config):
    """A live bot that has just bought the 08:45 breakout: 2 MES at 5012.5, stop 4999, target 5032.75."""
    fake = FakeTopstep(opening_day())
    bot = make_bot(fake, config)
    at(fake, "08:50", 5)
    bot.step()
    return fake, bot


def test_breakout_enters_with_a_server_side_stop(config):
    fake, bot = entered(config)
    assert fake.placed() == [("place", MARKET, BUY, 2, None), ("place", STOP, SELL, 2, 4999)]
    assert bot.state.trade.target == 5032.75
    assert bot.state.trade_taken and bot.state.traded_today


def test_target_cancels_the_stop_before_closing(config):
    fake, bot = entered(config)
    fake.all_bars.append(bar(MONDAY, "08:55", 5013, 5033, 5012, 5033))
    at(fake, "08:55", 10)
    bot.step()
    cancel = next(i for i, c in enumerate(fake.calls) if c[0] == "cancel")
    close = fake.calls.index(("close",))
    assert cancel < close
    assert fake.position is None and not fake.orders
    assert fake.balance == pytest.approx(50_000 + (5033 - 5012.5) * 5 * 2)
    assert bot.state.trade is None and bot.state.halted == ""
    fake.all_bars.append(bar(MONDAY, "09:00", 5033, 5040, 5030, 5038))
    at(fake, "09:00", 10)
    bot.step()
    assert len(fake.placed(MARKET)) == 1  # one trade a day


def test_stop_fill_is_noticed_and_no_new_trade(config):
    fake, bot = entered(config)
    fake.hit_stop()
    fake.all_bars.append(bar(MONDAY, "08:55", 5012, 5012, 4998, 4998))
    at(fake, "08:55", 10)
    bot.step()
    assert bot.state.trade is None
    assert len(fake.placed()) == 2
    assert any("closed by its stop" in line for line in bot.lines)


def test_flat_time_closes_and_halts(config):
    fake, bot = entered(config)
    fake.all_bars.append(bar(MONDAY, "15:00", 5015, 5016, 5014, 5015))
    at(fake, "15:00", 5)
    bot.step()
    assert ("close",) in fake.calls and fake.position is None
    assert bot.state.halted == "end-of-day flat time"


def test_open_losses_near_the_loss_limit_close_the_trade(config):
    fake, bot = entered(config)
    bot.state.mll = 49_900
    fake.all_bars.append(bar(MONDAY, "08:55", 5012, 5012, 5004, 5005))
    at(fake, "08:55", 10)
    bot.step()  # equity 50,000 - 75 is within $150 of 49,900
    assert fake.position is None
    assert bot.state.halted == "too close to the Maximum Loss Limit"


def test_missing_stop_is_replaced(config):
    fake, bot = entered(config)
    fake.orders.clear()
    at(fake, "08:50", 30)
    bot.step()
    assert fake.placed(STOP)[-1] == ("place", STOP, SELL, 2, 4999)
    assert len(fake.orders) == 1


def test_position_the_bot_did_not_open_is_closed(config):
    fake = FakeTopstep(opening_day())
    bot = make_bot(fake, config)
    fake.position = {"contractId": fake.CONTRACT, "type": 1, "size": 1, "averagePrice": 5000.0}
    at(fake, "08:40", 5)
    bot.step()
    assert fake.position is None
    assert "didn't open" in bot.state.halted


def test_restart_does_not_trade_twice(config):
    fake, _ = entered(config)
    again = make_bot(fake, config)
    at(fake, "08:50", 40)
    again.step()
    assert len(fake.placed(MARKET)) == 1
    assert len(fake.placed(STOP)) == 1
    assert again.state.trade.stop == 4999


def test_stale_signal_is_not_chased(config):
    fake = FakeTopstep(opening_day() + [bar(MONDAY, f"09:{m:02d}", 5013, 5014, 5012, 5013) for m in range(0, 25, 5)])
    bot = make_bot(fake, config)
    at(fake, "09:20", 10)
    bot.step()
    assert fake.placed() == []
    assert bot.state.trade_taken
    assert any("Not chasing" in line for line in bot.lines)


def test_breakout_on_the_bar_closing_at_last_entry_is_taken(config):
    quiet = [bar(MONDAY, f"{m // 60:02d}:{m % 60:02d}", 5005, 5008, 5002, 5005) for m in range(8 * 60 + 45, 11 * 60, 5)]
    breakout = bar(MONDAY, "10:55", 5005, 5013, 5004, 5012)  # closes at 11:00, the last entry time
    fake = FakeTopstep(opening_day()[:3] + quiet[:-1] + [breakout, bar(MONDAY, "11:00", 5012, 5013, 5011, 5012.5)])
    bot = make_bot(fake, config)
    at(fake, "11:00", 5)
    bot.step()
    assert fake.placed(MARKET) == [("place", MARKET, BUY, 2, None)]


def test_practice_mode_sends_nothing_and_tracks_paper_results(config):
    fake = FakeTopstep(opening_day())
    bot = make_bot(fake, config, live=False)
    at(fake, "08:50", 5)
    bot.step()
    fake.all_bars.append(bar(MONDAY, "08:55", 5013, 5033, 5012, 5033))
    at(fake, "08:55", 10)
    bot.step()
    assert fake.placed() == [] and ("close",) not in fake.calls
    assert any("[practice] Would BUY 2 MES" in line for line in bot.lines)
    assert bot.state.practice_pnl == pytest.approx(2 * ((5033 - 5012.5) * 5 - 1))


def test_profit_target_stops_trading(config):
    fake = FakeTopstep(opening_day(), balance=53_100)
    bot = make_bot(fake, config)
    bot.state.trading_days = 5
    at(fake, "08:50", 5)
    bot.step()
    assert fake.placed() == []
    assert bot.state.halted == "profit target reached"


def test_new_day_trails_the_loss_limit(config):
    fake = FakeTopstep(opening_day())
    bot = make_bot(fake, config)
    bot.state.day, bot.state.sod_balance, bot.state.last_balance = "2026-10-02", 50_000, 50_600
    at(fake, "08:20")
    bot.step()
    assert bot.state.mll == 48_600
    assert bot.state.best_day == 600


def test_picker_takes_a_breakout_that_passes_its_checks(picker_config):
    # Usual opening volume 300 (today 300: 1.0x), days range ~44 points (today's range 11),
    # and the last weeks trended up, so the long breakout passes all three checks.
    fake = FakeTopstep(history(drift=0.5, volume=100) + opening_day())
    bot = make_bot(fake, picker_config)
    at(fake, "08:50", 5)
    bot.step()
    assert fake.placed(MARKET) == [("place", MARKET, BUY, 2, None)]
    assert any("Trade picker: 3 of 3 checks passed" in line for line in bot.lines)


def test_picker_skips_a_breakout_that_fails_its_checks(picker_config):
    # Opening volume half the usual, and the market has been falling: 1 of 3 checks.
    fake = FakeTopstep(history(drift=-0.5, volume=200) + opening_day())
    bot = make_bot(fake, picker_config)
    at(fake, "08:50", 5)
    bot.step()
    assert fake.placed() == []
    assert bot.state.trade_taken
    skip = next(line for line in bot.lines if "skipped by the trade picker" in line)
    assert "1 of 3 checks passed, 2 needed" in skip and "quieter than usual (0.5x)" in skip
    assert "against the 20-day trend" in skip


def test_picker_without_history_takes_nothing(picker_config):
    fake = FakeTopstep(opening_day())
    bot = make_bot(fake, picker_config)
    at(fake, "08:50", 5)
    bot.step()
    assert fake.placed() == []
    assert any("not enough history yet" in line for line in bot.lines)


def test_picker_falls_back_when_old_contracts_have_no_history(picker_config):
    class ExpiredContractsGone(FakeTopstep):
        def bars(self, contract_id, start, end, minutes, **kwargs):
            return super().bars(contract_id, start, end, minutes) if contract_id == self.CONTRACT else []

    fake = ExpiredContractsGone(history(drift=0.5, volume=100) + opening_day())
    bot = make_bot(fake, picker_config)
    at(fake, "08:50", 5)
    bot.step()
    assert any("No price history for CON.F.US.MES.U26" in line for line in bot.lines)
    assert any("Trade picker loaded 25 past days" in line for line in bot.lines)
    assert fake.placed(MARKET) == [("place", MARKET, BUY, 2, None)]


def test_picker_history_is_loaded_once_a_day(picker_config):
    fake = FakeTopstep(history(drift=0.5, volume=100) + opening_day())
    bot = make_bot(fake, picker_config)
    loads = []
    original = bot._history
    bot._history = lambda today: loads.append(today) or original(today)
    for second in (0, 5, 10):
        at(fake, "08:20", second)
        bot.step()
    assert len(loads) == 1


def _raise(exc):
    def step():
        raise exc
    return step


def test_unexpected_error_closes_the_trade_and_stops(config):
    fake, bot = entered(config)
    bot.step = _raise(RuntimeError("bug"))
    with pytest.raises(RuntimeError):
        bot.loop()
    assert fake.position is None and not fake.orders
    assert any("Unexpected error" in line for line in bot.lines)


def test_ctrl_c_closes_the_trade(config):
    fake, bot = entered(config)
    bot.step = _raise(KeyboardInterrupt())
    bot.loop()
    assert fake.position is None
    assert bot.state.halted == "you stopped the bot"


def test_nothing_happens_outside_session_hours(config):
    fake = FakeTopstep(opening_day())
    bot = make_bot(fake, config)
    before = len(fake.calls)
    at(fake, "06:00")
    bot.step()
    fake.now += timedelta(days=5)  # Saturday
    bot.step()
    assert len(fake.calls) == before
