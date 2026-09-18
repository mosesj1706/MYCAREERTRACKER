"""Altair chart builders for the dashboard. One axis per chart, fixed categorical colors,
single hue for magnitude, tooltips on every mark, recessive grid."""
import altair as alt
import pandas as pd

# Reference categorical palette (light surface), assigned in fixed order - never cycled.
SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"]
MAGNITUDE = "#2a78d6"
TEXT_SECONDARY = "#52514e"
GRID = "#e6e6e3"

ACTIVITY_ORDER = ["JDs analyzed", "Applied", "Mock interviews", "MCQs answered"]


def _base(chart: alt.Chart, height: int) -> alt.Chart:
    return (
        chart.properties(height=height, width="container")
        .configure_view(strokeWidth=0)
        .configure_axis(gridColor=GRID, domain=False, tickColor=GRID, labelColor=TEXT_SECONDARY,
                        titleColor=TEXT_SECONDARY, labelFontSize=12, titleFontSize=12, titleFontWeight="normal")
        .configure_legend(labelColor=TEXT_SECONDARY, titleColor=TEXT_SECONDARY, orient="top", title=None)
    )


def weekly_activity(rows: list[dict]) -> alt.Chart:
    df = pd.DataFrame(rows)
    chart = (
        alt.Chart(df)
        .mark_bar(cornerRadiusEnd=4, size=14)
        .encode(
            x=alt.X("week:N", title=None, axis=alt.Axis(labelAngle=0)),
            xOffset=alt.XOffset("activity:N", sort=ACTIVITY_ORDER),
            y=alt.Y("count:Q", title=None, axis=alt.Axis(tickMinStep=1)),
            color=alt.Color("activity:N", scale=alt.Scale(domain=ACTIVITY_ORDER, range=SERIES[:4]), sort=ACTIVITY_ORDER),
            tooltip=["week", "activity", "count"],
        )
    )
    return _base(chart, 220)


def funnel(rows: list[dict]) -> alt.Chart:
    df = pd.DataFrame(rows)
    order = [r["stage"] for r in rows]
    bars = (
        alt.Chart(df)
        .mark_bar(cornerRadiusEnd=4, color=MAGNITUDE)
        .encode(
            y=alt.Y("stage:N", sort=order, title=None, scale=alt.Scale(paddingInner=0.45)),
            x=alt.X("count:Q", title=None, axis=alt.Axis(tickMinStep=1)),
            tooltip=["stage", "count"],
        )
    )
    labels = bars.mark_text(align="left", dx=6, color=TEXT_SECONDARY).encode(text="count:Q")
    return _base(bars + labels, 200)


def scores(rows: list[dict]) -> alt.Chart:
    df = pd.DataFrame(rows)
    bars = (
        alt.Chart(df)
        .mark_bar(cornerRadiusEnd=4, color=MAGNITUDE)
        .encode(
            y=alt.Y("application:N", sort="-x", title=None, axis=alt.Axis(labelLimit=260), scale=alt.Scale(paddingInner=0.45)),
            x=alt.X("score:Q", title="match score", scale=alt.Scale(domain=[0, 100])),
            tooltip=["application", "status", alt.Tooltip("score:Q", format=".0f")],
        )
    )
    labels = bars.mark_text(align="left", dx=6, color=TEXT_SECONDARY).encode(text=alt.Text("score:Q", format=".0f"))
    return _base(bars + labels, 60 + 40 * len(rows))


def mcq_trend(rows: list[dict]) -> alt.Chart:
    df = pd.DataFrame(rows)
    line = (
        alt.Chart(df)
        .mark_line(strokeWidth=2, color=MAGNITUDE, point=alt.OverlayMarkDef(size=64, color=MAGNITUDE))
        .encode(
            x=alt.X("week:N", title=None, axis=alt.Axis(labelAngle=0)),
            y=alt.Y("accuracy:Q", title="accuracy %", scale=alt.Scale(domain=[0, 100])),
            tooltip=["week", "accuracy", "answered"],
        )
    )
    return _base(line, 200)
