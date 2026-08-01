#!/usr/bin/env python3
"""Generate the extended level set into docs/src/game/extra_levels.js.

Levels are composed left to right out of hand-designed chunks. Each chunk knows
its entry and exit surface height, and every chunk is sized against the cube's
actual movement envelope rather than by eye:

    jump velocity 7, gravity 9.81 * 1.4  ->  1.78 units of rise
    run speed 7 (12 boosted)             ->  ~7.1 units of reach from flat

so the caps below (MAX_GAP, MAX_RISE) sit comfortably inside what the cube can
do. Composition alone does not prove a level is finishable, though, so
tools/validate_levels.mjs drives a bot through every one of them and this file
is only worth shipping once that passes.

Usage:  python3 tools/generate_levels.py
"""

import json
import math
import os
import random

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'docs', 'src', 'game', 'extra_levels.js')

COUNT = 50

# Movement envelope, with margin.
MAX_GAP = 4.2      # horizontal gap the cube clears from a standing jump
MAX_RISE = 1.35    # step up it can make while running
THICK = 0.5        # standard platform thickness


def r(v, n=3):
    return round(float(v), n)


class Build:
    """Accumulates one level's geometry as chunks are appended."""

    def __init__(self, rng):
        self.rng = rng
        self.solids = []
        self.coins = []
        self.powerups = []
        self.spikes = []
        self.zones = []
        self.decor = []
        self.x = 0.0        # right edge of what has been built
        self.y = 0.0        # current surface height
        self.min_y = 0.0
        self.path = []      # slabs the route actually walks on

    # -- primitives --------------------------------------------------------

    def slab(self, x0, x1, top, kind='ground', walkable=True, **extra):
        if x1 <= x0:
            return
        s = {'x': r((x0 + x1) / 2), 'y': r(top - THICK / 2),
             'w': r(x1 - x0), 'h': THICK, 'kind': kind}
        s.update(extra)
        self.solids.append(s)
        # Only plain, stationary floor is safe to drop a required point onto.
        if walkable and not any(k in extra for k in ('blink', 'brittle', 'move', 'spring')):
            self.path.append(s)
        self.min_y = min(self.min_y, top)
        return s

    def coin(self, x, y):
        self.coins.append({'x': r(x), 'y': r(y)})

    def orb(self, x, y, kind):
        self.powerups.append({'x': r(x), 'y': r(y), 'type': kind})

    def spike(self, x0, x1, top):
        self.spikes.append({'x': r((x0 + x1) / 2), 'y': r(top + 0.3),
                            'w': r(x1 - x0), 'h': 0.6, 'dir': 'up'})

    def walk_coin(self, x):
        """A point on the current surface, low enough that a hop still takes it."""
        self.coin(x, self.y + 0.7)


# ---------------------------------------------------------------- chunks
#
# Every chunk takes the builder, advances b.x past the geometry it added, and
# leaves b.y at the surface the cube ends up standing on.


def c_flat(b, hard):
    n = b.rng.uniform(4, 7)
    b.slab(b.x, b.x + n, b.y)
    b.x += n


def c_gap(b, hard):
    run = b.rng.uniform(2.5, 3.5)
    gap = b.rng.uniform(2.0, MAX_GAP * (0.65 + 0.35 * hard))
    b.slab(b.x, b.x + run, b.y)
    b.x += run + gap
    b.slab(b.x, b.x + 3.5, b.y)
    b.x += 3.5


def c_step(b, hard):
    b.slab(b.x, b.x + 3, b.y)
    b.x += 3
    up = b.rng.random() < 0.55
    dy = b.rng.uniform(0.7, MAX_RISE) if up else -b.rng.uniform(1.0, 3.0)
    gap = b.rng.uniform(1.4, 2.6)
    b.x += gap
    b.y += dy
    b.slab(b.x, b.x + 4, b.y)
    b.x += 4


def c_spikes(b, hard):
    run = b.rng.uniform(2.5, 3.5)
    b.slab(b.x, b.x + run, b.y)
    b.x += run
    pit = b.rng.uniform(2.2, 3.4)
    # Spikes sit in a trench, so the jump over them is the same jump as a gap.
    # Not path: a point dropped down here would be sitting on the spikes.
    b.slab(b.x, b.x + pit, b.y - 1.6, walkable=False)
    b.spike(b.x + 0.15, b.x + pit - 0.15, b.y - 1.6)
    b.x += pit
    b.slab(b.x, b.x + 4, b.y)
    b.x += 4


def c_spring(b, hard):
    """A pad that throws you up and forward onto a high ledge.

    The landing has to be placed from the arc, not by eye. With launch speed v
    against gravity g = 13.734, the cube passes back down through +rise at

        t = (v + sqrt(v^2 - 2*g*rise)) / g

    and has travelled 7*t by then, which for these numbers is around ten units
    downrange — so the ledge starts well clear of the pad and is long enough to
    catch the whole descent.
    """
    power = 12.0
    g = 13.734
    b.slab(b.x, b.x + 3.0, b.y)
    b.x += 3.0
    launch = b.x + 1.0
    b.slab(b.x, b.x + 2.0, b.y, spring={'power': power})
    b.x += 2.0

    rise = b.rng.uniform(2.4, 3.4)
    fall_t = (power + math.sqrt(max(0.0, power * power - 2 * g * rise))) / g
    reach = 7.0 * fall_t

    # Start the ledge after the cube has already climbed past its height, so it
    # never clips the underside on the way up.
    up_t = (power - math.sqrt(max(0.0, power * power - 2 * g * rise))) / g
    ledge_x0 = launch + 7.0 * up_t + 1.2
    ledge_x1 = launch + reach + 4.5

    b.y += rise
    b.slab(ledge_x0, ledge_x1, b.y)
    b.x = ledge_x1


def c_crumble(b, hard):
    b.slab(b.x, b.x + 2.5, b.y)
    b.x += 2.5
    n = 2 if hard < 0.5 else 3
    for i in range(n):
        b.slab(b.x, b.x + 1.8, b.y,
               brittle={'holds': 0, 'creak': 0.34, 'respawn': 2.2})
        b.x += 1.8 + b.rng.uniform(0.7, 1.5)
    b.slab(b.x, b.x + 4, b.y)
    b.x += 4


def c_blink(b, hard):
    b.slab(b.x, b.x + 2.5, b.y)
    b.x += 2.5
    n = 2 if hard < 0.6 else 3
    period = 2.6 - 0.5 * hard
    for i in range(n):
        # Phases are staggered so a steady walk meets each one solid.
        b.slab(b.x, b.x + 2.2, b.y,
               blink={'period': r(period), 'on': r(period * 0.62), 'phase': r(-i * 0.18)})
        b.x += 2.2 + b.rng.uniform(0.5, 1.1)
    b.slab(b.x, b.x + 4, b.y)
    b.x += 4


def c_belt(b, hard):
    b.slab(b.x, b.x + 2.5, b.y)
    b.x += 2.5
    speed = b.rng.choice([3.5, 4.5, -3.0])
    length = b.rng.uniform(4, 6.5)
    b.slab(b.x, b.x + length, b.y, conveyor={'speed': r(speed)})
    b.x += length
    b.slab(b.x, b.x + 3.5, b.y)
    b.x += 3.5


def c_lift(b, hard):
    """A platform that rises and falls between two ledges it lines up with."""
    entry = b.y
    b.slab(b.x, b.x + 3.5, b.y)
    b.x += 3.5 + 0.4
    rise = b.rng.uniform(2.2, 3.6)
    low = entry
    high = entry + rise
    mid = (low + high) / 2
    b.slab(b.x, b.x + 3.0, mid, walkable=False,
           move={'axis': 'y', 'center': r(mid - THICK / 2), 'amp': r(rise / 2),
                 'period': r(b.rng.uniform(3.0, 4.2))})
    b.x += 3.0 + 0.4
    b.y = high
    b.slab(b.x, b.x + 5.0, b.y)
    b.x += 5.0


def c_shuttle(b, hard):
    """A ferry across a gap.

    Its travel overhangs both ledges by DOCK, so at each end of its swing it is
    flush with solid ground — you can walk straight on and straight off instead
    of having to jump a moving target.
    """
    DOCK = 0.9
    half = 1.7
    b.slab(b.x, b.x + 3.5, b.y)
    b.x += 3.5
    span = b.rng.uniform(6.5, 8.5)
    centre = b.x + span / 2
    amp = max(0.8, span / 2 - half + DOCK)
    b.slab(centre - half, centre + half, b.y, walkable=False,
           move={'axis': 'x', 'center': r(centre), 'amp': r(amp),
                 'period': r(b.rng.uniform(3.0, 4.2))})
    b.x += span
    b.slab(b.x, b.x + 4.5, b.y)
    b.x += 4.5


def c_wall(b, hard):
    b.slab(b.x, b.x + 3, b.y)
    b.x += 3
    rise = b.rng.uniform(3.0, 5.5)
    # A climbable column, then the ledge it delivers you to.
    b.solids.append({'x': r(b.x + 0.4), 'y': r(b.y + rise / 2),
                     'w': 0.8, 'h': r(rise + 1.0), 'kind': 'wall'})
    b.x += 0.8
    b.y += rise
    b.slab(b.x, b.x + 5, b.y)
    b.x += 5


def c_tunnel(b, hard):
    b.slab(b.x, b.x + 3.5, b.y)
    b.orb(b.x + 1.8, b.y + 0.6, 'small')
    b.x += 3.5
    length = b.rng.uniform(5, 8)
    b.slab(b.x, b.x + length, b.y)
    # A ceiling only the shrunken cube fits under.
    b.solids.append({'x': r(b.x + length / 2), 'y': r(b.y + 1.05),
                     'w': r(length), 'h': 0.5, 'kind': 'ground'})
    b.x += length
    b.slab(b.x, b.x + 3, b.y)
    b.orb(b.x + 1.5, b.y + 0.6, 'normal')
    b.x += 3


def c_boost(b, hard):
    run = 7.0
    b.slab(b.x, b.x + run, b.y)
    b.zones.append({'type': 'speed', 'x': r(b.x + run / 2), 'y': r(b.y + 0.8),
                    'w': r(run - 1), 'h': 1.6})
    b.x += run
    gap = b.rng.uniform(5.0, 6.5)
    b.x += gap
    b.slab(b.x, b.x + 4.5, b.y)
    b.x += 4.5


def c_float(b, hard):
    """A barrier too tall to jump, crossed by floating over it.

    The section is roofed. Without a ceiling the antigravity orb just throws
    you out of the level, since nothing ever stops you rising again.
    """
    entry = b.y
    b.slab(b.x, b.x + 4.0, b.y)
    b.orb(b.x + 2.0, b.y + 0.6, 'antigravity')
    b.x += 4.0

    height = b.rng.uniform(4.0, 5.5)
    roof = entry + height + 2.6
    span_start = b.x

    # The barrier, and the roof that catches you on the way up.
    b.solids.append({'x': r(b.x + 0.5), 'y': r(entry + height / 2),
                     'w': 1.0, 'h': r(height), 'kind': 'ground'})
    b.x += 1.0 + b.rng.uniform(3.0, 4.5)

    # The down orb sits just under the roof, so you sweep it up while floating.
    b.orb(b.x - 0.6, r(roof - 0.9), 'gravity')
    b.slab(b.x, b.x + 5.5, entry)
    b.x += 5.5
    b.solids.append({'x': r((span_start + b.x) / 2), 'y': r(roof + 0.25),
                     'w': r(b.x - span_start + 1.0), 'h': 0.5, 'kind': 'ground'})
    b.y = entry


CHUNKS = [
    ('flat', c_flat, 0.00),
    ('gap', c_gap, 0.00),
    ('step', c_step, 0.00),
    ('spikes', c_spikes, 0.06),
    ('spring', c_spring, 0.10),
    ('crumble', c_crumble, 0.18),
    ('belt', c_belt, 0.24),
    ('blink', c_blink, 0.34),
    ('lift', c_lift, 0.30),
    ('shuttle', c_shuttle, 0.40),
    ('wall', c_wall, 0.16),
    ('boost', c_boost, 0.46),
    ('tunnel', c_tunnel, 0.52),
    ('float', c_float, 0.62),
]

CHUNK_BY_NAME = {name: fn for name, fn, _ in CHUNKS}

# The mechanic each level is built around, so the set teaches before it tests.
TEACH = [
    'gap', 'step', 'spikes', 'spring', 'wall', 'crumble', 'belt', 'lift',
    'blink', 'shuttle', 'boost', 'tunnel', 'float',
]

TITLES = [
    'Warm Up', 'Hopscotch', 'Mind the Teeth', 'Bounce', 'Up and Over',
    'Thin Ice', 'Moving Walkway', 'Going Up', 'Now You See It', 'Ferry',
    'Fast Lane', 'Squeeze', 'Weightless', 'Ricochet', 'Staircase',
    'Gauntlet', 'Trapdoor', 'Conveyance', 'Elevator Pitch', 'Flicker',
    'Crossing', 'Momentum', 'Pinhole', 'Updraft', 'Pinball',
    'Ascent', 'Bramble', 'Collapse', 'Drift', 'Skyline',
    'Blink Twice', 'Long Haul', 'Overpass', 'Slipstream', 'Keyhole',
    'Inversion', 'Springboard', 'Switchback', 'Tightrope', 'Freefall',
    'Cascade', 'Treadmill', 'Liftoff', 'Strobe', 'Voyage',
    'Redline', 'Needle', 'Weightlift', 'Crucible', 'Last Light',
]

HINTS = {
    'gap': 'Run and jump. The cube clears a lot more than it looks.',
    'step': 'Short hops beat long ones.',
    'spikes': 'Red means it hurts. Jump the trench.',
    'spring': 'Green pads throw you much higher than a jump.',
    'wall': 'Grey walls can be climbed: jump into one, then jump again.',
    'crumble': 'Cracked tiles give way. Keep moving.',
    'belt': 'Amber belts drag you along. You can walk against them, slowly.',
    'lift': 'Wait for the lift to come to you.',
    'blink': 'Violet platforms phase out. They flash before they go.',
    'shuttle': 'Ride it across, then get off.',
    'boost': 'The orange strip makes you fast for the rest of the level.',
    'tunnel': 'S shrinks you. N gives you your size back.',
    'float': 'The up orb flips your fall; the down orb ends it.',
}


def build_level(index, seed):
    """One level. `index` is 0-based within the extended set."""
    rng = random.Random(seed)
    hard = index / (COUNT - 1)
    b = Build(rng)

    teach = TEACH[index % len(TEACH)] if index < len(TEACH) else None

    # Opening ledge with the spawn on it.
    b.slab(-1.5, 4.0, 0.0)
    spawn = (1.0, 1.1)
    b.x = 4.0

    unlocked = [name for name, _, gate in CHUNKS if hard >= gate]
    if teach:
        # Early levels are that mechanic, bracketed by easy ground.
        plan = ['flat', teach, 'flat', teach] if index < 6 else ['flat', teach, 'gap', teach, 'step']
    else:
        n = 4 + int(hard * 3)
        plan = [rng.choice(unlocked) for _ in range(n)]
        # Guarantee at least one showpiece mechanic per late level.
        showy = [c for c in unlocked if c not in ('flat', 'gap', 'step')]
        if showy and not any(c in showy for c in plan):
            plan[1] = rng.choice(showy)

    for name in plan:
        CHUNK_BY_NAME[name](b, hard)

    # Landing strip and the gate.
    b.slab(b.x, b.x + 5.0, b.y)
    gate_x = b.x + 3.4
    b.x += 5.0

    # Points go on plain, stationary floor the route has to cross, spread along
    # the level. A point you can miss is a point that sends you back for it, and
    # the gate does not open until you have them all.
    wide = [q for q in b.path if q['w'] > 3.0]
    wide.sort(key=lambda q: q['x'])
    if len(wide) >= 3:
        picks = [wide[len(wide) // 6], wide[len(wide) // 2], wide[-2 if len(wide) > 3 else -1]]
    else:
        picks = wide
    seen = set()
    for q in picks:
        if q['x'] in seen:
            continue
        seen.add(q['x'])
        b.coins.append({'x': q['x'], 'y': r(q['y'] + THICK / 2 + 0.7)})

    hint = HINTS.get(teach, '') if teach else ''
    return {
        'name': f'Extra{index + 1}',
        'title': TITLES[index % len(TITLES)],
        'hint': hint,
        'spawn': [r(spawn[0]), r(spawn[1])],
        'killY': r(b.min_y - 9.0),
        'goal': {'x': r(gate_x), 'y': r(b.y + 1.9), 'w': 0.6, 'h': 3.9},
        'solids': b.solids,
        'coins': b.coins,
        'powerups': b.powerups,
        'zones': b.zones,
        'decor': b.decor,
        'spikes': b.spikes,
    }


def main():
    seeds_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'level_seeds.json')
    seeds = {}
    if os.path.exists(seeds_path):
        seeds = json.load(open(seeds_path))

    levels = []
    for i in range(COUNT):
        seed = seeds.get(str(i), 1000 + i * 7919)
        levels.append(build_level(i, seed))

    body = (
        '// Generated by tools/generate_levels.py — do not edit by hand.\n'
        '// Every level here is verified finishable by tools/validate_levels.mjs;\n'
        '// the seeds that passed are pinned in tools/level_seeds.json.\n\n'
        'export const EXTRA_LEVELS = ' + json.dumps(levels, indent=1) + ';\n'
    )
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as f:
        f.write(body)

    span = [round(max(s['x'] for s in lv['solids']), 1) for lv in levels]
    print(f'wrote {os.path.relpath(OUT, ROOT)} — {len(levels)} levels, '
          f'width {min(span):.0f}..{max(span):.0f} units')


if __name__ == '__main__':
    main()
