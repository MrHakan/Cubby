# Cubby

A small precision platformer: collect every yellow point in a level, then reach
the green gate.

Cubby started life as a Unity 2020.3 project on 6 August 2021. It now also runs
in the browser — the nine levels were converted straight out of the original
Unity scenes, and the web build is what gets published to GitHub Pages.

**▶ Play: https://mrhakan.github.io/Cubby/**

## Controls

| Action | Keys |
| --- | --- |
| Move | `A` / `D` or `←` / `→` |
| Jump | `W`, `↑` or `Space` |
| Restart level | `R` |
| Slow motion | hold `V` |
| Pause | `Esc` |
| Mute | `M` |

On a touch screen the game shows its own pads.

## Tricks

- **Wall climbing** — press into a grey hatched wall and keep jumping to scale it.
- **S / N / B orbs** — shrink, reset, or grow. Your size also changes your mass.
- **Gravity orbs** — `↑` flips your fall so you drift upward, `↓` drops you back down.
- **Speed strips** — some floors make you fast for the rest of the level.
- There is one easter egg. It is behind a door that does not look like a door.

## Repository layout

```
Assets/            the original Unity 2020.3 project (scenes, prefabs, sounds)
docs/              the web build — this is what GitHub Pages serves
  index.html         page shell, HUD and menus
  src/core/          input, audio, save data
  src/game/          physics, world, player, level flow, generated level data
  src/render/        camera, canvas renderer, particles
  assets/audio/      the original .wav clips
tools/             the Unity scene → JavaScript converter
.github/workflows/ the Pages deployment
```

## The web build

No framework, no bundler, no dependencies — plain ES modules and a 2D canvas.
Open `docs/index.html` through any static server and it runs:

```sh
cd docs && python3 -m http.server 8000
```

The level geometry is not hand-copied. `tools/convert_scenes.py` reads the
`.unity` scene files, resolves prefab overrides and transform parenting, and
writes `docs/src/game/levels.js`. Re-run it whenever a scene changes:

```sh
python3 tools/convert_scenes.py
```

Physics tuning is taken from the Unity project rather than re-invented: speed 7
(12 while boosted), jump force 7, mass 1, gravity scale 1.4 against Physics2D's
-9.81, a 1 × 1 box collider with rotation frozen. Unity's layers survive the
conversion too — layer 8 (`zemin`) is floor you can jump from, layer 9 (`wall`)
is climbable. The animated platforms follow the original AnimationClips: the
Level 7 shuttle is `xmove.anim`'s two-second cosine sweep, and the Level 4
platforms pulse on `MovingRectangle.anim`'s 2.58-second scale loop.

Coyote time and a jump buffer are the one deliberate departure. They only make
inputs land that were already going to work, so nothing the original refused
becomes possible.

## Publishing

Pushing to `main` runs `.github/workflows/pages.yml`, which uploads `docs/` and
deploys it. The repository needs **Settings → Pages → Source → GitHub Actions**
selected once; after that every push that touches `docs/` redeploys.

## License

[MIT](https://choosealicense.com/licenses/mit/)
