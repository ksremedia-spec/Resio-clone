"""Settings: defaults in code, overridden by config.toml, credentials also from the environment."""
from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass, field, fields
from datetime import time
from pathlib import Path

from .combine import CombineRules
from .picker import PickerParams
from .risk import Instrument, RiskParams
from .strategy import ORBParams


@dataclass(frozen=True)
class ApiSettings:
    base_url: str = "https://api.topstepx.com"
    username: str = ""
    api_key: str = ""
    account: str = ""  # part of the account name (or its id) to trade; blank = the only tradable one
    live_data: bool = False  # False for Combine and funded accounts on TopstepX


@dataclass(frozen=True)
class BotSettings:
    poll_seconds: float = 5.0
    state_file: str = "state/bot_state.json"
    log_file: str = "logs/bot.log"
    current_mll: float = 0.0  # the Maximum Loss Limit TopstepX shows, if you start mid-Combine


@dataclass(frozen=True)
class Config:
    instrument: Instrument = field(default_factory=Instrument)
    strategy: ORBParams = field(default_factory=ORBParams)
    picker: PickerParams = field(default_factory=PickerParams)
    risk: RiskParams = field(default_factory=RiskParams)
    combine: CombineRules = field(default_factory=CombineRules)
    api: ApiSettings = field(default_factory=ApiSettings)
    bot: BotSettings = field(default_factory=BotSettings)


_SECTIONS = {f.name: f.default_factory for f in fields(Config)}


def _section(name: str, raw: dict) -> object:
    cls = _SECTIONS[name]
    defaults = cls()
    known = {f.name for f in fields(cls)}
    unknown = sorted(set(raw) - known)
    if unknown:
        raise ValueError(f"[{name}] has unknown setting(s): {', '.join(unknown)}")
    values = {}
    for key, value in raw.items():
        if isinstance(getattr(defaults, key), time) and isinstance(value, str):
            value = time.fromisoformat(value)
        values[key] = value
    return cls(**values)


def load_config(path: str | Path | None = "config.toml") -> Config:
    data: dict = {}
    if path and Path(path).exists():
        with open(path, "rb") as fh:
            data = tomllib.load(fh)
    unknown = sorted(set(data) - set(_SECTIONS))
    if unknown:
        raise ValueError(f"unknown section(s) in {path}: {', '.join(unknown)}")
    api = dict(data.get("api", {}))
    api["username"] = os.environ.get("PROJECTX_USERNAME") or api.get("username", "")
    api["api_key"] = os.environ.get("PROJECTX_API_KEY") or api.get("api_key", "")
    data["api"] = api
    return Config(**{name: _section(name, data.get(name, {})) for name in _SECTIONS})
