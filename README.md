# Cubby

A precision platformer in 59 levels: collect every yellow point, then reach the
green gate.

Cubby started life as a Unity 2020.3 project on 6 August 2021. It now runs in
the browser too. The original nine levels were converted straight out of the
Unity scenes; fifty more were built on top of them, along with the mechanics
they are made of. The web build is what gets published to GitHub Pages.

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
- **Green pads** — springs, which throw you far higher and further than a jump.
- **Amber belts** — conveyors. You can walk against one, slowly.
- **Violet platforms** — phase out on a cycle. They flash first, and never vanish
  while you are standing on one.
- **Cracked tiles** — give way underfoot and grow back a couple of seconds later.
- **Red spikes** — instant death.
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
tools/             the Unity scene converter, the level generator, the validator
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

The other fifty are composed by `tools/generate_levels.py` to a brief, out of
hand-designed chunks sized against the cube's actual movement envelope. The
rules it composes to, and why:

| Rule | In practice |
| --- | --- |
| Introduce, develop, twist, conclude | Every level has one theme mechanic and works through it in beats, closing on a demanding statement of it. The twist beat is always a *different*, already-taught mechanic — a level made of four helpings of one idea is monotonous. |
| Teach where failure is cheap | A mechanic's first encounters sit over a safety net one jump below. Only once the level has taught it does it appear over a real pit. |
| Tension and release | Rest beats follow the peaks, and every level ends on a calm run to the gate rather than on panic. |
| No leaps of faith | Descents are capped so the landing is on screen when you commit. Anything deeper is a staircase of visible ledges. |
| Nothing dead | A pass walks each route and punctuates any stretch where nothing happens, splitting it with a gap or laying a spike strip across it. |
| Points are signposts | They mark the reward after a hard beat, the top of the climax, the calm before the gate — not whatever slab was widest. |
| Silhouette | Each level takes an elevation profile — climb, descend, valley, mesa, rolling — so the set is not fifty variations on one flat line. |
| Sawtooth difficulty | Difficulty ramps inside a chapter and eases at the start of the next, so new ideas arrive with the other demands relaxed. |
| Keep the flow | A moving obstacle is timed to the runner, not to itself. Every cycling feature — blinking tiles, lifts, ferries — has its phase set from how long it takes to run there at speed 7, so holding your pace carries you straight through. Arrive off the beat and you wait one cycle: a legible cost, not a coin flip. |
| Safe to start and finish | The opening ledge and the run to the gate are never punctuated or garnished. |

Measured against the first version of the generator:

| | before | after |
| --- | --- | --- |
| blind drops (landing off screen) | 60% of descents | **0%** |
| median height range (silhouette) | 4.8 units | **8.7 units** |
| worst stretch with nothing happening | 41.5 units (~6 s) | **14.9 units (~2 s)** |
| levels with no hazard at all | 31 of 50 | **4 of 50** |

And against the version before the cycling features were timed to the runner —
a bot that holds right and never deliberately waits, across the 11 levels that
have a cycling feature:

| | before | after |
| --- | --- | --- |
| worst level, time forced to stand still | 1.8 s | **0.7 s** |
| all 11 levels together | 5.9 s | **3.4 s** |
| how far that bot gets, mean | 61% of the way to the gate | **68%** |

The structural worst case — arriving exactly as a cycle turns over — was 10.1 s
before and is one cycle now, by construction.

Composition still does not prove a level can be finished, so
`tools/validate_levels.mjs` drives a bot through every one of them:

```sh
cd docs && python3 -m http.server 8099 &      # the validator drives a real page
node tools/validate_levels.mjs                # reports which levels are finishable
node tools/validate_levels.mjs --search       # re-seeds the ones that are not
```

The bot holds right, jumps when the ground runs out or something red is coming,
waits for ferries, and climbs walls by jumping into them — then retries from
banked checkpoints with jittered timing when it dies. A checkpoint is only
banked from a position the run can still be won from, with no point left
behind: the bot never turns round, so a bank taken past a missed point poisons
every attempt that resumes from it. The banks form a ladder up the level and
the draw is weighted toward the top of it, or a long level's ending never gets
attempted at all. A level ships only once
that bot has collected every point and reached the gate; the seeds that passed
are pinned in `tools/level_seeds.json`. All 50 currently pass.

Physics tuning is taken from the Unity project rather than re-invented: speed 7
(12 while boosted), jump force 7, mass 1, gravity scale 1.4 against Physics2D's
-9.81, a 1 × 1 box collider with rotation frozen. Unity's layers survive the
conversion too — layer 8 (`zemin`) is floor you can jump from, layer 9 (`wall`)
is climbable. The animated platforms follow the original AnimationClips: the
Level 7 shuttle is `xmove.anim`'s two-second cosine sweep, and the Level 4
platforms pulse on `MovingRectangle.anim`'s 2.58-second scale loop.

Level 6's plank is the game's only `Rigidbody2D` platform, and the reason the
level is called Heavy and hands you a B orb. It is rigid under a small or
normal cube — it does not shift at all — and gives way only under a big one
(mass 4), creaking for a moment before dropping out of the level and taking
you down to the floor below.

Coyote time and a jump buffer are the one deliberate feel change. They only make
inputs land that were already going to work, so nothing the original refused
becomes possible.

### Level 3

Level 3 is the one level whose geometry is not a straight conversion, because as
authored it cannot be finished:

- Leaving the middle ledge, the hanging wall blocks any rightward movement until
  you have fallen below y = -3.16. By then you are falling at ~9.8 u/s and the
  only landing is three units further right than the arc reaches. An exhaustive
  sweep of ~200,000 launch positions, jump timings and air-control schedules
  lands it **zero** times — every attempt falls into the kill plane.
- The left wall's top is at y = 3.97, but the ramp that should continue from it
  has its underside at y = 2.82–3.68 across the wall's whole width, so a climber
  is stopped underneath it and can never stand on the wall.
- Which leaves the 28-unit roof — the largest thing on screen and the obvious
  route — unreachable.

`tools/convert_scenes.py` therefore patches the level after conversion, in
`fix_level3()`: two ledges added so the descent lands somewhere, and the ramp
re-seated clear of the wall's climbing column. Every original platform is kept.
The same sweep now succeeds 79,012 times, and an autopilot with no
frame-accurate inputs finishes the level in 8 seconds. The roof is now a real
alternate route down to the gate.

## Publishing

Pushing to `main` runs `.github/workflows/pages.yml`, which uploads `docs/` and
deploys it. The repository needs **Settings → Pages → Source → GitHub Actions**
selected once; after that every push that touches `docs/` redeploys.

## License

[MIT](https://choosealicense.com/licenses/mit/)
