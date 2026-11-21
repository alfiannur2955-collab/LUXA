"""Pytest configuration supporting deterministic random test ordering (`--shuffle-seed`)."""

from __future__ import annotations

import random


def pytest_addoption(parser):
    parser.addoption(
        "--shuffle-seed",
        action="store",
        default=None,
        type=int,
        help="Acak urutan seluruh item tes dengan seed tertentu untuk menguji isolasi state/cache (K1).",
    )


def pytest_collection_modifyitems(config, items):
    seed = config.getoption("--shuffle-seed")
    if seed is not None:
        rng = random.Random(seed)
        rng.shuffle(items)
