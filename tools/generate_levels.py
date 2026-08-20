#!/usr/bin/env python3
"""Generate the extended level set into docs/src/game/extra_levels.js.

Design rules
============

The first version of this generator strung random chunks together left to
right. It produced levels that worked but read as corridors: 84% of their
platforms were plain flat ground, the median level varied by under 5 units of
height, 9 of 15 descents were drops too deep to see the landing from, and 31 of
50 levels contained no hazard at all.

This version composes to a brief instead, from the level-design ideas that
platformers have converged on:

1.  Introduce, develop, twist, conclude.  Nintendo's four-step structure. A
    level has one theme mechanic and works through it: meet it, use it again
    with more asked of you, see it combined with something else, then a final
    demanding statement of it. TEMPLATES below are literally that shape.

2.  Teach where failure is cheap.  The first two encounters with a mechanic sit
    over a safety net one jump below (NET_DROP), so missing costs a moment and a
    hop back up rather than a life. Only after the level has taught it does the
    same mechanic appear over a real pit.

3.  Tension and release.  Beats carry an intensity, and a rest beat follows the
    peaks. Levels do not run at one pitch from start to finish, and every level
    ends with a calm run to the gate so it closes on release, not on panic.

4.  No leaps of faith.  Descents are capped at MAX_BLIND so the landing is on
    screen when you commit to it. Anything further down is built as a staircase
    of visible ledges.

5.  Points are signposts.  They mark the route at the moments that matter — the
    reward after the first hard beat, the top of the climax, the calm before the
    gate — rather than being scattered on whatever slab was widest.

6.  Silhouette.  Each level takes an elevation profile (climb, descend, valley,
    mesa, rolling) so the set does not read as fifty variations on one flat line.

7.  Sawtooth difficulty.  Difficulty ramps inside each chapter and drops at the
    start of the next, so a new chapter's new ideas arrive with the other
    demands relaxed.

Sizing is still taken from the cube's real movement envelope:

    jump velocity 7, gravity 9.81 * 1.4  ->  1.78 units of rise
    run speed 7 (12 boosted)             ->  ~7.1 units of reach from flat

and composition still does not prove a level can be finished, so
tools/validate_levels.mjs drives a bot through every one of them.

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
MAX_BLIND = 2.2    # deepest drop that still shows its landing before you commit
NET_DROP = 1.4     # safety net sits one comfortable hop below the floor it saves
THICK = 0.5


def r(v, n=3):
    return round(float(v), n)


class Build:
    """Accumulates one level's geometry as beats are appended."""

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
        self.path = []      # plain stationary floor the route walks on
        self.marks = []     # (x, y, importance) candidates for signpost points

    # -- primitives --------------------------------------------------------

    def slab(self, x0, x1, top, kind='ground', walkable=True, **extra):
        if x1 <= x0:
            return None
        s = {'x': r((x0 + x1) / 2), 'y': r(top - THICK / 2),
             'w': r(x1 - x0), 'h': THICK, 'kind': kind}
        s.update(extra)
        self.solids.append(s)
        if walkable and not any(k in extra for k in ('blink', 'brittle', 'move', 'spring')):
            self.path.append(s)
        self.min_y = min(self.min_y, top)
        return s

    def protect(self, slab):
        """Mark a ledge an arc or a dismount depends on: never punctuate it."""
        if slab:
            slab['protected'] = True
        return slab

    def net(self, x0, x1, top):
        """Recovery floor under a feature whose far side is at the same height.

        NET_DROP is inside a jump, so landing on a net costs a moment and a hop
        back onto either ledge, never a life.

        Only for level-to-level features. For anything that lifts you — springs,
        lifts, boosted jumps — a net sits under a much higher exit, and the only
        way to make it escapable is a climbable column, which leaves a gap
        narrower than the cube between the column and the feature. It wedges
        there and can never get out. Those features are made forgiving by
        gentler geometry instead.
        """
        self.slab(x0 - 0.5, x1 + 0.5, top - NET_DROP, walkable=False)

    def orb(self, x, y, kind):
        self.powerups.append({'x': r(x), 'y': r(y), 'type': kind})

    def spike(self, x0, x1, top):
        self.spikes.append({'x': r((x0 + x1) / 2), 'y': r(top + 0.3),
                            'w': r(x1 - x0), 'h': 0.6, 'dir': 'up'})

    def mark(self, x, importance=1):
        """Offer this spot as a place a signpost point would mean something."""
        self.marks.append((x, self.y, importance))


# ---------------------------------------------------------------- chunks
#
# Every chunk takes the builder and a context dict, advances b.x past what it
# added, and leaves b.y on the surface the cube ends up standing on.
#
#   ctx['hard']  0..1 difficulty within the whole set
#   ctx['safe']  build the recoverable variant (a net under the feature)
#   ctx['peak']  this is the level's climax — push the parameters


def c_flat(b, ctx):
    n = b.rng.uniform(3.5, 6.0)
    b.slab(b.x, b.x + n, b.y)
    b.x += n


def c_gap(b, ctx):
    run = b.rng.uniform(2.5, 3.5)
    scale = 0.6 + 0.4 * ctx['hard'] + (0.1 if ctx['peak'] else 0)
    gap = min(MAX_GAP, b.rng.uniform(2.0, MAX_GAP * scale))
    b.slab(b.x, b.x + run, b.y)
    if ctx['safe']:
        b.net(b.x + run, b.x + run + gap, b.y)
    b.x += run + gap
    b.slab(b.x, b.x + 3.5, b.y)
    b.mark(b.x + 1.8)
    b.x += 3.5


def c_step(b, ctx):
    """A visible change of level. Never drops further than you can see."""
    b.slab(b.x, b.x + 3, b.y)
    b.x += 3
    up = b.rng.random() < ctx.get('rise_bias', 0.5)
    dy = b.rng.uniform(0.7, MAX_RISE) if up else -b.rng.uniform(1.0, MAX_BLIND)
    b.x += b.rng.uniform(1.4, 2.4)
    b.y += dy
    b.slab(b.x, b.x + 4, b.y)
    b.x += 4


def c_stairs(b, ctx):
    """A run of visible ledges, for elevation the cube could not take in one go."""
    steps = b.rng.randint(3, 5)
    up = ctx.get('rise_bias', 0.5) > 0.5
    for _ in range(steps):
        b.slab(b.x, b.x + 2.6, b.y)
        b.x += 2.6 + b.rng.uniform(1.0, 1.8)
        b.y += b.rng.uniform(1.0, MAX_RISE) if up else -b.rng.uniform(1.3, MAX_BLIND)
    b.slab(b.x, b.x + 3.5, b.y)
    b.mark(b.x + 1.6)
    b.x += 3.5


def c_spikes(b, ctx):
    run = b.rng.uniform(2.5, 3.5)
    b.slab(b.x, b.x + run, b.y)
    b.x += run
    pit = b.rng.uniform(2.2, 2.8 + 0.6 * ctx['hard'])
    # In a trench, so clearing them is the same jump as clearing a gap, and the
    # teeth are plainly visible from the run-up.
    b.slab(b.x, b.x + pit, b.y - 1.6, walkable=False)
    b.spike(b.x + 0.15, b.x + pit - 0.15, b.y - 1.6)
    b.x += pit
    b.slab(b.x, b.x + 4, b.y)
    b.mark(b.x + 2)
    b.x += 4


def c_spring(b, ctx):
    """A pad that throws you up and forward onto a high ledge.

    The landing is placed from the arc, not by eye. With launch speed v against
    gravity g, the cube passes back down through +rise at
    t = (v + sqrt(v^2 - 2*g*rise)) / g, about ten units downrange here.
    """
    power = 12.0
    g = 13.734
    b.slab(b.x, b.x + 3.0, b.y)
    b.x += 3.0
    launch = b.x + 1.0
    b.slab(b.x, b.x + 2.0, b.y, spring={'power': power})
    b.x += 2.0

    rise = b.rng.uniform(2.0, 2.4) if ctx['safe'] \
        else b.rng.uniform(2.4, 3.0 + 0.6 * ctx['hard'])
    root = math.sqrt(max(0.0, power * power - 2 * g * rise))
    reach = 7.0 * (power + root) / g
    up_t = (power - root) / g
    ledge_x0 = launch + 7.0 * up_t + 1.2
    ledge_x1 = launch + reach + (5.5 if ctx['safe'] else 4.0)

    b.y += rise
    b.protect(b.slab(ledge_x0, ledge_x1, b.y))   # the spring arc lands here
    b.mark(launch + reach, 2)
    b.x = ledge_x1


def c_crumble(b, ctx):
    b.slab(b.x, b.x + 2.5, b.y)
    b.x += 2.5
    n = 3 if ctx['hard'] < 0.45 else 4
    start = b.x
    for _ in range(n):
        b.slab(b.x, b.x + 1.8, b.y,
               brittle={'holds': 0, 'creak': 0.34, 'respawn': 2.2})
        b.x += 1.8 + b.rng.uniform(0.7, 1.3)
    if ctx['safe']:
        b.net(start, b.x, b.y)
    b.slab(b.x, b.x + 4, b.y)
    b.mark(b.x + 2)
    b.x += 4


def c_blink(b, ctx):
    b.slab(b.x, b.x + 2.5, b.y)
    b.x += 2.5
    n = 3 if ctx['hard'] < 0.55 else 4
    period = 2.8 - 0.6 * ctx['hard']
    start = b.x
    for i in range(n):
        # Staggered phases, so a steady walk meets each one solid.
        b.slab(b.x, b.x + 2.2, b.y,
               blink={'period': r(period), 'on': r(period * 0.62), 'phase': r(-i * 0.18)})
        b.x += 2.2 + b.rng.uniform(0.5, 1.0)
    if ctx['safe']:
        b.net(start, b.x, b.y)
    b.slab(b.x, b.x + 4, b.y)
    b.mark(b.x + 2)
    b.x += 4


def c_belt(b, ctx):
    b.slab(b.x, b.x + 2.5, b.y)
    b.x += 2.5
    speed = b.rng.choice([3.5, 4.5, -3.0] if ctx['hard'] > 0.3 else [3.5, 4.0])
    length = b.rng.uniform(4, 6.5)
    b.slab(b.x, b.x + length, b.y, conveyor={'speed': r(speed)})
    b.x += length
    b.slab(b.x, b.x + 3.5, b.y)
    b.mark(b.x + 1.8)
    b.x += 3.5


def c_lift(b, ctx):
    """A platform rising and falling between two ledges.

    Like the ferry, it docks: its travel overshoots both ledges by DOCK, so at
    each end of its swing it is level with solid ground. Stopping exactly at
    each ledge looks tidier and plays far worse — you end up needing a
    frame-accurate step-off at the very limit of the cube's jump.
    """
    DOCK = 0.45
    entry = b.y
    b.slab(b.x, b.x + 3.5, b.y)
    b.x += 3.5 + 0.4
    rise = b.rng.uniform(1.8, 2.4) if ctx['safe'] else b.rng.uniform(2.2, 3.2)
    low = entry - DOCK
    high = entry + rise + DOCK
    mid = (low + high) / 2
    width = 4.2 if ctx['safe'] else 3.4
    b.slab(b.x, b.x + width, mid, walkable=False,
           move={'axis': 'y', 'center': r(mid - THICK / 2), 'amp': r((high - low) / 2),
                 'period': r(b.rng.uniform(3.6, 4.4) if ctx['safe']
                             else b.rng.uniform(3.0, 4.2))})
    b.x += width + 0.4
    b.y = entry + rise
    b.protect(b.slab(b.x, b.x + 5.0, b.y))       # step off the lift onto this
    b.mark(b.x + 2.4, 2)
    b.x += 5.0


def c_shuttle(b, ctx):
    """A ferry whose travel overhangs both ledges, so it docks at each end."""
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
    if ctx['safe']:
        b.net(b.x, b.x + span, b.y)
    b.x += span
    b.protect(b.slab(b.x, b.x + 4.5, b.y))       # step off the ferry onto this
    b.mark(b.x + 2.2)
    b.x += 4.5


def c_wall(b, ctx):
    b.slab(b.x, b.x + 3.5, b.y)
    b.x += 3.5
    rise = b.rng.uniform(3.0, 4.0 + 1.5 * ctx['hard'])
    b.solids.append({'x': r(b.x + 0.4), 'y': r(b.y + rise / 2),
                     'w': 0.8, 'h': r(rise + 1.0), 'kind': 'wall'})
    b.x += 0.8
    b.y += rise
    b.protect(b.slab(b.x, b.x + 5, b.y))         # top of the climb
    b.mark(b.x + 2.2, 2)
    b.x += 5


def c_tunnel(b, ctx):
    b.slab(b.x, b.x + 3.5, b.y)
    b.orb(b.x + 1.8, b.y + 0.6, 'small')
    b.x += 3.5
    length = b.rng.uniform(5, 7.5)
    b.slab(b.x, b.x + length, b.y)
    b.solids.append({'x': r(b.x + length / 2), 'y': r(b.y + 1.05),
                     'w': r(length), 'h': 0.5, 'kind': 'ground', 'roof': True})
    b.mark(b.x + length / 2)
    b.x += length
    b.slab(b.x, b.x + 3.5, b.y)
    b.orb(b.x + 1.7, b.y + 0.6, 'normal')
    b.x += 3.5


def c_boost(b, ctx):
    run = 7.0
    b.slab(b.x, b.x + run, b.y)
    b.zones.append({'type': 'speed', 'x': r(b.x + run / 2), 'y': r(b.y + 0.8),
                    'w': r(run - 1), 'h': 1.6})
    b.x += run
    gap = b.rng.uniform(5.0, 6.5)
    if ctx['safe']:
        b.net(b.x, b.x + gap, b.y)
    b.x += gap
    b.protect(b.slab(b.x, b.x + 4.5, b.y))       # the boosted jump lands here
    b.mark(b.x + 2.2, 2)
    b.x += 4.5


def c_float(b, ctx):
    """A barrier too tall to jump, crossed by floating over it.

    Roofed: without a ceiling the antigravity orb throws you out of the level,
    because nothing ever stops you rising again.
    """
    entry = b.y
    b.slab(b.x, b.x + 4.0, b.y)
    b.orb(b.x + 2.0, b.y + 0.6, 'antigravity')
    b.x += 4.0

    height = b.rng.uniform(4.0, 5.5)
    roof = entry + height + 2.6
    span_start = b.x
    b.solids.append({'x': r(b.x + 0.5), 'y': r(entry + height / 2),
                     'w': 1.0, 'h': r(height), 'kind': 'ground', 'roof': True})
    b.x += 1.0 + b.rng.uniform(3.0, 4.5)
    ledge_x0 = b.x

    # You collect the down orb pinned to the ceiling, still travelling at run
    # speed, so the fall from there is a long arc — the same trap the spring had.
    # Size the ledge from it rather than by eye.
    orb_x = ledge_x0 + 4.0
    drop = (roof - 0.9) - entry
    fall_reach = 7.0 * math.sqrt(max(0.0, 2.0 * drop / 13.734))
    ledge_x1 = orb_x + fall_reach + 4.0

    b.protect(b.slab(ledge_x0, ledge_x1, entry))     # where the drift sets you down
    # The down orb goes at the far end of the roof, not the near end. Drifting
    # up pins you to the ceiling and you slide along it, so an orb by the
    # entrance is easy to sail straight past — and then there is no way down and
    # nothing but the end of the roof ahead. At the exit it cannot be missed.
    b.orb(orb_x, r(roof - 0.9), 'gravity')
    # The point goes where the arc actually lands, not where the ledge starts.
    b.mark(orb_x + fall_reach, 2)
    b.x = ledge_x1
    b.solids.append({'x': r((span_start + b.x) / 2), 'y': r(roof + 0.25),
                     'w': r(b.x - span_start + 1.0), 'h': 0.5, 'kind': 'ground',
                     'roof': True})
    b.y = entry


CHUNKS = {
    'flat': c_flat, 'gap': c_gap, 'step': c_step, 'stairs': c_stairs,
    'spikes': c_spikes, 'spring': c_spring, 'crumble': c_crumble,
    'blink': c_blink, 'belt': c_belt, 'lift': c_lift, 'shuttle': c_shuttle,
    'wall': c_wall, 'tunnel': c_tunnel, 'boost': c_boost, 'float': c_float,
}

# Order the set teaches its mechanics in. One per level, easiest ideas first.
TEACH_ORDER = ['gap', 'step', 'spikes', 'spring', 'wall', 'crumble', 'belt',
               'lift', 'blink', 'shuttle', 'boost', 'tunnel', 'float']

# Mechanics that pair well as the secondary idea in a combination level.
SPICE = ['gap', 'step', 'spikes', 'spring', 'crumble', 'belt', 'stairs']

# Elevation profiles, as a rise bias per beat. Gives each level a silhouette.
PROFILES = {
    'climb':   [0.5, 0.9, 0.9, 0.6, 0.9, 0.5],
    'descend': [0.5, 0.1, 0.2, 0.4, 0.1, 0.5],
    'valley':  [0.5, 0.1, 0.2, 0.8, 0.9, 0.5],
    'mesa':    [0.5, 0.9, 0.5, 0.5, 0.1, 0.5],
    'rolling': [0.5, 0.8, 0.2, 0.7, 0.3, 0.5],
}

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
    'gap': 'Run and jump. The cube clears more than it looks.',
    'step': 'Short hops beat long ones.',
    'spikes': 'Red means it hurts. Jump the trench.',
    'spring': 'Green pads throw you much further than a jump.',
    'wall': 'Grey walls can be climbed: jump into one, then jump again.',
    'crumble': 'Cracked tiles give way. Keep moving.',
    'belt': 'Amber belts drag you along. You can walk against one, slowly.',
    'lift': 'Wait for the lift to come to you.',
    'blink': 'Violet platforms phase out. They flash before they go.',
    'shuttle': 'Ride it across, then step off.',
    'boost': 'The orange strip makes you fast for the rest of the level.',
    'tunnel': 'S shrinks you. N gives you your size back.',
    'float': 'The up orb flips your fall; the down orb ends it.',
}


def difficulty(index):
    """Sawtooth: ramps inside a chapter, eases at the start of the next."""
    chapters = [(0, 13, 0.05, 0.35), (13, 30, 0.25, 0.65), (30, COUNT, 0.5, 1.0)]
    for lo, hi, base, top in chapters:
        if lo <= index < hi:
            t = (index - lo) / max(1, hi - lo - 1)
            return base + (top - base) * t
    return 1.0


def build_level(index, seed):
    rng = random.Random(seed)
    hard = difficulty(index)
    b = Build(rng)

    teaching = index < len(TEACH_ORDER)
    theme = TEACH_ORDER[index] if teaching else rng.choice(TEACH_ORDER)
    taught = TEACH_ORDER[:index] if teaching else TEACH_ORDER
    # The twist beat is where the theme meets something else. Even while a
    # mechanic is still being taught it should not be the whole level — four
    # helpings of the same idea is monotonous, and it stacks the level's one
    # difficulty until nothing else can carry it.
    if teaching:
        simple = [m for m in ('gap', 'step', 'stairs') if m in taught or m == 'stairs']
        spice = rng.choice(simple) if simple else 'stairs'
    else:
        options = [m for m in SPICE if m in taught or m == 'stairs']
        options = [m for m in options if m != theme] or ['gap']
        spice = rng.choice(options)

    profile_name = ['climb', 'descend', 'valley', 'mesa', 'rolling'][index % 5]
    profile = PROFILES[profile_name]

    # Introduce, develop, rest, twist, climax, then release into the gate.
    # While a mechanic is still being taught its first two appearances sit over
    # a safety net; the twist and climax are over real pits.
    beats = [
        ('intro',   theme,             True),
        ('develop', theme,             True),
        ('rest',    'flat',            True),
        ('twist',   spice,             teaching or rng.random() < 0.6),
        ('climax',  theme,             False),
        ('outro',   'flat',            True),
    ]
    # Short levels early, longer once the player is fluent.
    if index < 3:
        beats = [beats[0], beats[1], beats[2], beats[4], beats[5]]

    # Some mechanics are a sequence, not a move: a float crossing is a slow
    # drift up, along and down, and a tunnel is a shrink, a crawl and a regrow.
    # Three helpings of one of those is a long level made of waiting, so they
    # get an introduction and a conclusion and nothing in between.
    if theme in ('float', 'tunnel'):
        beats = [bt for bt in beats if bt[0] != 'develop']
        # And they do not carry the climax either. A drift or a crawl is a slow,
        # committed sequence with no room to raise the stakes inside it, so the
        # level introduces the idea and then closes on something with a beat to
        # it. The level is still named and hinted for the mechanic it teaches.
        beats = [(role, spice if role == 'climax' else name, safe)
                 for role, name, safe in beats]

    opening = b.slab(-1.5, 4.5, 0.0)
    opening['protected'] = True      # never punctuate or garnish the start
    spawn = (1.0, 1.1)
    b.x = 4.5

    for i, (role, name, safe) in enumerate(beats):
        ctx = {
            'hard': hard,
            'safe': safe,
            'peak': role == 'climax',
            'rise_bias': profile[min(i, len(profile) - 1)],
        }
        CHUNKS[name](b, ctx)
        # A change of elevation between beats is what gives the level a shape.
        if role in ('intro', 'develop', 'twist') and rng.random() < 0.9:
            CHUNKS['stairs' if rng.random() < 0.6 else 'step'](b, dict(ctx, safe=True))
        if role == 'climax':
            b.mark(b.x - 1.5, 3)

    # Release: a calm run to the gate, and nothing hazardous on it.
    closing = b.slab(b.x, b.x + 6.0, b.y)
    closing['protected'] = True
    gate_x = b.x + 4.0
    b.mark(b.x + 1.5, 2)
    b.x += 6.0

    _punctuate(b, rng)
    _garnish_hazards(b, rng, hard)
    _place_points(b, rng)

    return {
        'name': f'Extra{index + 1}',
        'title': TITLES[index % len(TITLES)],
        'hint': HINTS.get(theme, '') if teaching else '',
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


DEAD_BUDGET = 9.0   # units of nothing-happening before a level reads as a corridor


def _punctuate(b, rng):
    """Break up any stretch of route where nothing happens.

    Walks the route accumulating flat, featureless distance, remembering the
    slabs it crosses. Past DEAD_BUDGET it punctuates the widest slab in that
    stretch — splitting it with a jumpable gap where there is room, otherwise
    laying a spike strip across it. Either way dead ground becomes a beat.

    Gaps stay well inside the cube's ~7.1 unit reach and both halves keep enough
    width to take off from and land on.
    """
    plain = sorted([s for s in b.path if not s.get('protected') and not any(
        k in s for k in ('spring', 'move', 'blink', 'brittle', 'conveyor'))],
        key=lambda s: s['x'])
    if not plain:
        return
    hazards = [(h['x'] - h['w'] / 2, h['x'] + h['w'] / 2) for h in b.spikes]

    def punctuate(s):
        a, c = s['x'] - s['w'] / 2, s['x'] + s['w'] / 2
        top = s['y'] + THICK / 2
        gap = rng.uniform(2.2, 2.8)
        mid = s['x'] + rng.uniform(-0.1, 0.1) * s['w']
        left, right = mid - gap / 2, mid + gap / 2
        if left - a > 2.0 and c - right > 2.0:
            s['w'] = r(left - a)
            s['x'] = r((a + left) / 2)
            b.slab(right, c, top)
            return True
        if s['w'] > 4.0:
            width = rng.uniform(0.7, 0.95)
            b.spike(s['x'] - width / 2, s['x'] + width / 2, top)
            s['spiked'] = True
            return True
        return False

    run = 0.0
    seen = []
    prev = None
    for s in plain:
        a, c = s['x'] - s['w'] / 2, s['x'] + s['w'] / 2
        top = s['y'] + THICK / 2
        broken = False
        if prev and (a - prev[1] > 0.6 or abs(top - prev[2]) > 0.4):
            broken = True                               # a jump or a step is an event
        if any(x0 < c and x1 > a for x0, x1 in hazards):
            broken = True
        if broken:
            run = 0.0
            seen = []
        run += s['w']
        seen.append(s)
        if run > DEAD_BUDGET:
            for cand in sorted(seen, key=lambda q: -q['w']):
                if punctuate(cand):
                    break
            run = 0.0
            seen = []
        prev = (a, c, top)


def _garnish_hazards(b, rng, hard):
    """Break up long empty ledges with a spike strip to hop.

    A strip needs run-up on one side and landing room on the other, so only
    genuinely long ledges qualify, and the teeth go in the middle where they are
    visible from either approach.
    """
    if hard < 0.18:
        return
    chance = 0.35 + 0.45 * hard
    for s in b.path:
        if s.get('protected') or s['w'] < 5.2 or rng.random() > chance:
            continue
        top = s['y'] + THICK / 2
        width = rng.uniform(0.7, 1.0 + 0.5 * hard)
        cx = s['x'] + rng.uniform(-0.15, 0.15) * s['w']
        b.spike(cx - width / 2, cx + width / 2, top)
        s['spiked'] = True


def _place_points(b, rng):
    """Points as signposts: the reward after a hard beat, the climax, the calm."""
    def supported(x, y):
        best = None
        for s in b.path:
            if s.get('spiked') or s['w'] <= 2.2:
                continue
            if abs(x - s['x']) > s['w'] / 2 - 0.4:
                continue
            dy = abs((s['y'] + THICK / 2) - y)
            if dy < 0.6 and (best is None or dy < best[0]):
                best = (dy, s)
        return best[1] if best else None

    picks = []
    for x, y, importance in sorted(b.marks, key=lambda m: -m[2]):
        s = supported(x, y)
        if not s:
            continue
        if any(abs(x - px) < 6.0 for px in picks):
            continue
        picks.append(x)
        b.coins.append({'x': r(x), 'y': r(s['y'] + THICK / 2 + 0.7)})
        if len(b.coins) >= 4:
            break

    # Fall back to wide floor if the marks did not land anywhere usable.
    if len(b.coins) < 3:
        wide = sorted([q for q in b.path if q['w'] > 3.0 and not q.get('spiked')],
                      key=lambda q: q['x'])
        for q in wide:
            if any(abs(q['x'] - c['x']) < 6.0 for c in b.coins):
                continue
            b.coins.append({'x': q['x'], 'y': r(q['y'] + THICK / 2 + 0.7)})
            if len(b.coins) >= 3:
                break
    b.coins.sort(key=lambda c: c['x'])


def main():
    seeds_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'level_seeds.json')
    seeds = json.load(open(seeds_path)) if os.path.exists(seeds_path) else {}

    levels = [build_level(i, seeds.get(str(i), 1000 + i * 7919)) for i in range(COUNT)]
    for lv in levels:
        for s in lv['solids']:
            s.pop('spiked', None)
            s.pop('protected', None)

    body = (
        '// Generated by tools/generate_levels.py — do not edit by hand.\n'
        '// Every level here is verified finishable by tools/validate_levels.mjs;\n'
        '// the seeds that passed are pinned in tools/level_seeds.json.\n\n'
        'export const EXTRA_LEVELS = ' + json.dumps(levels, indent=1) + ';\n'
    )
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as f:
        f.write(body)

    span = [max(s['x'] for s in lv['solids']) for lv in levels]
    print(f'wrote {os.path.relpath(OUT, ROOT)} — {len(levels)} levels, '
          f'width {min(span):.0f}..{max(span):.0f} units')


if __name__ == '__main__':
    main()
