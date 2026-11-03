"""Repeating tasks: when is the next occurrence?"""
import calendar
from datetime import date, timedelta

UNITS = {"day", "week", "month", "year"}


def add_months(d: date, months: int) -> date:
    """Calendar-month arithmetic that clamps the day (31 Jan + 1 month = 28/29 Feb)."""
    m = d.month - 1 + months
    y = d.year + m // 12
    m = m % 12 + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def advance(anchor: date, every: int, unit: str, steps: int) -> date:
    n = every * steps
    if unit == "day":
        return anchor + timedelta(days=n)
    if unit == "week":
        return anchor + timedelta(weeks=n)
    if unit == "month":
        return add_months(anchor, n)
    if unit == "year":
        return add_months(anchor, 12 * n)
    raise ValueError(f"unknown unit {unit}")


def next_due(due: date | None, every: int, unit: str, repeat_from: str, completed: date) -> date:
    """
    Next due date after completing a repeating task.
      repeat_from='due'        : keep the original rhythm (every Monday stays Monday) and skip occurrences already in the past
      repeat_from='completion' : count from the day it was actually done (e.g. "3 weeks after each feeding")
    Occurrences are computed from the original anchor, so a 31st never drifts to the 28th for good.
    """
    if repeat_from == "completion" or due is None:
        return advance(completed, every, unit, 1)
    for k in range(1, 5000):
        cand = advance(due, every, unit, k)
        if cand > completed:
            return cand
    return advance(completed, every, unit, 1)
