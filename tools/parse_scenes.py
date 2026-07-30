#!/usr/bin/env python3
"""Read the Unity scenes in Assets/__Scenes and flatten them into plain data.

Unity scene files are YAML documents keyed by anchor: GameObjects reference
their components by fileID, prefab instances carry a list of property
overrides, and transforms nest through m_Father. This walks all of that and
emits, per scene, one record per object with its resolved world position,
world scale, rotation, layer and tag.

Run directly to dump scenes.json, or import parse_all() — convert_scenes.py does.
"""
import re, glob, os, json, sys, math

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ---- guid map -------------------------------------------------------------
guids = {}
for f in glob.glob(os.path.join(ROOT, 'Assets/**/*.meta'), recursive=True):
    s = open(f, errors='ignore').read()
    m = re.search(r'guid: (\w+)', s)
    if m:
        guids[m.group(1)] = os.path.relpath(f[:-5], ROOT)


def split_docs(text):
    """Return list of (anchor, classid, typename, body)."""
    docs = []
    cur = None
    for line in text.splitlines():
        m = re.match(r'^--- !u!(\d+) &(\d+)', line)
        if m:
            if cur:
                docs.append(cur)
            cur = {'class': int(m.group(1)), 'anchor': m.group(2), 'lines': []}
        elif cur is not None:
            cur['lines'].append(line)
    if cur:
        docs.append(cur)
    for d in docs:
        d['body'] = '\n'.join(d['lines'])
        m = re.match(r'^(\w+):', d['body'])
        d['type'] = m.group(1) if m else '?'
    return docs


def vec(body, key):
    m = re.search(re.escape(key) + r': \{x: ([-\d.eE+]+), y: ([-\d.eE+]+)(?:, z: ([-\d.eE+]+))?', body)
    if not m:
        return None
    return [float(m.group(1)), float(m.group(2)), float(m.group(3) or 0)]


def color(body):
    m = re.search(r'm_Color: \{r: ([-\d.eE+]+), g: ([-\d.eE+]+), b: ([-\d.eE+]+), a: ([-\d.eE+]+)\}', body)
    if not m:
        return None
    return [round(float(m.group(i)), 4) for i in range(1, 5)]


def parse_file(path):
    text = open(path, errors='ignore').read()
    docs = split_docs(text)
    by_anchor = {d['anchor']: d for d in docs}
    return docs, by_anchor


PREFAB_CACHE = {}


def prefab_info(relpath):
    """Root defaults of a prefab: name, pos, scale, color, plus child objects."""
    if relpath in PREFAB_CACHE:
        return PREFAB_CACHE[relpath]
    docs, by_anchor = parse_file(os.path.join(ROOT, relpath))
    objs = {}
    for d in docs:
        if d['type'] == 'GameObject':
            nm = re.search(r'm_Name: (.*)', d['body'])
            tag = re.search(r'm_TagString: (.*)', d['body'])
            lay = re.search(r'm_Layer: (\d+)', d['body'])
            comps = re.findall(r'component: \{fileID: (\d+)\}', d['body'])
            objs[d['anchor']] = {
                'name': (nm.group(1).strip() if nm else ''),
                'tag': (tag.group(1).strip() if tag else ''),
                'layer': int(lay.group(1)) if lay else 0,
                'components': comps,
                'anchor': d['anchor'],
            }
    for o in objs.values():
        o['pos'] = [0, 0, 0]
        o['scale'] = [1, 1, 1]
        o['color'] = None
        o['trigger'] = False
        o['sprite'] = None
        o['parent'] = None
        for c in o['components']:
            d = by_anchor.get(c)
            if not d:
                continue
            if d['type'] in ('Transform', 'RectTransform'):
                o['pos'] = vec(d['body'], 'm_LocalPosition') or [0, 0, 0]
                o['scale'] = vec(d['body'], 'm_LocalScale') or [1, 1, 1]
                fp = re.search(r'm_Father: \{fileID: (\d+)\}', d['body'])
                o['tr'] = d['anchor']
                o['father'] = fp.group(1) if fp else '0'
            elif d['type'] == 'SpriteRenderer':
                o['color'] = color(d['body'])
                sm = re.search(r'm_Sprite: \{fileID: [-\d]+, guid: (\w+)', d['body'])
                o['sprite'] = guids.get(sm.group(1), sm.group(1)) if sm else None
            elif d['type'] in ('BoxCollider2D', 'CircleCollider2D', 'PolygonCollider2D', 'CapsuleCollider2D'):
                o['trigger'] = 'm_IsTrigger: 1' in d['body']
    PREFAB_CACHE[relpath] = objs
    return objs


def prefab_root(relpath):
    objs = prefab_info(relpath)
    # root = object whose transform has father 0
    for o in objs.values():
        if o.get('father', '0') == '0':
            return o
    return list(objs.values())[0] if objs else None


def parse_scene(path):
    docs, by_anchor = parse_file(path)
    out = []

    # plain gameobjects
    for d in docs:
        if d['type'] != 'GameObject':
            continue
        nm = re.search(r'm_Name: (.*)', d['body'])
        tag = re.search(r'm_TagString: (.*)', d['body'])
        layer = re.search(r'm_Layer: (\d+)', d['body'])
        comps = re.findall(r'component: \{fileID: (\d+)\}', d['body'])
        o = {
            'kind': 'object',
            'name': (nm.group(1).strip() if nm else ''),
            'tag': (tag.group(1).strip() if tag else ''),
            'layer': int(layer.group(1)) if layer else 0,
            'pos': [0, 0, 0], 'scale': [1, 1, 1], 'color': None,
            'trigger': False, 'sprite': None, 'father': '0', 'anchor': d['anchor'],
            'components': [],
        }
        for c in comps:
            cd = by_anchor.get(c)
            if not cd:
                continue
            o['components'].append(cd['type'])
            if cd['type'] in ('Transform', 'RectTransform'):
                o['pos'] = vec(cd['body'], 'm_LocalPosition') or [0, 0, 0]
                if cd['type'] == 'RectTransform':
                    ap = vec(cd['body'], 'm_AnchoredPosition')
                    if ap:
                        o['pos'] = [ap[0], ap[1], o['pos'][2]]
                o['scale'] = vec(cd['body'], 'm_LocalScale') or [1, 1, 1]
                fp = re.search(r'm_Father: \{fileID: (\d+)\}', cd['body'])
                o['father'] = fp.group(1) if fp else '0'
                o['tr'] = cd['anchor']
                rot = re.search(r'm_LocalRotation: \{x: ([-\d.eE+]+), y: ([-\d.eE+]+), z: ([-\d.eE+]+), w: ([-\d.eE+]+)\}', cd['body'])
                if rot:
                    o['rot'] = [float(rot.group(i)) for i in range(1, 5)]
            elif cd['type'] == 'SpriteRenderer':
                o['color'] = color(cd['body'])
                sm = re.search(r'm_Sprite: \{fileID: [-\d]+, guid: (\w+)', cd['body'])
                o['sprite'] = guids.get(sm.group(1), sm.group(1)) if sm else None
            elif cd['type'] in ('BoxCollider2D', 'CircleCollider2D', 'PolygonCollider2D', 'CapsuleCollider2D'):
                o['trigger'] = 'm_IsTrigger: 1' in cd['body']
                o['colliderType'] = cd['type']
            elif cd['type'] == 'Rigidbody2D':
                o['rigidbody'] = True
            elif cd['type'] == 'Animator':
                o['animator'] = True
                am = re.search(r'm_Controller: \{fileID: [-\d]+, guid: (\w+)', cd['body'])
                o['controller'] = guids.get(am.group(1), '') if am else ''
        out.append(o)

    # prefab instances
    for d in docs:
        if d['type'] != 'PrefabInstance':
            continue
        sm = re.search(r'm_SourcePrefab: \{fileID: \d+, guid: (\w+)', d['body'])
        src = guids.get(sm.group(1), sm.group(1)) if sm else '?'
        mods = {}
        for m in re.finditer(
            r'- target: \{fileID: (-?\d+), guid: (\w+), type: \d+\}\s*\n\s*propertyPath: (\S+)\s*\n\s*value: (.*?)\s*\n\s*objectReference',
            d['body']):
            mods.setdefault(m.group(1), {})[m.group(3)] = m.group(4)
        parent = re.search(r'm_TransformParent: \{fileID: (\d+)\}', d['body'])
        root = prefab_root(src) if src.endswith('.prefab') else None
        # group mods by target: find target that has m_Name (root object)
        entry = {
            'kind': 'prefab',
            'src': src,
            'name': (root['name'] if root else os.path.basename(src)),
            'tag': (root['tag'] if root else ''),
            'pos': list(root['pos']) if root else [0, 0, 0],
            'scale': list(root['scale']) if root else [1, 1, 1],
            'color': (root['color'] if root else None),
            'trigger': (root['trigger'] if root else False),
            'layer': (root.get('layer', 0) if root else 0),
            'sprite': (root['sprite'] if root else None),
            'father': parent.group(1) if parent else '0',
            'anchor': d['anchor'],
            'mods': mods,
            'children': [],
        }
        # apply root modifications: root transform is the one with m_LocalPosition mods
        for tgt, props in mods.items():
            if 'm_Name' in props:
                entry['name'] = props['m_Name']
            if 'm_Layer' in props:
                entry['layer'] = int(props['m_Layer'])
        # transform mods -- take target that has RootOrder + LocalPosition (root transform)
        for tgt, props in mods.items():
            if 'm_AnchoredPosition.x' in props:
                entry['pos'] = [float(props['m_AnchoredPosition.x']),
                                float(props.get('m_AnchoredPosition.y', 0)), 0]
            elif 'm_LocalPosition.x' in props and 'm_RootOrder' in props:
                entry['pos'] = [float(props.get('m_LocalPosition.x', entry['pos'][0])),
                                float(props.get('m_LocalPosition.y', entry['pos'][1])),
                                float(props.get('m_LocalPosition.z', entry['pos'][2]))]
            if 'm_LocalRotation.z' in props:
                entry['rot'] = [0, 0, float(props.get('m_LocalRotation.z', 0)),
                                float(props.get('m_LocalRotation.w', 1))]
            if 'm_LocalScale.x' in props:
                entry['scale'] = [float(props.get('m_LocalScale.x', entry['scale'][0])),
                                  float(props.get('m_LocalScale.y', entry['scale'][1])),
                                  float(props.get('m_LocalScale.z', entry['scale'][2]))]
            for k in props:
                if k.startswith('m_Color.'):
                    if entry['color'] is None:
                        entry['color'] = [1, 1, 1, 1]
                    idx = {'r': 0, 'g': 1, 'b': 2, 'a': 3}[k.split('.')[1]]
                    entry['color'][idx] = round(float(props[k]), 4)
        out.append(entry)

    # stripped transforms belonging to prefab instances: let scene children that
    # parent onto them resolve to the instance's transform.
    alias = {}
    for d in docs:
        if d['type'] in ('Transform', 'RectTransform'):
            m = re.search(r'm_PrefabInstance: \{fileID: (\d+)\}', d['body'])
            if m and m.group(1) != '0':
                alias[d['anchor']] = m.group(1)
    for o in out:
        if o.get('father') in alias:
            o['father'] = alias[o['father']]

    return out


def resolve(objs):
    """Compute world position/scale by walking the transform hierarchy."""
    by_tr = {o['tr']: o for o in objs if o.get('tr')}
    # prefab instances: their root transform anchor isn't directly known; index by
    # instance anchor too so children referencing them resolve.
    by_anchor = {o['anchor']: o for o in objs}

    def parent_of(o):
        f = o.get('father', '0')
        if f == '0':
            return None
        return by_tr.get(f) or by_anchor.get(f)

    for o in objs:
        wp = list(o['pos'])
        ws = list(o['scale'])
        rot = o.get('rot')
        p = parent_of(o)
        seen = 0
        while p is not None and seen < 12:
            wp = [wp[i] * p['scale'][i] + p['pos'][i] for i in range(3)]
            ws = [ws[i] * p['scale'][i] for i in range(3)]
            p = parent_of(p)
            seen += 1
        o['world'] = [round(v, 4) for v in wp]
        o['worldScale'] = [round(v, 4) for v in ws]
        r = o.get('rot')
        if r:
            o['angle'] = round(math.degrees(2 * math.atan2(r[2], r[3])), 3)
        else:
            o['angle'] = 0.0
    return objs


def parse_all():
    """{scene name: [objects with world transforms]} for every scene in the project."""
    result = {}
    for path in sorted(glob.glob(os.path.join(ROOT, 'Assets/__Scenes/*.unity'))):
        name = os.path.basename(path)[:-6]
        result[name] = resolve(parse_scene(path))
    return result


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else 'scenes.json'
    json.dump(parse_all(), open(out, 'w'), indent=1)
    print('wrote', out)
