# Combine Bot

A trading bot and test lab for the **Topstep $50K Trading Combine**. It trades one simple,
written-down rule set on Micro E-mini S&P 500 futures (MES), with hard risk limits, through
Topstep's official API (ProjectX), running on your own computer.

**Read this first**

- No strategy is guaranteed to pass, and this one has no proven edge. The test tools exist so
  you can see how it would have done on real past prices **before** you pay for anything.
- Topstep allows automated trading only from your own computer (no servers or VPS), with you
  supervising it. This bot is built that way.
- Topstep's rules and prices change. Check the current ones in TopstepX and update
  `config.toml` if they differ (see [Settings](#settings)).

## What it does each trading day

1. At 8:30 AM Central (the stock market open), it marks the high and low of the first 15 minutes.
2. If a 5-minute bar closes above that high (or below that low) before 11:00 AM CT, that's a
   breakout.
3. The **trade picker** scores the breakout (see below). If it scores too low, the bot sits the
   day out.
4. Otherwise it buys (or sells short). A stop order goes onto Topstep's servers immediately, at
   the other side of the 15-minute range. The profit target is 1.5 times the risk.
5. Anything still open is closed at 3:00 PM CT (Topstep requires you to be flat by 3:10).
6. At most one trade per day.

## The trade picker (the "secret sauce")

Not every breakout is worth taking. The picker checks three things, each based on published
trading research, and by default a breakout needs to pass 2 of them:

| Check | The question it asks | Where the idea comes from |
|---|---|---|
| Volume | Were the first 15 minutes busier than usual? Real money behind a move helps it follow through. | Zarattini, Barbon & Aziz (2024): opening-range breakouts worked best on unusually active "stocks in play" |
| Range | Is the opening range tight compared with a normal day? A tight range leaves room to run. | Toby Crabel (1990): narrow ranges tend to come before big moves |
| Trend | Is the breakout going the same way as the last 20 days? | Moskowitz, Ooi & Pedersen (2012), "Time Series Momentum" |

**There's no magic here.** These ideas worked in other markets and periods; whether they help
with MES today is exactly what you need to check. So the backtest report has a **TRADE PICKER**
section that tests each check on your price history, separately on older and newer data:

- **helped in both periods**: the trades it kept clearly beat the ones it skipped, in both
  halves of the history. That's a check worth keeping.
- **no clear effect: could be luck**: switch it off.
- **hurt in both periods**: definitely switch it off.

The test is strict on purpose. On made-up random prices it practically never claims a check
helped, but it does find a pattern when one is planted in the data. When a check helps, the
report prints the exact settings to use; switch checks on or off under `[picker]` in
`config.toml`.

**Better trades don't always mean more passes.** Every skipped breakout is a trade that could
have moved you toward the target, so a picker can make each trade better yet still pass the
Combine less often, because it gets there more slowly and pays more monthly fees along the way.
The Combine section shows the pass rate with the picker and for every breakout, and ends with a
BOTTOM LINE. Keep the picker only if it wins there. Resist tuning the numbers until everything
looks good: that just fits the past and falls apart live.

**Safety features**

- Each trade is sized so that being stopped out loses at most **$200**, fees and slippage included.
- It never takes a trade that could bring you within $250 of the Maximum Loss Limit, and it
  closes the trade if open losses come within $150 of it.
- It stops for the day if it's down $400 or up $1,400 (Topstep's consistency rule caps your
  best day at $1,500).
- It stops trading once you reach the $3,000 profit target.
- If your computer or internet dies mid-trade, the stop order is still on Topstep's servers.
  If the bot hits an unexpected error, it closes the trade and shuts itself off.
- **Practice mode is the default**: no orders are sent unless you add `--live`.

## What you need

- A Mac or Windows computer that stays on, awake and online from 8:00 AM to 3:15 PM Central.
- Python 3.11 or newer (free) from https://www.python.org/downloads/. On Windows, tick
  **"Add python.exe to PATH"** in the installer.
- From Step 3 on: a Topstep $50K Trading Combine and the TopstepX API add-on.

## Install (once)

1. Download this folder. On GitHub, switch to the `claude/quant-platform` branch, click
   **Code → Download ZIP**, then unzip it.
2. Open a terminal in the folder:
   - **Mac:** open the Terminal app, type `cd ` (with a space), drag the folder onto the
     window, press Enter.
   - **Windows:** open the folder, click the address bar, type `cmd`, press Enter.
3. **Windows only:** run `py -m pip install tzdata` (time zone data that Windows lacks).

In the commands below, **Mac users type `python3`, Windows users type `py`**.

## Step 1: see the reports on fake prices (free, one minute)

```
python3 -m combine_bot demo
```

The demo deliberately uses random prices with no pattern in them, so the strategy should lose
a little (fees) and almost never pass. That's the simulator being honest: nothing beats pure
randomness. Real prices are what matter, in Step 2.

## Step 2: test on real price history

You need MES price history in 5-minute (or 1-minute) bars, ideally two years or more: a CSV
with a time column and open, high, low, close columns. Getting years of futures data usually
costs money. Once you have a Topstep account with API access, Step 3's `fetch` command
downloads it for you; otherwise, data vendors sell it.

```
python3 -m combine_bot backtest --data data/MES_5m.csv --trades reports/trades.csv
```

If the times in your file have no time zone, say which one they're in, for example
`--tz America/Chicago` or `--tz America/New_York`.

How to read the results:

- **Profit factor**: below 1.0 means the strategy lost money over this period. Don't pay to trade it.
- **TRADE PICKER**: which checks actually helped (see [the trade picker](#the-trade-picker-the-secret-sauce)).
  Switch off any that didn't, then run the backtest again.
- **PASS RATE**: of all the days you could have started the Combine, how often it passed. It's
  shown with the picker and for every breakout, so you can see whether the picker earns its keep.
- **Expected spend to get one pass**: the average fees, failed attempts included, per pass.
- **Pass rate by start year**: if it only worked in one year, that's luck, not a pattern.

Only go live if the profit factor is clearly above 1.0 and the pass rate holds up across years.
You can change the settings and test again, but every tweak that happens to fit the past makes
the results less trustworthy. Keep changes few and simple.

The picker needs about a month of history before it can judge breakouts (it compares today
with the previous 14 to 21 trading days), so the first weeks of any price file are never traded.

## Step 3: connect to TopstepX

1. In TopstepX, subscribe to the API add-on and create an API key. Topstep's help center has
   the current steps.
2. Copy `config.example.toml` to a new file named `config.toml` and fill in `username` and
   `api_key` under `[api]`. Never share this file.
3. Test the connection. This only reads and never trades:
   ```
   python3 -m combine_bot check
   ```
4. Download price history, then run Step 2 on it:
   ```
   python3 -m combine_bot fetch --days 730
   python3 -m combine_bot backtest --data data/MES_5m.csv
   ```
   If TopstepX doesn't keep that much history, try a smaller `--days`.

## Step 4: practice run, no orders (a week or so)

```
python3 -m combine_bot run
```

Start it before 8:30 AM CT and leave the window open. It logs what it would have done
(`[practice] Would BUY 2 MES at about ...`) and keeps a practice profit total. Compare its
decisions with the chart in TopstepX.

## Step 5: trade the Combine

```
python3 -m combine_bot run --live
```

Type `YES` when asked. Watch the first few trades in TopstepX.

### Daily routine

- Before 8:30 AM CT, start the bot with the Step 5 command. Turn off sleep on the computer.
- Check in now and then. Everything is logged on screen and in `logs/bot.log`.
- It closes everything by 3:00 PM CT. Stop it any time with **Ctrl+C**, which also closes any
  open bot trade.
- **Early-close holidays** (such as the day after Thanksgiving and Christmas Eve) close at
  12:00 PM CT. Run with `--flat-time 11:45` on those days.
- Don't trade MES by hand on the same account while the bot runs. It cancels stray MES orders
  and closes positions it didn't open.

### If you fail, reset or start mid-way

- After a failed or reset Combine, delete the `state` folder before the next run. It's where
  the bot remembers your Maximum Loss Limit.
- Starting the bot partway through a Combine? Set `current_mll` under `[bot]` in `config.toml`
  to the Maximum Loss Limit that TopstepX shows.
- After you pass, the funded account has different rules. Update the settings before letting
  the bot trade it.

## Settings

Every setting is listed with an explanation in `config.example.toml`. The main ones:

| Setting | Default | What it does |
|---|---|---|
| `[risk] risk_per_trade` | 200 | Most one stopped-out trade may lose |
| `[strategy] reward_risk` | 1.5 | Profit target as a multiple of the risk |
| `[strategy] stop_mode` | range | Stop at the far side of the opening range, or its middle (`mid`) |
| `[strategy] range_minutes` | 15 | Length of the opening range |
| `[strategy] last_entry` | 11:00 | No new trades after this (Central time) |
| `[instrument] commission_rt` | 1.00 | Your fees per contract, in and out; check TopstepX |
| `[combine] monthly_fee` | 95 | For the simulator's cost figures; set it to what you pay |

### Topstep rules it's set up for

Check these against TopstepX:

- $50K Combine: +$3,000 profit target and a $2,000 Maximum Loss Limit. The limit trails your
  end-of-day balance high, locks at $50,000, and is enforced in real time, open losses included.
- Consistency: your best day must be no more than 50% of the profit target, or the target rises.
- Flat by 3:10 PM CT every day.
- Automation must run on your own device.

## Honest limits

- The backtest assumes realistic but imperfect fills. Market orders fill one tick worse than
  the bar price, stops fill at the stop (or worse after a gap), and when a bar touches both the
  stop and the target, it assumes the stop. Real fills in fast markets can be worse.
- Past results don't predict future ones.
- Attempts started on nearby days overlap, so the simulated pass rate is based on fewer
  separate tries than the count suggests.

## For developers

```
pip install pytest
python3 -m pytest
```

| File | What it does |
|---|---|
| `combine_bot/strategy.py` | The opening-range breakout rules, shared by the backtest and the live bot |
| `combine_bot/picker.py` | The trade picker's three checks and its scoring |
| `combine_bot/lab.py` | Tests whether each check helped (kept vs skipped trades, older vs newer data) |
| `combine_bot/sim.py` | Backtest fill model and statistics |
| `combine_bot/combine.py` | Combine rules and the start-on-every-day simulator |
| `combine_bot/risk.py` | Contract specs and position sizing |
| `combine_bot/live.py` | The live bot loop and its safety checks |
| `combine_bot/projectx.py` | ProjectX Gateway API client (standard library only) |
| `combine_bot/bars.py`, `contracts.py` | Price data loading, front-month contract roll |
| `combine_bot/cli.py` | The `demo`, `backtest`, `check`, `fetch` and `run` commands |
