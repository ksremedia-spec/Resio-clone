from __future__ import annotations

from datetime import date, datetime, time, timezone

from combine_bot.bars import CT, Bar
from combine_bot.projectx import BUY, MARKET, STOP

MONDAY = date(2026, 10, 5)


def ct(day: date, hhmm: str, second: int = 0) -> datetime:
    return datetime.combine(day, time.fromisoformat(hhmm), tzinfo=CT).replace(second=second).astimezone(timezone.utc)


def bar(day: date, hhmm: str, o: float, h: float, low: float, c: float) -> Bar:
    return Bar(ct(day, hhmm), o, h, low, c, 100.0)


def opening_day(day: date = MONDAY) -> list[Bar]:
    """Range 4999-5010, then the 08:45 bar closes at 5012: a long breakout known at 08:50."""
    return [
        bar(day, "08:30", 5000, 5008, 4999, 5005),
        bar(day, "08:35", 5005, 5010, 5002, 5006),
        bar(day, "08:40", 5006, 5007, 5000, 5004),
        bar(day, "08:45", 5004, 5013, 5003, 5012),
        bar(day, "08:50", 5012.5, 5013, 5011, 5012.5),
    ]


class FakeTopstep:
    """Stands in for the ProjectX API: fills market orders at the latest price, rests stop orders."""

    CONTRACT = "CON.F.US.MES.Z26"

    def __init__(self, bars: list[Bar], balance: float = 50_000.0):
        self.all_bars = list(bars)
        self.now: datetime | None = None
        self.balance = balance
        self.position: dict | None = None
        self.orders: dict[int, dict] = {}
        self.calls: list[tuple] = []
        self._next_id = 100

    def last_price(self) -> float:
        return [b for b in self.all_bars if b.start < self.now][-1].close

    def login(self) -> None:
        self.calls.append(("login",))

    def accounts(self, only_active: bool = True) -> list[dict]:
        self.calls.append(("accounts",))
        return [{"id": 7, "name": "50KTC-V2-TEST", "balance": self.balance, "canTrade": True}]

    def contracts(self, search_text: str, live: bool = False) -> list[dict]:
        return [
            {"id": "CON.F.US.MESH.Z26", "name": "OTHER", "activeContract": True},
            {"id": self.CONTRACT, "name": "MESZ6", "tickSize": 0.25, "tickValue": 1.25, "activeContract": True},
        ]

    def bars(self, contract_id, start, end, minutes, *, limit=20000, include_partial=False, live=False):
        return [b for b in self.all_bars if start <= b.start < end]

    def place_order(self, account_id, contract_id, order_type, side, size, *, limit_price=None, stop_price=None):
        self.calls.append(("place", order_type, side, size, stop_price))
        order_id = self._next_id
        self._next_id += 1
        if order_type == MARKET:
            self.position = {"contractId": contract_id, "type": 1 if side == BUY else 2, "size": size,
                             "averagePrice": self.last_price()}
        else:
            self.orders[order_id] = {"id": order_id, "contractId": contract_id, "type": order_type,
                                     "side": side, "size": size, "stopPrice": stop_price}
        return order_id

    def cancel_order(self, account_id, order_id) -> None:
        self.calls.append(("cancel", order_id))
        self.orders.pop(order_id, None)

    def open_orders(self, account_id) -> list[dict]:
        return list(self.orders.values())

    def positions(self, account_id) -> list[dict]:
        return [self.position] if self.position else []

    def close_position(self, account_id, contract_id) -> None:
        self.calls.append(("close",))
        self._realise(self.last_price())

    def hit_stop(self) -> None:
        stop = next(o for o in self.orders.values() if o["type"] == STOP)
        del self.orders[stop["id"]]
        self._realise(stop["stopPrice"])

    def _realise(self, price: float) -> None:
        p = self.position
        side = 1 if p["type"] == 1 else -1
        self.balance += side * (price - p["averagePrice"]) * 5.0 * p["size"]
        self.position = None

    def placed(self, order_type: int | None = None) -> list[tuple]:
        return [c for c in self.calls if c[0] == "place" and (order_type is None or c[1] == order_type)]
