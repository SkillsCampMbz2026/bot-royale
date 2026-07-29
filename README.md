# 🎯 Bot Royale

A third-person battle royale in the browser — shoot, build, and outlast nine bots inside a closing storm.

**Built with [Three.js](https://threejs.org) r147** (MIT), vendored into `vendor/` so it runs offline and straight off the filesystem. No build step, no npm install, no image or audio files — every texture is painted into a canvas and every sound is synthesised at runtime.

## Play

| Input | Action |
|---|---|
| `W` `A` `S` `D` | Move |
| Mouse | Look · **Click** shoot |
| `Space` | Jump |
| `Shift` | Sprint |
| `1` – `4` | Pickaxe / weapon 1 / weapon 2 / build |
| `Q` | Build mode |
| `F` or mouse wheel | Wall → Ramp → Floor |
| `R` | Reload |
| `Esc` | Pause |

On a phone: left stick to move, drag to look, **FIRE / JUMP / BUILD** on the right.

## How it plays

**Loot.** Weapons, ammo and shield potions are scattered in buildings and across open ground. Four guns — Assault Rifle, Pump Shotgun, SMG and Bolt Sniper — with their own damage, spread, fire rate and headshot multiplier. You carry two.

**Harvest and build.** Swing the pickaxe at trees and rocks for wood, then place **walls, ramps and floors** snapped to the world grid. Structures have health and can be shot down. Ramps are how you take the high ground.

**The storm.** Five phases of waiting then shrinking, with damage climbing each time. The next circle drifts, so sitting in the middle of the map is not a free pass.

**The bots build too.** Nine of them, each with its own accuracy and reaction speed. They hunt whatever they can see — including each other — rotate out of the storm, and slam down a wall when they take fire.

## How it works

**One collision list.** Everything solid — building walls, roofs, trees, rocks and anything built — is registered as an axis-aligned box in a single array. Movement, line of sight, bullets and the pickaxe all query that one list, so a wall you build blocks bots and bullets exactly like a wall that was always there.

**Honest third-person aim.** Shots are a ray from the camera through the crosshair, tested against bots and the world, with whichever is nearer stopping the bullet. What the crosshair covers is what gets hit, even though the camera sits behind your shoulder.

**Walkable ramps.** A ramp is drawn as one sloped slab but collides as four rising steps. The movement code knows how to step up onto a surface but not how to climb a slope, so a real slope would just be a wall you could not climb.

## Running locally

Open `index.html`, or serve it:

```sh
npx serve .
```

## Files

```
index.html            HUD, overlay, canvas
style.css
vendor/three.min.js   Three.js r147 (MIT)
src/arena.js          map, collision list, ray casts, harvesting
src/build.js          grid snapping, placement, ramp collision
src/bots.js           blocky characters and the bot state machine
src/controls.js       pointer lock, keyboard, touch stick
src/audio.js          synthesised sound
src/scores.js         match history in localStorage
src/game.js           player, camera, storm, loot, combat, HUD
```
