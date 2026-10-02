"""Contract specs and position sizing."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Instrument:
    symbol: str = "MES"  # Micro E-mini S&P 500
    tick_size: float = 0.25
    point_value: float = 5.0  # dollars per 1.00 move per contract
    commission_rt: float = 1.00  # fees per contract for a full round turn (in and out)
    slippage_ticks: int = 1  # assumed slippage on every market fill in the backtest


@dataclass(frozen=True)
class RiskParams:
    risk_per_trade: float = 200.0  # most a stopped-out trade may lose, fees and slippage included
    max_contracts: int = 20
    daily_loss_limit: float = 400.0  # live backstop: flatten and stop for the day
    daily_profit_cap: float = 1400.0  # live backstop: stay under the consistency rule's 50% of target
    mll_buffer: float = 250.0  # a stopped-out trade must leave at least this much above the loss limit
    kill_buffer: float = 150.0  # live: flatten if open losses bring equity this close to the loss limit
    stop_slippage_ticks: int = 4  # extra slippage budgeted on stops when sizing

    def __post_init__(self) -> None:
        if self.risk_per_trade <= 0 or self.max_contracts <= 0:
            raise ValueError("risk_per_trade and max_contracts must be positive")
        if not 0 <= self.kill_buffer < self.mll_buffer:
            raise ValueError("kill_buffer must be smaller than mll_buffer")


def loss_per_contract(risk_points: float, inst: Instrument, risk: RiskParams) -> float:
    """Dollars one contract loses if the stop is hit, with slippage allowance and fees."""
    return (risk_points + risk.stop_slippage_ticks * inst.tick_size) * inst.point_value + inst.commission_rt


def position_size(risk_points: float, inst: Instrument, risk: RiskParams, room: float | None = None) -> int:
    """Contracts to trade so a stopped-out trade loses at most `risk_per_trade`.

    `room` is equity minus the Maximum Loss Limit; when given, the size is also capped so the
    stop can never take the account closer than `mll_buffer` to the limit.
    """
    if risk_points <= 0:
        return 0
    per_contract = loss_per_contract(risk_points, inst, risk)
    size = min(int(risk.risk_per_trade // per_contract), risk.max_contracts)
    if room is not None:
        size = min(size, int(max(room - risk.mll_buffer, 0.0) // per_contract))
    return max(size, 0)
