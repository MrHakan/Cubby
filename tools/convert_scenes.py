#!/usr/bin/env python3
"""Convert the Unity scenes into docs/src/game/levels.js.

The web build reads its geometry from a generated JS module rather than from
the .unity files, so this is the one place that knows how a Unity scene maps
onto the web game's entities:

    tag "point"     -> a collectable point
    tag "PowerUp"   -> S / N / B / gravity orb, by object name
    tag "Extras"    -> the speed strip (its SpeedBoost child collider)
    "win"           -> the level gate
    "fall"          -> the kill plane; its top edge becomes killY
    "easteregg" /
      "easter_exit" -> the doors between Level 6 and the bonus room
    "arrow"         -> a signpost, drawn but not collidable
    everything else -> a solid, with Unity's layer deciding what it behaves as:
                       8 "zemin" is floor, 9 "wall" is climbable, anything else
                       is scenery you can still stand on

Usage:  python3 tools/convert_scenes.py
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parse_scenes import ROOT, parse_all  # noqa: E402

OUT = os.path.join(ROOT, 'docs', 'src', 'game', 'levels.js')

ORDER = ['Level1', 'Level2', 'Level3', 'Level4', 'Level5',
         'Level6', 'Level7', 'Level8', 'Level9']

# Scene furniture with no gameplay meaning in the web build.
IGNORE_NAMES = {
    'Main Camera', 'Main Camera (1)', 'EventSystem', 'Post Processing', 'Sounds',
    'Canvas', 'TimerText', 'PointText', 'LevelText', 'FinishText', 'Platforms',
    'Colliders', 'Points', 'PowerUps', 'Global Volume', 'Invisible Walls', '',
}

POWERUPS = {'smallSize': 'small', 'normalSize': 'normal', 'bigSize': 'big',
            'noGravity': 'antigravity', 'Gravity': 'gravity'}

TITLES = {
    'Level1': 'First Steps', 'Level2': 'Backtrack', 'Level3': 'The Climb',
    'Level4': 'Pulse', 'Level5': 'Stepping Stones', 'Level6': 'Heavy',
    'Level7': 'Shuttle', 'Level8': 'Upside Down', 'Level9': 'Boost',
}

HINTS = {
    'Level1': 'Collect every point, then reach the green gate.',
    'Level2': 'The gate is behind you — climb your way back.',
    'Level3': 'Grey walls can be climbed: jump into one, then jump again.',
    'Level4': 'Those platforms are shrinking. Time your hops.',
    'Level5': 'N returns you to normal size, S shrinks you down.',
    'Level6': 'B makes you heavy — not every platform will hold.',
    'Level7': 'Ride the shuttle across the gap.',
    'Level8': 'The antigravity orb flips your fall. G brings you back down.',
    'Level9': 'Something on this floor makes you fast.',
}


def r(v, n=3):
    return round(float(v), n)


def convert(name, objs):
    out = {'name': name, 'title': TITLES.get(name, name), 'hint': HINTS.get(name, ''),
           'spawn': [0, 0], 'killY': -12, 'goal': None,
           'solids': [], 'coins': [], 'powerups': [], 'zones': [], 'decor': []}

    for o in objs:
        nm = o['name']
        if nm in IGNORE_NAMES:
            continue

        x, y = r(o['world'][0]), r(o['world'][1])
        w, h = r(abs(o['worldScale'][0])), r(abs(o['worldScale'][1]))
        ang = r(o.get('angle') or 0, 2)
        tag = o.get('tag', '')
        layer = o.get('layer') or 0

        if tag == 'Player' or nm == 'Player':
            out['spawn'] = [x, y]
        elif tag == 'point':
            out['coins'].append({'x': x, 'y': y})
        elif tag == 'PowerUp':
            out['powerups'].append({'x': x, 'y': y, 'type': POWERUPS.get(nm, nm)})
        elif tag == 'Extras' or nm.startswith('Extras'):
            # The prefab's SpeedBoost child sits at (0.96, -0.92) with a
            # 4 x 1.6 box collider scaled 1.0609579 on x.
            out['zones'].append({'type': 'speed', 'x': r(x + 0.96), 'y': r(y - 0.92),
                                 'w': r(4 * 1.0609579), 'h': 1.6})
        elif nm == 'fall':
            out['killY'] = r(y + h / 2)
        elif nm == 'win':
            out['goal'] = {'x': x, 'y': y, 'w': max(w, 0.6), 'h': h}
        elif nm in ('easteregg', 'easter_exit'):
            out['zones'].append({'type': nm, 'x': x, 'y': y, 'w': w, 'h': h})
        elif nm.startswith('arrow'):
            out['decor'].append({'type': 'arrow', 'x': x, 'y': y, 'flip': abs(ang) > 90})
        else:
            out['solids'].append(make_solid(o, nm, x, y, w, h, ang, layer))

    return out


def make_solid(o, nm, x, y, w, h, ang, layer):
    if nm.startswith('invisiblewall'):
        kind = 'invisible'
    elif layer == 9:
        kind = 'wall'
    elif layer == 8:
        kind = 'ground'
    else:
        kind = 'plain'

    s = {'x': x, 'y': y, 'w': w, 'h': h, 'kind': kind}
    if abs(ang) > 0.01:
        s['angle'] = ang

    if nm == 'rec move':
        # xmove.anim sweeps local x as a 2 s cosine between 7.53 and -5.06.
        # Shift the centre by however far the parent transform offsets it.
        offset = o['world'][0] - o['pos'][0]
        s['move'] = {'axis': 'x', 'center': r(1.235 + offset), 'amp': 6.295, 'period': 2}
    elif nm.startswith('RectangleMoving'):
        # MovingRectangle.anim eases scale.x 4 -> 0.746 -> 4 on a 2.583 s loop.
        s['pulse'] = {'from': 4.0, 'to': 0.7461195, 'period': 2.5833333}
    elif nm.startswith('Rectangle RB'):
        # The Level 6 plank — the only Rigidbody2D platform in the game, and
        # the reason the level is called Heavy and hands you a B orb.
        # It is rigid under a small or normal cube (mass 0.5 / 1) and gives way
        # under a big one (mass 4), dropping you to the floor below.
        s['brittle'] = {'holds': 1, 'creak': 0.45}

    return s


# --------------------------------------------------------------------------
# Level fixes
#
# A straight conversion of Level 3 is unwinnable, and not because of the
# conversion — the scene is built that way. Three measured faults:
#
#  1. The crossing is impossible. Leaving the middle ledge (top y=0.30, right
#     edge x=0.02), the hanging wall at x[4.77, 5.77] spans y[-2.66, 6.74], so
#     you cannot move right until you have fallen below y=-3.16. By then you
#     are falling at ~9.8 u/s and the only landing, x[7.22, 9.98] at y=-6.35,
#     is 3 units further right than the arc can carry you. An exhaustive sweep
#     of ~200k launch positions, jump timings and air-control schedules lands
#     it zero times; every attempt falls past into the kill plane.
#
#  2. The left wall leads nowhere. Its top is y=3.97, but the 30 degree ramp
#     that should continue from it has its underside at y=2.82..3.68 across
#     the wall's whole width, so a climber is stopped under the ramp and can
#     never stand on the wall.
#
#  3. Consequently the 28-unit ceiling at y=7.69 — the largest thing on screen
#     and the obvious route — cannot be reached at all.
#
# The fixes below keep every original platform and the level's identity as the
# wall-climbing level. They add two ledges to make the descent land somewhere,
# and re-seat the ramp clear of the wall's climbing column so the top half of
# the level becomes real. Geometry is in the same world units as the scene.
# --------------------------------------------------------------------------

LEVEL3_STEP = {
    # Breaks the fall out of the middle ledge, so the crossing reads as a hop
    # rather than a plunge.
    'x': 2.35, 'y': -1.6, 'w': 2.4, 'h': 0.5, 'kind': 'ground',
}

LEVEL3_BASE = {
    # The floor of the hanging wall. Catches the descent and puts the second
    # point (5.31, -4.94) at head height, then steps down to x[7.22, 9.98].
    'x': 5.1, 'y': -5.85, 'w': 4.0, 'h': 0.5, 'kind': 'ground',
}

LEVEL3_RAMP = {
    # Replaces the 30 degree ramp. Runs from (-14.6, 4.30) to the ceiling's
    # top-left corner (-10.50, 7.69): a short hop up from the left wall's top
    # at y=3.97, and its left end stops at x=-14.6, clear of the x[-15.94,
    # -14.94] column a climber occupies.
    'x': -12.27, 'y': 5.65, 'w': 5.32, 'h': 0.9, 'angle': 39.6, 'kind': 'ground',
}


def fix_level3(level):
    solids = []
    replaced = False
    for s in level['solids']:
        if abs(s.get('angle', 0) - 30) < 1:      # the one 30 degree ramp
            solids.append(dict(LEVEL3_RAMP))
            replaced = True
        else:
            solids.append(s)
    if not replaced:
        raise SystemExit('Level3: expected a 30 degree ramp to re-seat, found none')
    solids.append(dict(LEVEL3_STEP))
    solids.append(dict(LEVEL3_BASE))
    level['solids'] = solids
    return level


FIXES = {'Level3': fix_level3}


def main():
    scenes = parse_all()
    levels = [convert(n, scenes[n]) for n in ORDER]
    for lv in levels:
        if lv['name'] in FIXES:
            FIXES[lv['name']](lv)

    bonus = convert('EasterEgg', scenes['EasterEgg'])
    bonus['title'] = 'easter egg??'
    bonus['hint'] = 'You were not supposed to find this. Walk back through the door.'
    bonus['goal'] = None

    body = (
        '// Generated from the Unity scenes in Assets/__Scenes by tools/convert_scenes.py.\n'
        '// Do not edit by hand — re-run the converter instead.\n'
        '// Coordinates are Unity world units: +x right, +y up, origin at the scene centre.\n\n'
        'export const LEVELS = ' + json.dumps(levels, indent=1) + ';\n\n'
        'export const BONUS_LEVEL = ' + json.dumps(bonus, indent=1) + ';\n'
    )
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as f:
        f.write(body)

    print(f'wrote {os.path.relpath(OUT, ROOT)} — {len(levels)} levels + bonus room')
    for lv in levels:
        print(f"  {lv['name']:<8} {len(lv['solids']):>3} solids  "
              f"{len(lv['coins'])} points  {len(lv['powerups'])} orbs")


if __name__ == '__main__':
    main()
