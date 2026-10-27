"""Streamlit boilerplate for the NCSEA hackathon workspace.

The page is a wide layout. The sidebar collects the inputs that drive a
demo series, and the main area renders that series as metrics, a line
chart, and a table. Computed frames live in ``st.session_state`` so a
widget change, a tab switch, or any other rerun keeps the last result.

The domain functions (``Inputs``, ``Result``, ``process``) do not call
Streamlit. The script below them is the page: it builds the form, caches
``process`` by input value, and draws the workspace.
"""

from __future__ import annotations

import hashlib
import os
from dataclasses import asdict, dataclass
from datetime import date, timedelta

import numpy as np
import pandas as pd
import streamlit as st
from dotenv import load_dotenv

# --- environment ----------------------------------------------------------
# Load .env once at import time. Secrets never leave the server process and
# the file itself is git-ignored. .env.example documents what is expected.
load_dotenv()

APP_NAME = os.getenv("APP_NAME", "Streamlit Starter")
DATA_SOURCE = os.getenv("DATA_SOURCE", "demo")


# --- domain ---------------------------------------------------------------
@dataclass(frozen=True)
class Inputs:
    """Values that change the demo series. Frozen so equal forms share a cache key.

    Attributes:
        start: First day of the generated series.
        days: Number of daily points, including the start day.
        baseline: Level of the series on day zero, before growth.
        growth: Percent change applied once per day, compounded.
        noise: Percent standard deviation of the multiplicative noise.
        currency: Label drawn next to the metrics. It does not convert values.
    """

    start: date
    days: int
    baseline: float
    growth: float
    noise: float
    currency: str


@dataclass
class Result:
    """One cached run of ``process``.

    Attributes:
        frame: Daily ``date``, ``value``, and ``rolling_7d`` columns.
        key: Short hash of the ``Inputs`` that produced ``frame``.
    """

    frame: pd.DataFrame
    key: str


def _cache_key(inputs: Inputs) -> str:
    """Return a stable 16-character id for this input set.

    The hash covers every field, so two forms that differ only in currency
    or noise do not reuse each other's frame. The same form on a later
    rerun produces the same id and the same random series.
    """
    payload = repr(sorted(asdict(inputs).items()))
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


def process(inputs: Inputs) -> Result:
    """Build the demo series for ``inputs``.

    Replace this with the real workload. Keep the function free of
    Streamlit calls so tests and reruns can call it directly.

    The series is ``baseline`` compounded by ``growth`` percent each day,
    then scaled by normal noise whose standard deviation is ``noise``
    percent. The random draw is seeded from ``_cache_key``, so identical
    inputs always return the same frame. A 7-day rolling mean is added
    as ``rolling_7d``.

    Args:
        inputs: Sidebar values that define the horizon and the series shape.

    Returns:
        The frame and the cache key derived from ``inputs``.
    """
    key = _cache_key(inputs)
    rng = np.random.default_rng(seed=int(key[:8], 16))
    dates = pd.date_range(inputs.start, periods=inputs.days, freq="D")
    trend = inputs.baseline * (1 + inputs.growth / 100) ** np.arange(inputs.days)
    values = trend * (1 + rng.normal(0, inputs.noise / 100, inputs.days))
    frame = pd.DataFrame(
        {
            "date": dates,
            "value": values.round(2),
        }
    )
    frame["rolling_7d"] = frame["value"].rolling(7, min_periods=1).mean().round(2)
    return Result(frame=frame, key=key)


# --- page -----------------------------------------------------------------
st.set_page_config(
    page_title=APP_NAME,
    page_icon="📈",
    layout="wide",
    initial_sidebar_state="expanded",
)

# --- session-state cache --------------------------------------------------
# A single keyed cache: identical inputs reuse the previous result instead of
# recomputing, and the result survives every rerun triggered by the UI.
st.session_state.setdefault("cache", {})

# --- sidebar inputs -------------------------------------------------------
with st.sidebar:
    st.title(APP_NAME)
    st.caption(f"Data source: `{DATA_SOURCE}`")
    st.divider()

    with st.form("inputs"):
        start = st.date_input("Start date", value=date.today() - timedelta(days=89))
        days = st.slider("Horizon (days)", min_value=14, max_value=365, value=90, step=7)
        baseline = st.number_input("Baseline", min_value=0.0, value=1_000.0, step=50.0)
        growth = st.slider("Daily growth (%)", -5.0, 5.0, 0.4, step=0.1)
        noise = st.slider("Volatility (%)", 0.0, 50.0, 8.0, step=1.0)
        currency = st.selectbox("Currency", ["USD", "EUR", "GBP"], index=0)
        submitted = st.form_submit_button("Run", type="primary", width="stretch")

    st.divider()
    if st.button("Clear cache", width="stretch"):
        st.session_state.cache.clear()
        st.toast("Cache cleared")
    st.caption("Inputs are cached by value; reruns are free.")

inputs = Inputs(
    start=start,
    days=days,
    baseline=baseline,
    growth=growth,
    noise=noise,
    currency=currency,
)

CACHE_LIMIT = 20
cache: dict[str, Result] = st.session_state.cache
key = _cache_key(inputs)

if submitted or key not in cache:
    with st.spinner("Processing…"):
        cache[key] = process(inputs)
        while len(cache) > CACHE_LIMIT:
            cache.pop(next(iter(cache)))

result = cache[key]
frame = result.frame

# --- workspace ------------------------------------------------------------
header, meta = st.columns([3, 1], vertical_alignment="bottom")
with header:
    st.title("Workspace")
    st.caption("Sidebar drives the inputs; this grid renders the cached result.")
with meta:
    st.metric("Cache entries", len(cache))
    st.caption(f"Key `{result.key}`")

total = frame["value"].sum()
latest = frame["value"].iloc[-1]
first = frame["value"].iloc[0]
change = (latest - first) / first * 100 if first else 0.0

m1, m2, m3, m4 = st.columns(4)
m1.metric("Total", f"{total:,.0f} {currency}")
m2.metric("Latest", f"{latest:,.2f} {currency}")
m3.metric("Change", f"{change:+.1f}%")
m4.metric("Peak", f"{frame['value'].max():,.0f} {currency}")

left, right = st.columns([2, 1], gap="large")

with left:
    st.subheader("Trend")
    st.line_chart(
        frame.set_index("date")[["value", "rolling_7d"]],
        color=["#4C8DFF", "#F2A93B"],
    )

with right:
    st.subheader("Detail")
    display = (
        frame.assign(date=frame["date"].dt.date)
        .sort_values("date", ascending=False)
        .loc[:, ["date", "value"]]
    )
    st.dataframe(
        display,
        width="stretch",
        hide_index=True,
        height=340,
        column_config={
            "date": st.column_config.DateColumn("Date", format="YYYY-MM-DD"),
            "value": st.column_config.NumberColumn("Value", format="%.2f"),
        },
    )
    st.download_button(
        "Download CSV",
        frame.to_csv(index=False).encode("utf-8"),
        file_name=f"result_{result.key}.csv",
        mime="text/csv",
        width="stretch",
    )

st.divider()
st.caption(f"{APP_NAME} · built with Streamlit")
