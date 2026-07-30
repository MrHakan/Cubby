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
        # A Rigidbody2D plank balanced on a pillar: a see-saw.
        s['dynamic'] = {'mass': 5}

    return s


def main():
    scenes = parse_all()
    levels = [convert(n, scenes[n]) for n in ORDER]

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
