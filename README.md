<div align="center">

# VELORIA

### No engine. No assets. No build step.

**A 2D pixel-art ARPG that forges itself at load —
every sprite, every shadow, every note of music written in code.**

### ▶ [Play it in your browser](https://therealden4700.github.io/veloria/)

*by [therealden4700](https://github.com/therealden4700)*

</div>

![The Breach Heart](shots/veloria-breach-heart.png)

> **The Breach Heart** — the act three boss. The rings on the ground are void
> vents: you cannot fight inside one, you can cross it, and a dash carries you
> through for free.

| | |
|---|---|
| ![The Molten Colossus](shots/veloria-colossus.png) | ![Warden of the Frost](shots/veloria-frost-warden.png) |
| **The Molten Colossus** · The Smoldering Waste | **Warden of the Frost** · The Frozen Ridge |

---

## What it is

A full action RPG that runs in a browser tab. A hub city, **five biomes** with
their own bosses, an **endless dungeon** that gets more hostile the deeper you
go, **three acts** of story to level 52, guild contracts, a forge, elemental
reactions, skill runes, set bonuses and legendary properties that change how you
play rather than how much you hit for.

## What makes it unusual

**Nothing is imported.** There is no engine, no sprite sheet, no audio file, no
font file, no npm install and no build step. Every tile, monster, item icon,
letter, sound effect and piece of music is **generated in code while the game
loads** — from a handful of colour ramps and parameters. The whole project has
exactly one external asset: `assets/title.png`, the title screen.

That is not a stunt. A monster is a line of configuration, so adding one costs a
line. A biome is a palette plus a list, so a new one is an afternoon. The whole
game is 480×270 pixels upscaled with hard edges, with a second canvas on top
carrying the interface at native resolution — pixels stay square, text stays
sharp.

**Every number is proved, not guessed.** In `tools/` there are headless stands
that import the real game and run the real rules with no screen: combat, loot,
zones, the descent, saves, and a long soak run that plays the game to itself.
They do not simulate the rules — they *are* the rules, shared with the game
through `src/systems/`. When a weapon drifts, a boss turns into a sponge or a
build becomes a trap, the stand says so with a number.

Five separate times this project a finding turned out to be in the measuring
apparatus rather than in the game. Each of those is written down too.

## Run it

The quickest way is [the live build](https://therealden4700.github.io/veloria/) —
it needs nothing installed. That page is single player: it is static files, so
there is no room server behind it and the "shared city" button is not shown.

For co-op, or to run it yourself:

```bash
node server/server.js
```

Then open <http://localhost:8123>. **Node 22.5 or newer** and nothing else —
there is nothing to install, but the server stores characters through the
built-in `node:sqlite`, which older releases do not have. One process serves the
files, runs the co-op room and keeps the save; the database creates itself on
first launch.

For single player alone, any static server will do (`python3 serve.py` is
included, and it needs no Node at all). It will not run from `file://` — the
game is built on ES modules.

**Controls.** `WASD` to move, `LMB` or `Space` to attack, `RMB` and `F`/`R`/`G`
for skills, `Shift` to dash, `Q` for a potion, `E` to interact. `I` inventory,
`C` character, `U` quests, `M` map, `Esc` menu, `F3` frame profiler.

## What's in the box

| | |
|---|---|
| **Biomes** | Emerald Forest · Ashen Mire · Frozen Ridge · Smoldering Waste · The Breach |
| **Endgame** | an endless dungeon where depth adds corruption, not just bigger numbers |
| **Story** | three acts, 34 quests, levels 1 → 52 |
| **Combat** | light/heavy combos, shields you must flank, dodges you must break, terrain that hurts |
| **Elements** | four marks that react with each other — corrosion, conduction, steam, shatter |
| **Gear** | rarities, affixes, set bonuses, 22 legendary properties, skill runes you fuse |
| **Forge** | crafting, reforging, salvage, and sharpening that can destroy the weapon |
| **Languages** | Russian and English, switchable in settings |
| **Multiplayer** | a room server on Node built-ins; the server simulates, the client predicts |

## Everything below is a work journal

What follows is not documentation — it is the record of the work: what was
measured, what it showed, what was built as a result, and why it was built that
way. Mistakes included, kept in place, because the reasoning is the point.


A 2D pixel ARPG in the browser: a hub city, five biomes, an endless dungeon,
quests, loot, levelling. Every sprite, sound and note is generated in code at
load time — the only external file in the whole project is `assets/title.png`,
the title screen art.

The title art is stored at exactly 480×270, the game's internal resolution: it
is drawn one to one, without smoothing, and scales up with the rest of the
frame on the same ladder of pixels. Storing it larger would be pointless — the
canvas is 480 pixels wide anyway — and this way it weighs 265 KB instead of two
and a half megabytes. It loads in parallel with baking the sprites, so it costs
nothing on the loading screen (measured: 3 ms out of 98). If the file goes
missing, the title screen draws the old background of stars and a city
silhouette — the game must not fall over because of a picture.

The port comes from an environment variable: `PORT=9000 node server/server.js`.

## Controls

| Action | Keys |
|---|---|
| Move | `W A S D` / arrows |
| Attack | `LMB` or `Space` |
| Skills (three rune slots) | `F` / `R` / `G` (or `1` `2` `3`) |
| Dash (with i-frames) | `RMB` or `Shift` |
| Drink a potion | `Q` |
| Interact | `E` |
| Inventory / Character / Quests / Map | `I` / `C` / `U` / `M` |
| Drop an item | `RMB` on it in the bag (with confirmation) |
| Elements (reaction chart) / Notes | tabs in the journal |
| Pause | `Esc` |
| Settings | an entry on the title screen and in the pause menu |
| Fullscreen | `F11` or the button in settings |

Sound and screen live in one Settings panel, which opens both from the title
screen and from the pause menu, and returns to whichever called it. In the pause
menu they used to be two toggle rows taking as much space as "Save" and "Quit",
though they are touched noticeably less often.

The panel works with both mouse and keys — people reach the pause menu from the
keyboard, and losing that in the move would have been a break rather than a
port: `↑` `↓` pick a row, `← →` turn the volume in 5% steps, `Enter` presses,
`Esc` goes back.

Settings live in `localStorage` **separately from the save**: volume belongs to
the person, not to the character, and "New game" does not reset it. The mute
switch and the slider are different things: unmuting restores the volume that
was set, not 1.0; and conversely, moving the slider off zero unmutes by itself,
otherwise the player drags the slider, hears nothing, and decides the sound is
broken.

Attacks aim at the mouse cursor. If you move with the keyboard only, the hero
strikes in the direction of travel.

## What is in the game

You can only sell at a merchant — not out of your bag in the middle of a
dungeon. Dropping is a right click on the item, with confirmation: a dropped
item is gone for good, because pickup magnets loot within 46 pixels and a
dropped item would come back to the bag half a second later.

**Veloria** is the safe city. A blacksmith (weapon trading plus the forge:
crafting, sharpening, reforging, salvage), an armourer (armour, helms,
trinkets), an alchemist (potions, town portal scrolls), a rune weaver (skill
runes, and fusing three identical ones into a higher grade), a mentor (spend
stat points, respec for 200 gold), a guild captain (quests), and a gatekeeper
(fast travel across the biomes you have opened).

**Biomes** open by level and differ in monsters, weather and light:

| Biome | Level | Boss |
|---|---|---|
| Emerald Forest | 1–6 | Rootgrave the Treant |
| Ashen Mire | 6–13 | The Silt Hag |
| Frozen Ridge | 13–21 | Warden of the Frost |
| Smoldering Waste | 21–32 | The Molten Colossus |
| The Breach | 40–52 | The Breach Heart |

Every biome has: a portal home, a campfire, chests, a boss arena, an entrance to
the catacombs, and **three points of interest** out of four possible ones —
ancient ruins with an obelisk granting a 90-second blessing; a bandit camp that
springs an ambush when you approach; a pack leader's lair with an affixed elite
and a rich chest; and a wandering merchant's camp with rare stock.

**Enemies travel in packs**, not one by one: a shield bearer in front, archers
behind, a shaman at the back. Spot one and the whole pack rises. Eight
templates: patrol, outpost, warband, pack, coven, mines, brutes, loner.

## The game explains itself

There is deliberately no tutorial at the start: dumping thirteen skills, four
elemental reactions, sharpening milestones and Abyss corruption on a player in
the first minute means explaining nothing. Instead, each system explains itself
**at the moment it first becomes relevant**, exactly once, and is remembered in
the save.

Eighteen such moments: the first attack combo, the first rune, the first
passive, the first shield bearer, the first mark on an enemy, the first reaction
that fires, the first affixed elite, the first visit to the forge, the first
sharpening and its milestones, the first completed set, the first legendary, the
dungeon doors, a cursed altar, entering the Abyss, a depth record.

The card **slides in from the side and blocks nothing** — not combat, not
controls, not menus. A modal window in the middle of a fight would be the worst
possible way to explain anything. It lives nine seconds, leaves by itself, and
can be dismissed with Esc or a click; if several fire at once they queue and
show one at a time.

Everything shown accumulates in the **Notes** tab of the journal: an explanation
that flashed by during a fight would otherwise be lost forever.

## The Abyss

Past floor 25 the catacombs become the **Abyss**. The reason was not a shortage
of content: simulation showed that depth was not breaking, it was **sagging**. On
floor one hundred the hero killed a regular monster in 12.8 hits and died in
18.5 — fights stretched out, danger did not grow. Classic number inflation.

So **Corruption** does not hit monster health (that would only make fights even
longer):
it hits the hero's margin for error instead. It grows with depth, cannot be
removed and cannot be chosen:

| | effect |
|---|---|
| Hero health | up to −50% |
| Enemy damage | up to +100% |
| Enemy speed | up to +40% |
| Loot and experience | up to +360% / +280% |

Monster health, meanwhile, grows three times more slowly than before. The
result (a level 40 hero in tier 6 legendaries — the gear ceiling):

| floor | corruption | hits until the hero dies | time to kill a monster |
|---|---|---|---|
| 20 | — | 18.7 | 0.9 s |
| 26 | 1 | 15.2 | 1.5 s |
| 35 | 10 | 9.5 | 1.6 s |
| 45 | 20 | 6.3 | 1.8 s |
| 55 | 30 | 4.4 | 2.2 s |
| 65 | 40 | 2.8 | 2.1 s |
| 100 | 40 | 2.1 | 3.1 s |

The curve flattens rather than falling to zero: otherwise depth would hit a wall
of "killed in one hit". The ordinary catacombs down to floor 25 are untouched.

Armour suggested itself as a third lever, but measurement showed the hero's
damage reduction already sits around 50% and never reaches the 82% cap — there
was nothing to punch through. Dropped as a lever that does nothing while making
the model harder to reason about.

**The deeper you go, the cleaner the loot.** The rarity floor rises with
corruption: by floor 40 common items stop dropping, by floor 62 only epics and
legendaries do. The same place yields the **Abyss Tear** and three unique
properties found nowhere else — not in the drop tables, not from sharpening to
+7: **Hollow Heart** (corruption takes half as much health), **The Insatiable**
(every kill grants +2% damage until the end of the floor), and **Gaze of the
Abyss** (a hit you take has a 25% chance to put all four marks on the attacker
at once).

On the Abyss boss floors the **guardians rotate** — the Void Maw, the Hollow
King, the Smoldering Widow, the Root Warden and the Lich: twenty-six boss floors
in a row with the same fight would not be a ladder.

The depth record is stored separately from the save — a new game does not erase
it, otherwise the ladder would reset along with the character.

**The catacombs are a run, not a corridor.** Before each descent you choose
between two doors with floor modifiers: horde, frenzy, fortification, gloom,
hunger, greed, brittleness, hunted, bounty, lull. Risk raises loot and
experience by up to +90%. Cursed altars turn up on the floors: six bargains
where you always give something up — a fifth of your health for a third more
damage, half your gold for a rare item, your third skill slot for +60%
experience. The gifts last until you surface. The deeper you are, the more often
monsters carry affixes: swift, armoured, blazing, vampiric, titanic, spectral.
Every fifth floor is a boss, and while it lives the way down is shut.

**Skills are runes, not classes.** Thirteen active ones (whirlwind, cleave,
concussion with a stun, shadow dash, impale, arcane volley, arrow rain, chain
lightning, wall of fire, frost nova, poison cloud, healing, barrier) and
thirteen passive ones. Three active slots plus one passive; the weapon affects
none of it. A rune's rarity strengthens the effect and shortens the cooldown;
three identical runes fuse into one of a higher grade.

## The elements work with each other

Burning, poison and chill used to be parallel timers: each on its own, none
aware of the others. Now they are **marks** — a shared currency — and two marks
meeting produce a third effect. The second mark does not stack on the first:
they collapse into a reaction.

| Marks | Reaction | Effect | Purpose |
|---|---|---|---|
| fire + poison | **Corrosion** | strong DoT and −30% defence for 6 s | single-target damage |
| shock + ice | **Conduction** | shock arcs to three neighbours, the mark travels | crowds |
| fire + ice | **Steam** | a cloud: enemies inside cannot shoot or cast | cover from archers |
| heavy blow + ice | **Shatter** | a hit on a chilled target lands twice as hard | burst |

Each reaction has its own role, otherwise choosing between them would be
cosmetic. Shock on its own adds +22% to damage the target takes; corrosion adds
another +30%.

Marks show as icons above the enemy; a reaction has its own name, colour and
flash. The whole chart lives in the **Elements** tab of the journal — without it
the system is impossible to discover on your own.

**A reaction on a target has an internal 1.2-second cooldown.** Without it, two
elements on a weapon would produce a reaction on every hit — three to five per
kill — and the combination would stop being the player's decision, turning into
a passive damage multiplier.

Five passive runes read the target's state, turning gear collection into build
assembly: **Pyrokinesis** (+35% damage to burning targets), **Ice Heart** (+25%
crit against chilled ones), **Toxicologist** (poison ticks 80% more often),
**Catalyst** (reactions 60% stronger), **Resonance** (each reaction cuts 1.2 s
from cooldowns). Four legendary properties hang off the same system: **Frost
Brand** applies chill on every hit (shatter and steam without ice runes),
**Icebreaker** doubles shatter, **Lightning Rod** adds three targets to the
chain, and **Ash Plague** sets everything around a dying burning enemy alight.

**Enemies demand different play.** Shield bearers hold the front and turn the
shield with a delay — come from the side or break it with the third blow of the
combo. Men-at-arms also cut light hits down. Sappers swell and explode. Shamans
heal allies with a beam — kill them first. Archers and casters force you to
close the distance.

**Progression** — four stats (Strength, Vitality, Agility, Intellect), three
points per level. Five gear slots, five rarity grades, affixes with scaling
bonuses (lifesteal, burn, poison, chill, crit).

**Legendaries are properties, not numbers**: Thunderstrike fires chain lightning
on every third hit, Ashen Step leaves a trail of fire behind a dash, Bulwark
nullifies one blow entirely every 9 seconds, the Ring of Echoes has a chance to
reset a skill cooldown. Ten in total. From tier three, armour, helms and
trinkets belong to **sets** — Guardian of Veloria, Arcanist's Vestments,
Hunter's Kit, Dragon Clutch — with bonuses at 2 and 4 pieces.

**Borin's Forge** — four tabs.

*Crafting*: 37 recipes across six tiers — weapons of all six types, armour and
helms, rings and amulets, potions and scrolls. A crafted item is always rare,
with an 18% chance of epic, which makes it reliably better than a random drop of
the same tier. Materials drop from monsters by biome: iron ore from goblins and
skeletons, silver veins in the ridge, dragon scale from ashen elites, void
shards from the depths of the catacombs.

*Sharpening*: you take your equipped weapon, put in **three weapons of exactly
the same rarity** and some gold. The chance per attempt comes from the base
item's rarity: 60% on common, 40% on uncommon, 25% on rare, 14% on epic, 8% on
legendary. Success gives +12% to all stats and a "+N" in the name, up to +8.
Until the first milestone is reached, **failure burns everything, including the
weapon itself** — the button demands a second press and glows red.

**Sharpening milestones** are the reason to keep a weapon for longer than two
levels. Bare percentages gave no such reason: if the blade is going to be
replaced by the next biome anyway, the risk costs nothing and you may as well
sharpen anything.

| Milestone | What it gives |
|---|---|
| **+3** | a bonus affix on top of what the rarity allows |
| **+5** | another affix and the "Tempered" prefix in the name |
| **+7** | a unique legendary property — available on **rare** weapons and above |

Milestones are also **checkpoints**: once you have +3, failure no longer
shatters the weapon but rolls it back to the last milestone (the fuel always
burns). Without this, deep sharpening was arithmetically dead — the
all-or-nothing chain started over after every failure, and one run in 68,000
reached +7 on a rare weapon. Below the first milestone the old rule stands: bad
luck and it all falls apart.

Average fuel spent per success (simulation, 120,000 runs):

| Rarity | to +3 | to +5 | to +7 |
|---|---|---|---|
| common | 27 | 41 | closed |
| uncommon | 73 | 99 | closed |
| rare | 247 | 321 | 362 |
| epic | 1305 | 1446 | 1562 |

Hence the shape of it: sharpen junk deeply, treat rares carefully. An uncommon
blade sharpened to +5 with two extra affixes beats a fresh find of its tier, and
+7 on a rare is a whole-endgame project.

Milestones are shown as a track right on the sharpening screen: you can see both
how far the reward is and where a failure would drop you. Milestone affixes do
not crowd into the name — they are gathered in a separate "Tempering" line on the
item card. A sharpened weapon is visible on the hero too: from +3 the sprite is
taken a tier higher, from +6 two.

**Unique properties cannot be forged.** You either find one on a legendary or
earn it by sharpening to +7 — and that is the only way to put a legendary
property on a weapon you chose yourself.

*Reforging*: same tier and rarity, but the affixes are rolled again. Sharpening
carries over — it was paid for with risk — and so does the unique property:
otherwise reforging would let you cycle legendary properties for 1300 gold,
devaluing the road to +7.

*Salvage*: turns an unwanted item into materials. The higher the tier and rarity,
the better the yield — a tier five epic gives silver and void shards.

## The story
**Twenty-four quests across two acts.** The first leads from slimes on the
forest edge to the Molten Colossus: four biomes, four bosses, the first descent
into the catacombs.

The second act begins where the first ends in victory. The Colossus turned out
to be a symptom rather than a cause: the cracks did not close, affixed monsters
grew more numerous than the guild can count, and past floor twenty-five the air
is different. The chain runs through the alchemist's samples and the guardians
of the deep — the Void Maw and the Hollow King — to floor forty-five, where it
turns out that **the Abyss is neither a place nor a beast, but a direction**.
You can always go down; the only question is who comes back.

That is what justifies the endless ladder: it has no bottom not because nobody
got round to building one, but because there is none.

Act two quests give 2.0–2.5 levels of experience each — the same weight as act
one's bosses.

**Act three: the Breach.** The Abyss was a direction downwards — and in act three
it comes out into the open. The ground east of the city has split apart, and
light comes out of it. Ten quests from level 40 to 52 lead through scouting,
pale ash and rift glass to the Breach Heart — which guards nothing and strikes
no one first: it holds the rift open.

It had to exceed everything before it in difficulty, and that difficulty is
built out of **techniques, not health**. That is a direct lesson from the work on
depth, where we already got "fights stretched out but danger did not grow". So
almost every inhabitant of the Breach demands something: the Pale Warden holds a
shield and lets 7 of 100 through on a light hit against 61 on a heavy one; the
Rift Stalker dodges 22% of blows and flies; the Rift Titan resists knockback and
carries 0.42 armour; the Pale Smith applies corrosion. And the ground itself
takes your health.

## Guild business

**Quests** are a story chain of 24, and alongside them the guild keeps a
**contract board** to choose from. The generator used to know exactly one shape
— "kill N of monster X" — and the whole endgame came down to it. There are seven
kinds now, each tied to a system that had to be built:

| Kind | What to do | Reward |
|---|---|---|
| **Hunt** | 8–16 monsters of a named kind | ×1.0 |
| **Supply** | 5–12 units of a material | ×0.9 |
| **Forge order** | craft 2–4 items | ×1.3 |
| **Depth** | descend several floors below your personal record | ×1.4 + 3% per floor |
| **Elementalist** | trigger 6–12 reactions of one kind | ×1.6 |
| **Hunter** | 3–6 affixed elite enemies | ×1.9 |
| **Head** | kill a biome boss | ×2.6 |

Kinds unlock as you meet the systems: a contract about reactions is meaningless
to someone who has never seen one, and one about depth to someone who has never
descended. At level 5 the guild only offers hunts and supply; by 14, all seven.
The same kind never appears on the board twice: three identical contracts are
not a choice.

The harder the contract, the more often it pays in an item and the better that
item is: a boss's head or a deep descent can yield a legendary.

While the story is running, a single contract hangs there and does not distract.

Saving is automatic (localStorage), plus manual from the pause menu.

## Balance

The curves were fitted from playthrough simulation, not by eye. The targets and
what came out:

| | target | actual |
|---|---|---|
| Kill a regular monster in your biome | 1.5–2.5 s | 1.6–2.3 s |
| Regular monster hits until the hero dies | 7–11 | 7–11 |
| Kills per level | 8–25 | 8–19 |
| Boss fight | 10–30 s | 9–29 s |
| Boss hits until the hero dies | 6–9 | 6–9 |

Monster health is nearly linear in level: quadratic growth outran the hero's
damage and stretched late fights threefold. A biome boss's level is pinned to
the bottom of the range rather than the top — otherwise it ended up eight levels
above the player who actually reaches it.

**An elemental build gives ×1.21 on kill speed** — measured on the same monster,
40 measurements per variant, from level 3 to 25. That is the price of two
elements occupying affix slots; reactions should not break the curve, and they
do not. Corrosion is the most reliable (×1.22–1.59 on a single target), shatter
only pays off in fights lasting three hits or more — that is, against elites and
bosses — and conduction gives nothing on a single target and lives on crowds:
264 damage across four targets, 469 across seven with the Lightning Rod. Steam
cuts an archer's shots from five to zero.

### Economy

An end-to-end measurement of income and spending from level 5 to 40 exposed
three distortions, and all three were caused by the guild contracts once they
were made varied and generous.

**A contract was worth 37 killed monsters** and gave 47–72% of all experience —
the core loop of the game became secondary, and handing in quests paid better
than fighting. The reward was cut threefold: a contract is now steadily
**12–14 monsters' worth of gold** and 34–48% of a level in experience across the
whole distance.

**Income tripled within a single level.** The board jumped from one contract to
three exactly when the story ran out, and gold at level 25 grew ×2.6 in one
step. The board now grows with level — one contract, two from 14, three from 26
— and income growth became even: ×1.17–1.47 across every stretch.

**Sharpening cost 1092 gold at any level.** `sharpenCost` counted rarity and the
number of sharpenings but never looked at the item's level, so the endgame sink
became free by level 40. The price is now tied to item level: 1747 → 3713 from
level 10 to 40.

The audit found a fourth thing: **there was not a single story quest between
levels 16 and 21** — roughly 88 kills held up by contracts alone. Coefficients
do not fix that, so act two was written: the largest gap between quests became
3 levels instead of 5, and the chain stretched from level 24 to 40.

## Layout

```
src/
  main.js            loading, canvas scaling, the game loop
  game.js            world, combat, transitions, interactions, saving
  core/              input, deterministic noise, WebAudio synthesis, saves
  art/               palettes, pixel primitives, sprites, tiles, effects, text
  world/             biomes, zone generation, the city, the dungeon
  entities/          the hero, monsters and their AI, projectiles
  systems/           items, skill runes, legendaries and sets, the forge,
                     elemental reactions, the Abyss and corruption, in-play
                     teaching, packs, dungeon modifiers, quests
  ui/                HUD, menus, widgets
```

The internal resolution is 480×270, stretched nearest-neighbour to the window.
The scale takes the largest that fits and snaps to a whole number only when a
whole number is close (within 6%): on 1920×1080 that is exactly ×4, pixel for
pixel, and on 1366×768 it is ×2.84 instead of the old ×2, where a third of the
window went to black bars. Fullscreen is an entry in the pause menu and on the
title screen; if the browser refuses the request (embedded panels do), the game
says so rather than staying silent. Sprites are assembled from primitives (a
"paper doll") and baked into offscreen canvases once at startup; changing weapon
or armour re-bakes the hero.

**The hero** is 28×36, a 29-pixel figure. The size is matched to the townsfolk:
an NPC figure is 24 pixels, so the hero is a head taller than a citizen rather
than twice their size, as in an intermediate 47-pixel version.

The silhouette is knightly: a closed helm with a grilled visor, **glowing green
eyes**, horns, spiked pauldrons, a heraldic shield in the free hand (only with
melee weapons — an archer has no use for it). The glowing eyes were not chosen
for looks: at this scale facial features do not read at all, while two bright
spots on a dark field are recognisable even when the hero is the size of a
fingernail.

The bounds were checked exhaustively: 980 baked frames (7 tiers × 7 poses ×
4 directions × 5 phases) — not one leaves the canvas.

**Sprite baking happens in ordinary memory, not in video memory.** A frame used
to be drawn on a GPU canvas and then read back from it twice — the outline and
the rim light, each with its own `getImageData`/`putImageData`. Across the
hero's 104 frames that is 208 read-backs and a **130 ms stall on every gear
change**. Now the frame is drawn straight into memory, outlined and rim-lit
there in one pass, and only the finished result goes to video memory: **15 ms**,
nine times faster. The per-frame cost did not change — 0.30–0.50 ms.

### The camera

The camera holds the hero **without lag**. The spring that used to be here felt
softer but produced a sub-pixel disagreement between sprite and background: they
rounded independently, and during steady walking the hero moved relative to the
ground in jerks of 0, 1, 2 and even −1 pixel per frame — the screen visibly
shivered.

Measured across 140 frames of walking with a varying frame time: **it was ±1 px
at random, it is now 0 in all five directions**, diagonals included. The
background meanwhile scrolls forward only, in steps of 0–1 pixel.

I tried a "catch up with a spring if far away" threshold and threw it out: at the
boundary the camera would jump fifty pixels at once — worse than the original
problem. Long-distance transfers already place the camera directly on zone entry.

The peek towards the cursor is smoothed separately and **rounded to whole
pixels** before being added to the camera position: it is the peek that should
drift, not the hero relative to the ground.

### Two layers: a pixel world, a crisp interface

The game outputs at 1920×1080. The world is drawn at 480×270 and stretched ×4
without smoothing — this is not a "small window" but a way to get an even pixel:
every point of a sprite becomes a 4×4 square.

The interface neither needs nor benefits from that coarseness: a 10-pixel font
had to be cut by an alpha threshold, which made `%` stick to the digit before it.
So menus, HUD and cards live on **a separate canvas on top**, whose buffer equals
the real screen pixels — on 1080p that is 1920×1080 one to one.

Interface coordinates deliberately **stayed the same**, 480×270. Rewriting four
hundred draw calls to new numbers would mean re-laying out everything from
scratch with a risk of breaking what works; instead the layer is stretched by a
transform. The space, though, comes not from new coordinates but from the font:
at the same height a vector glyph takes noticeably less width than a pixel
imitation with its mandatory gap between characters, and the size is reduced by
a further 0.62. The string "Continue" was 60 layout units, it is now 34 — panels
gained twice the room at the same dimensions.

Whatever stays pixel art inside the interface — item icons, runes, the minimap,
the title art — is drawn through `pixelBlit`, which turns smoothing off for the
duration. Otherwise it would be mush instead of pixels.

**The `y` coordinate still means the top of a line of height `size`.** That is
not a detail: every layout was written for the pixel font, where a `size: 10`
line occupied exactly ten units, and "centred in the button" meant
`y + (h - 10) / 2`. A vector glyph of the same nominal height occupies 6.2 — and
the label ended up 1.75 units above centre, which is seven real pixels at 1080p.
So the letter is centred inside the old box, and all four hundred places stayed
correct. Measured across thirteen labels on three screens: it was 1.75 up, it is
now 0.38 — a pixel and a half.

The numbers on the health and mana bars had the same root: there, on top of the
box, sat a hand-written "minus one" correction tuned to the pixel font, and the
line height was computed from size 8 regardless of the bar's height — on the mana
bar, two units shorter, the error was identical. Both labels drifted 1.13 units
up, four and a half real pixels. Now it is 0.25 — one pixel.

The outline on small text was also inherited from the pixel font: 0.28 of the
size. There it was drawn as a whole-pixel offset; for vector text that is too
much — on a digit five pixels tall the outline ate the shape, and "265" on the
health bar read as a dark blob. It is now 0.18.

The item tooltip now **sizes its width to its contents**. It used to be a hard
172, tuned for the pixel font; with vector text the same card became a half-empty
sheet across half the screen. That also settles the question of languages: there
is no second number to tune for English.

Measured: the frame did not get more expensive (0.55 ms in the city, the same as
before the move), every button on every screen catches the cursor, and both
languages have no untranslated strings.

**The freed space was put to use.**

- **The quest tracker** sizes its width to its contents. It used to be a hard 140,
  tuned for the pixel font where "First Blood 0/6" filled almost the whole line.
  With vector text the same label is half as wide, and the fixed number turned
  the tracker into a black slab a quarter of the screen wide for one line of text.
- **The skill belt**: the key moved from a caption under the slot into the corner
  of the slot itself, and a cooling skill shows the remaining seconds. The caption
  underneath was designed for the pixel font — size 7 was legible only because
  every glyph was a separate square. What was really missing was knowing how long
  to wait: a top-down fill shows the fraction but not the time.
- **The inventory**: next to an equipped item you can now see what it gives — you
  previously had to hover each slot in turn. The hero's totals moved under the
  grid and unfolded into six values in two columns.
- **The character sheet**: the chronicle moved to the left column under
  experience. The right one carried everything — combat, sets, chronicle — and
  **with two active sets it ran twenty-one pixels past the bottom of the panel**,
  that is, off the screen. This was hard to notice: sets are not completed before
  the middle of the game. The left column was meanwhile idle for fifty pixels at
  the bottom, and all sets are now shown rather than the first two.
- **Quests**: the list gained scrolling. It had none, and the list was cut off at
  the bottom of the panel: there are twenty-four story quests plus contracts, and
  everything that did not fit was not merely invisible — **it could not be
  selected at all**, because selection is a click on a row. Measured on a live
  save: sixteen quests, nine visible, reachable to the last; previously nothing
  past the seventh could be reached.
- **The map** grew from 268×186 to 296×208 — the legend in vector text takes a
  quarter less width. Zone scale is computed from the smaller side, so height
  matters as much as width: on a forest map that is 90×66 pixels on
  a tile instead of 2.8.
- **The shop and the forge**: the row shrank from 26 to 22, the shop grew to
  420×244. Eight goods fit on a page instead of six, and seven recipes instead of
  six — a third less scrolling.
- **Title screen buttons** are a separate "plate" with cut corners, a gradient
  fill and a gold frame. The ordinary button is deliberately plain: it is stamped
  out by the dozen in shop and forge lists, and decoration there turns into
  noise. On the title screen there are exactly three buttons, they sit on an
  expensive picture, and a plain rectangle with a hairline frame next to it
  looked like a placeholder. Width is computed from the longest label: the old
  120 was tuned for the pixel font, and with vector text the buttons swelled into
  empty slabs — almost five hundred real pixels for one word. It is now 91.
- **The health, mana and experience bars** — the same techniques for the same
  reason: a flat rectangle with a flat fill reads as a placeholder. A gradient
  instead of a flat colour (lighter at the top, darker at the bottom — the bar
  looks like a rounded tube rather than a sticker), a highlight in the upper
  third, a bright cap at the edge of the fill (without it the boundary looks like
  a cliff, with it like the edge of a liquid, and the eye finds the value at
  once), notches every 25% and a frame in muted gold, the same as on the buttons.
  The thin experience bar has no notches — there they would be litter.

  Gradients and shades are **cached**. There are only a handful of bars on screen
  and they sit in fixed places, but creating a gradient anew every frame together
  with parsing hex in `shade` was expensive: the frame in the city rose from 0.55
  to 0.78 ms. With the cache, 0.57 — the decoration cost two hundredths of a
  millisecond.
- **The skill panel** was six separate squares and did not look like a set. Now
  they share a backing plate, and the panel reads as one thing — a belt with
  sockets. The sockets are "sunken": the plate's gradient is lighter at the top,
  the socket's is lighter at the bottom, and that opposing stretch makes the
  socket look like a recess rather than a sticker on top. When mana is short the
  frame's gold turns red. A cooling skill gained a bright edge along the fill
  boundary — you can see the cooldown is running rather than stuck.

  **Only what is actually slotted appears on the belt.** Rune sockets used to be
  drawn always — all three, filled and empty. Before the first rune the belt was
  half empty, and after that it showed exactly what the player does not have yet:
  two dark squares lettered R and G, promising a skill that does not exist. Empty
  sockets are no longer drawn, the belt shrinks to its contents (from three
  sockets to six) and stays centred. Where to put runes is explained by the hint
  on the first rune drop and by the Inventory tab, where the F/R/G slots are
  always visible — there is no reason to keep holes over the game for that.

  Attack, dash and potion stay on the belt always: they are not equipment but
  what the hero has from the first minute. The potion socket does not disappear
  at zero either — the counter turns red: were it to vanish mid-fight, the very
  news "out of potions" would vanish with it, and the belt would jump under your
  hand.

  **Equipment is the second tier of the same belt.** It did not fit in one row:
  the minimap occupies x 404…472 on the right at the same height, and six skills
  plus six items in a row is 329 units — the panel's edge would run into it.
  There is unlimited room upwards, so the items went on a tier above the skills,
  and the belt kept its width (202 units at most against the minimap's 404).

  The tiers differ in meaning and therefore in look: the lower has 28-unit
  sockets and a key label — you press those; the upper has 20 and no labels — you
  look at those. A gold thread runs between them. Items are drawn with the same
  `itemSlot` as the inventory, so rarity, the corners on epics, the set mark and
  the sharpening level are visible right in combat without opening the journal.
  There are no empty sockets here either: the row is assembled from what is worn,
  and when nothing is worn it disappears entirely and the belt collapses back to
  one tier.

  The belt grew from 40 units to 64, and everything that hugged the bottom of the
  screen now measures from its top edge (`hud.beltTop`) rather than from the
  screen edge: the action prompt and the toasts would have gone underneath it.
  That also removed an old overlap — the "E — talk" panel had been three pixels
  over the belt even before this change.

- **The quest tracker** got the same backing plate and, in addition, **a shadow**.
  HUD panels lie directly on the world rather than on a dimmed background, and
  without a shadow a panel reads as a hole in the picture rather than an object on
  top of it. Under the heading runs a gold thread with dissolving ends: a solid
  line would read as a table separator, this one reads as trim. On the left of
  each row is a state diamond — the same sign as in the quest journal, so nobody
  has to memorise two.

- **The minimap** is clipped along the same bevel as its frame: otherwise a
  square corner of the image would poke out at the chamfer. Towards the edges the
  map fades with a vignette instead of being cut off by the frame like a knife
  (measured along a row: 88 in the centre, 61 at the edge). The zone name moved
  from a caption floating in the air onto a tab over the top edge — which also
  freed a line, and the map grew from 62 to 68.

  **The hero on it is no longer a dot but an arrow pointing where he looks.** A
  dot only says "you are here"; an arrow also answers "which way are you facing"
  — on a minimap that is half the value, because people navigate by it without
  looking at the world. Objective markers became diamonds with a dark outline
  (legible on any map), and the boss has a pulsing halo.

- **The journal map**: the frame now fits the map rather than the other way
  round. The space for the map used to be a 296×208 rectangle, the zone was fitted
  into it by its smaller side — and black bars were left at the sides. In the city
  that is a dozen and a half pixels on each side, in the dungeon fourteen. Now it
  computes how much the map will actually take and draws the frame exactly around
  it: no bars for any zone shape, and the same scale. Plus a vignette, draughtsman's
  corners, diamonds in the legend instead of little squares, and the same hero
  arrow as on the minimap — one sign in two places does not make you learn two.

- **The inventory** was rebuilt entirely — from the item icon to the summary at
  the bottom.

  **The icon grew from 16 pixels to 20.** The reason is not beauty for its own
  sake: a bag cell is 26×26, and a sixteen-pixel picture drowned in it with a
  five-pixel margin all round. Twenty is one and a half times the area, and it
  finally fits what there was no room for: the taper of a blade, the facets of a
  gem, the wrapping on a hilt, the chamfer on a cuirass. The light in every icon
  comes from one place — top left; when one item has its highlight on the left and
  its neighbour on the right, the grid starts to shimmer and items stop being
  distinguishable by silhouette. In small cells (shop, forge) the icon shrinks to
  15 units — exactly three times the icon's pixel on the interface layer; any
  other size would give pixels of differing width.

  **The cell became a socket.** A flat fill with a one-pixel frame read as a table
  cell: items lay "on paper". Now there is a dark edge on top and a light one
  below — the item is inside, not on top. Under the icon is a contact shadow:
  without it the item hangs in the air, and no frame fixes that. Rarity carries
  three signs at once — the frame colour, a glow from within, and corners on epics
  and legendaries: blue from purple on a dark background cannot be told apart in
  passing, whereas "has corners / has none" is visible in peripheral vision
  without reading.

  **Equipment rows** got plates with a rarity edge on the left — the list reads by
  its coloured edge from top to bottom without parsing letters. The slot name
  moved right in small caps and freed the line for stats. **The bag** sits in a
  recess (`recess` — the reverse of `hudPlate`: shadow on top instead of light, so
  the grid looks set into the panel rather than glued onto it). **"Totals"** sits
  on a plate with a gold thread, with power on a separate tab: it is the single
  number by which two loadouts are compared as a whole, and in a common column it
  was lost between "crit chance" and "damage reduction". Leader dots run to the
  numbers so the eye does not lose the row.

- **The shop, the forge and the other screens** were brought to the same look —
  but not one by one: through three shared building blocks. Twelve lists drew
  their own background: a `fillRect` at three per cent white and a strip on the
  left. The same code in twelve places — and, worse, a slightly different look in
  each.

  - **`listRow`** — a list row: a bevel, an opposing gradient, an edge on the left
    and a gold frame on hover. The edge carries either rarity or state:
    in crafting, grey means "too early by level", green "you have everything",
    red "something is missing". It is now used by the shop, all four forge tabs,
    rune fusing, quests, notes, reactions, hero stats, the travel picker and the
    equipment list in the inventory.
  - **`segTabs`** — a section switcher: segments in a sunken track, the active one
    raised and lit in gold. The shop tabs used to be the same buttons as "Buy" in
    a goods row, and it did not read that one turns a page while the other spends
    gold.
  - **`valueTab`** — a tab for a number: gold in the shop, price in a row, power
    in the inventory, the reward on a door. The red variant means you are short.

  Along the way: `plateButton` learned `disabled` and `danger` (plates replaced
  plain buttons in dialogues, at the altar and in confirmations — those have both
  unavailable answers and irreversible actions); empty lists gained a proper
  state with a "what to do" hint instead of a grey line in the middle of nowhere;
  conversation got a shadow and a portrait in a recess; the death screen got a
  full-width band instead of text floating in space; the descent doors got plates
  framed by the price of the risk; and the altar got two equal scale pans instead
  of two lines one after another.

  One collision showed up immediately: the panel's title tab occupies `py-6…py+6`,
  and the new tab rows ran into it — the rows moved lower, and the forge now has
  three tiers of them (section → category → weapon type).

The bevel on buttons, bars, sockets, panels and both maps is one and the same
(`bevelPath`): repeating a single detail ties different parts of the interface
together more strongly than a shared colour. Gradients all go through one cache
(`vgrad`) — otherwise every newly decorated panel would add its own tenth of a
millisecond to the frame.

### Signing in with a wallet

The title screen gained a Phantom sign-in. What happens: the page asks the
extension for a public key and asks it to sign **a text**; the extension shows
that text to the player in its own window and signs it with a private key that
never leaves the wallet. The game receives the public key and the signature —
and only those.

What does not happen: the game **never** asks for a seed phrase, never requests
the private key and never calls `signTransaction`. Signing in is signing a text,
not transferring funds. The signed message is deliberately readable: domain,
purpose, a nonce, a timestamp. Signing "some incomprehensible bytes" is the worst
habit you can teach a player, because that is exactly how funds get taken.

**What this is not yet.** A signature only means something when a server verifies
it: ed25519 against the public key and a nonce the server itself issued. There
was no server yet, the nonce was born on the client and nobody verified the
signature — so it was a convenient way to name yourself, not a proof: anyone can
fake the wallet's answer from the console. The places that must move to the
server are marked in the code with a `СЕРВЕР` note.

Guest sign-in was kept deliberately. Without it the game would stop starting for
everyone without the extension — and that is most of the people who open the link
for the first time.

Three outcomes are handled by meaning as well: no wallet — offer to install it;
the player cancelled the signature — that is not an error and must not look like
a failure; everything else — a real failure with a clear line of text. A sign-in
survives a page reload for a week, after which we ask again.

### Movement over the network: how prediction converged

The client moves the hero immediately without waiting for the server, then
reconciles. At first reconciliation triggered on a third of all inputs with
divergence up to 26 pixels — the hero jittered. Working it out took three
attempts, and each was instructive.

**First suspicion: the server does not know the hero.** The room held a stub with
a hard-coded speed of 64.25 and a hundred health — for a level 35 hero that is
untrue. The server learned to raise a real `Player` from the database with the
same `fromJSON` the client uses (for which `reviveItem` moved out of `game.js`
into `systems/items.js` — it is a rule about items, and it belongs next to
items). The divergence **did not change**: 33%, 26 px. The stats had nothing to
do with it.

**The real cause: different integration rates.** The step formula is identical,
but the client runs it sixty times a second and the server twenty. Step-by-step
integration with different step sizes gives different coordinates — always. Now
the client sends **the steps themselves** together with their `dt`, and the
server replays them: both sides compute one sequence rather than one formula at
different rates.

Result: **26 px → 3.3 px**, and at rest the two sides differ by 0.7 pixels — that
is the snapshot rounding to tenths.

**A side effect: a hole in the defences.** Once the client sends time, it can
send as much of it as it likes. The first version of the limit granted an
allowance per message — and a check showed that a speed hack got through at two
and a half times: 153 pixels per second instead of 64. Replaced with a time
bucket: the budget accrues on the real clock, is spent in steps, and is capped at
a quarter of a second for network jitter. Three fake clients with different rates
and step lengths all get the same 57 px/s as an honest one.

**And twice I fooled myself with the measurement.** First I ran `update` in a
loop with five-millisecond pauses — the game ran three times faster than real
time, the server rightly cut the excess, and the defence looked like broken
prediction. Then I called `update` on top of the page's own running loop — the
game ran twice as fast. Honest numbers only come out when the game is driven by
its own loop and the measurement merely watches from the side.

### Water

The pond looked like a puddle of paint, and my first thought was that the water
was not animated at all. That was wrong: `drawLiquidShimmer` exists and is
called — the glints run, the glow pulses. Something else was missing.

- **Depth.** The water was one colour everywhere, in the shallows and in the
  middle. Now tiles whose four neighbours are all water darken. The pond gained a
  bottom, and the bank gained shallows.
- **Foam on every shore.** The surf strip ran only where land was above; on three
  sides out of four the pond ended in nothing. The edge is what the eye reads to
  find where the water stops.

The foam had to be redone twice. A solid strip along the whole tile joined up
with its neighbours into a continuous contour, and the pond got an outline: not a
shore but a stepped rectangle around the water. Now each side carries two short
strokes with their own phase — the edge breaks up and reads as surf rather than
as a frame.

It cost nothing: there are around three hundred liquid tiles in a zone, and the
frame at the water is 1.06 ms.

### Shadows: why the world looked flat

The complaint "objects are not standing on the ground, they are stuck to it" is
checked with a number, not by eye. The method: render the same frame twice — with
shadows and with `sun.a = 0` — and subtract one from the other. That shows
exactly what the shadow contributes, with no grass, ground or anything else mixed
in.

It turned out: **the directional shadow touched 4.1% of the frame and darkened it
by 6%.** The shadow was there, but it could not be seen.

Fixed with three changes: the shadow is longer and denser (`a` 0.26 → 0.40); it
gained a soft edge — the silhouette is drawn twice, wider and paler plus the main
one, because a sharply cut shadow reads as cut from paper while a canvas blur is
expensive; and large objects get a shading patch laid under their footprint. The
last matters most for trees: a sprite has its own baked shadow, but for a canopy
66 pixels wide that is an 18-pixel smear — right for a blade of grass, not for a
tree.

Now: **9.6% of the frame, 7.7% darkening, the darkest point −116 instead of −54.**
The price is 0.35 ms per frame out of the 16.7 available.

### Light: the dapples that had to be moved twice

The second half of the idea was sun dapples through the canopy — an evenly lit
clearing looks as if nothing grows above it. The first attempt was **rolled
back**: tiling noise over the whole screen produces a visible grid of repeats —
across 480 pixels of width a 128-pixel tile fits four times, and the eye catches
the lattice instantly (on water it read as rectangles). The gain was meanwhile
tiny: the brightness spread across the frame grew by 5%. Trading a visible grid
for five per cent is a bad deal.

It was done differently: the dapples are built **from the canopies themselves**
and live in world coordinates. There is nothing to repeat — no tile, no screen
grid. The spread comes from a hash of the index rather than from `Math.random`:
the zone sits in a cache and is redrawn thousands of times, and the dapples must
not jump.

The second attempt had to be redone too. At first the patch was placed exactly in
the canopy's shadow — physically correct: light comes from the side, and
everything that gets through the leaves falls where the shadow fell. Measurement
said this does not work: **1.8% of the frame, brightness spread 37.06 → 36.99**,
that is, nothing. In this camera the canopy's shadow is covered by the tree
sprites themselves, and the patch landed underneath them. The player sees the
ground **between** canopies and in front of them — the light must fall there. The
spread was widened to nearly the whole canopy and shifted down the screen,
towards the camera.

A soft bell read as a blur — "somewhat lighter over there". A patch of light
needs an edge: sun through leaves gives a blot, not a mist. The gradient's core
holds to 0.82 of the radius and only then falls off; after that the average
brightness gain rose from 15 to 24 and the brightest point from 79 to 121.

The dapples creep along with the canopy: the gaps in the leaves are moved by the
same wind field that sways the tree itself — otherwise the light stands still
while the tree moves.

| biome | strength | dapples per zone | frame touched | average gain |
|---|---|---|---|---|
| forest | 1.0 | 1347 | 3.7% | +24.9 |
| ridge | 0.5 | 1582 | 9.3% | +12.6 |
| mire | 0.7 | 1598 | 4.9% | +13.9 |
| waste | 0.3 | 916 | 3.1% | +6.1 |
| city | 0.55 | 36 | 0.5% | +16.5 |
| dungeon | 0 | 0 | 0% | — |

The ridge stands out by area: the pines are taller and denser and the snow is
open — there it reads as winter sun rather than dirt. In the city there are
hardly any trees, and 36 dapples is an honest reflection of that rather than an
oversight.

About 9% of the dapples landed on water or in walls — cut at construction time:
water has its own glints (`drawLiquidShimmer`), and a warm blot over the blue
reads as a bug. The frame did not change: median 2.3 ms, worst 5% at 2.6.

### Aerial haze: the distance that was not there

In a top-down projection the screen `y` **is** the distance to the camera: the
top of the frame is further than the bottom. So there ought to be a cue for
distance, and it can be checked without writing a line. Saturation measured
across six bands from top to bottom:

    0.513   0.474   0.472   0.515   0.517   0.512

Flat. The difference in contrast (23.9 at the top against 34.9 at the bottom)
came entirely from the vignette, not from depth. There was no distance cue in the
frame at all.

The haze lightens and desaturates the top of the frame — ordinary alpha blending
towards its own colour, from a cached gradient. It is attached to the screen
rather than the world, and that is not an arbitrary overlay: screen `y` is the
distance, so the haze rides across the world with the camera exactly as it
should. It goes **before** the vignette: haze is about distance, the vignette is
about the frame.

    was   0.644   0.618   0.584   0.541   0.460   0.475
    now   0.551   0.593   0.584   0.541   0.460   0.475

The first variant reached to the middle of the screen (`reach` 0.46) and looked
better — but the hero stands in the centre, and the band caught him and
everything he was fighting. Desaturating the combatants for the sake of distance
is a bad deal; it was pulled back to 0.32, and the haze now lives above the line
of battle rather than inside it. The numbers show it too: only the top two bands
out of six are touched.

Density differs per biome: ridge 0.20 (frost haze), mire 0.18 (murk), waste 0.17
(shimmer over hot ground), forest 0.13, city 0.09, dungeon — none at all, there
are no distances underground. It costs zero: one ready-made blit, a 2.4 ms frame
with the haze and without it.

### The ground: 4% of detail and zero on the roads

"The ground is empty" is also a complaint to be counted rather than settled by
eye. Measured with the headless build: small flat objects (grass blades, pebbles,
cracks) covered **4% of walkable tiles**, and out of 577 road tiles — **not one**.

The cause turned out to be one rule applied more widely than it should have been.
When scattering objects, the generator skipped a road tile and everything
adjacent to it. The rule is right — but only for things that block the way: a tree
in the middle of a path is a dead end. Flat detail blocks nothing, and the ban
stripped the roads of all texture. "Next to a road" now suppresses only large
objects, while small ones and grass get their own roll.

The first attempt produced 29% and **was overdone**: the hero began getting lost
in the litter, and the road stopped reading as a road. Empty ground is a problem,
but an indistinguishable road is worse: the player navigates by it. Trimmed to
**19% on ground and 7% on roads**: 744 small objects per zone, 1189 objects in
total against 671 before the change. The frame in the forest: median 2.4 ms,
worst 5% at 2.9 out of the 16.7 available.

### Wind: 213 canopies swaying out of step

The canopies swayed before too — `p.sway` was there from the start, and its
amplitude is honest: the treetop shifts around 7.6 screen pixels. (You cannot
judge this from a still frame at all — I first decided the forest was motionless
and was wrong.)

The trouble was coherence. Every tree swayed from its own sine with a random
phase and a period between 2.7 and 12.3 seconds. Measured: neighbouring canopies
— those within 64 pixels, which should lean together — matched in lean direction
**50% of the time**. Exactly a coin flip. Together it read not as wind but as
jelly.

[`src/art/wind.js`](src/art/wind.js) replaces the individual sines with one field
across the whole world: a wave of gusts runs diagonally over the map, a slow
envelope sits on top (the wind drops and rises), and only a fifth of the amplitude
is left to an individual phase — without it the formation looks mechanical. The
field's amplitude is the same, so the sway did not change: only the coherence did.

| distance between canopies | 0–64 | 64–140 | 140–240 | 240–400 | 400–700 |
|---|---|---|---|---|---|
| leaning the same way | 92% | 87% | 79% | 70% | 45% |

The right-hand column matters as much as the left: past 400 pixels the match
falls to chance. The wave travels through the forest rather than rocking it as
one block.

The envelope's floor had to be raised from 0.10 to 0.24: at 0.10 the measurement
showed lulls of several seconds where the forest nearly freezes — which reads not
as calm weather but as broken animation.

Wind strength differs per biome: ridge 1.35, forest 1.0, waste 0.9, city 0.7
(sheltered by walls), mire 0.45 (the air stands still), dungeon 0. The frame did
not change at all — three sines per object are lost in measurement noise.

### The combat audit

The zone and content audits answered "where can you walk" and "is there anything
worth walking to". About what the player does all the time we knew nothing in
numbers. [`tools/combat-audit.js`](tools/combat-audit.js) measures combat with
**the game's real code**: `resolveHit`, `swingHits`, the hero's getters, the
enemy's `scaleStats`, `Player.takeDamage`. Not one formula in it is duplicated.

To make that possible, **the rule itself** was lifted out of `Game.damageEnemy` —
`resolveHit` in [`systems/combat.js`](src/systems/combat.js). There used to be a
comment there explaining why the damage calculation was absent: I once wrote it
from memory, a comparison showed it disagreed with the game on every point, and
the conclusion was not to rewrite it again but to split the real one into rule
and spectacle. That is now done, and the stand computes exactly what the game
does.

**The first run lied.** Half the game reported "the target does not die in 300
seconds". The cause was in the stand: `facing` on a fresh hero is π/2 — looking
down — and I placed the target to the right, so the swing arc did not catch it.
On small enemies only the third blow of the combo connected (its spread is
wider), on large ones none did. The numbers were about my mistake. That is the
third time in this project that the stand lied more convincingly than the code
would have.

What was found after the fix — and what mattered:

**The weapons were described twice, and the descriptions disagreed.** `items.js`
holds `WEAPON_PROFILE` (axe: damage ×1.28, rate ×0.80; dagger: ×0.72 and ×1.45 —
by design that is parity, 1.02 against 1.04). But rate and range were taken from
separate tables in `Player` that did not match the profile: the axe's real rate
was 0.705 instead of 0.80, the dagger's 1.605 instead of 1.45. Both errors pulled
the same way, and the dagger hit 1.7–1.9 times harder than the axe.

`attackRate` and `attackRange` are now computed from the profile — there is
nothing left to disagree. The intended ranges came back along the way: bow 29 and
staff 27 instead of an identical 24.

| level | was (dagger / worst melee) | now |
|---|---|---|
| 8 | ×1.89 | ×1.66 |
| 20 | ×1.47 | ×1.24 |
| 34 | ×1.78 | ×1.48 |

The remainder is honestly not closed and stays in the report: weapon damage is
roughly half of the hero's attack, so the profile's damage multiplier is diluted
by half while the speed multiplier applies to the whole attack. Speed is
therefore always slightly better than damage. Removing that entirely means
changing how a weapon enters the attack — and that is visible to the player in
the item's numbers, so it cannot be decided in a hurry.

**The Mire Witch was not an elite.** She had `hp: 1.2` — less than a regular
bogling (1.3) from the same biome. The elite died alongside it, in the same five
hits. The other elites hold 2.2–3.4. Set to 2.1: the most fragile of the elites,
but an elite nonetheless.

**Two thresholds I set out of thin air, and they lied.** "A slime dies in 0.4 s"
and "the first boss is shorter than 12 s" are not breakages but intent: a slime
at level one is the first kill in the game, and five swings there would read as
sticking. The thresholds were rewritten with a justification: there is no lower
bound for the first biome at all, and bosses are checked not by absolute time but
by each fight being longer than the previous one (10.4 → 14.3 → 19.5 → 26.3 s —
it rises).

What turned out to be fine: bosses hold an even curve; shield bearers let 26–33%
of damage through from the front over a combo cycle (the third blow is heavy and
weakens the shield), and everything from behind — so a shield is solved by
flanking rather than by patience; regular monsters kill the hero in 8–21 hits and
grow more dangerous with level.

### Skills: 370% on one and 28% on another

So that the stand could run each skill's real `run()`, the delivery shapes were
lifted out of `Game` as well: `aoeTargets`, `lineTargets`, `hazardTargets`,
`skillRoll`, `boltSpec`. Each for the same reason as the damage rule. A hazard
zone, for instance, measures a target's height as `e.r * 0.4` while a circle uses
`0.5`; a copy would diverge on exactly that kind of detail. In `boltSpec` I would
have had to copy `heavy` (the projectile ignores armour), `pierce` and `effect` —
let any one of them drift and the stand would be measuring a different
projectile.

**The first assessment had to be thrown away entirely.** I compared a skill's
damage per second against a normal attack's and got "seven skills are weaker than
a normal attack". The assessment was measuring the wrong thing. A skill does not
replace swings, it **adds** to them: the hero swings all the time. And judging an
area skill by a single target is as unfair as judging chill by its damage bonus —
the same mistake I made a paragraph earlier, with the marks. The measure was
rewritten as "contribution": how much a skill adds beyond what swings alone would
have dealt during its cooldown, taken at the skill's best case. The stand now
measures control (stuns, marks) too — from the target's state after the cast
rather than from the description.

With an honest measure exactly one outlier appeared: **wall of fire gave a 370%
contribution** — twice the next skill and the highest on a single target. The
cause is volume: five tiles × 5 seconds × two ticks per second = fifty hits from
one press. `mag` 0.5 → 0.2 puts it level with poison cloud (148% against 143%) —
its direct relative: the same idea of a zone, the same size of contribution.

The spread across all thirteen skills became 28–177%, and the bottom is occupied
by three control skills (chain lightning, concussion, frost nova) — they trade
damage for stuns and marks deliberately. The complaint "it only holds up on
control" I **removed** from the stand: it described the intent, not a breakage.

Checked in the live game too, all three delivery paths: whirlwind 310 damage,
arcane volley 600 (projectiles spent), wall of fire 525 over 2.6 seconds and
still burning. Along the way the stand lied twice through my own fault — the hero
died under the targets, the death screen set `menus.blocking`, and the world
stopped; damage read zero while projectiles were alive. The zero was about the
pause, not about the game.

### Music: the beat, the loop and the tension

All sound in the game is synthesised in code — there are no files. Music existed:
seven themes,
a sequencer with a chord bed, bass, arpeggio and percussion. Measurement found
three problems in it, each with a number.

**The beat was counted in frames.** `this._timer -= dt` — as much as the frame
managed, that much musical time had passed. Measured against the audio clock: the
beat drifted **7.4 ms at the median and up to 17.4** on a 190 ms step. Four per
cent at the median is audible as unevenness, and on a frame stall the beat simply
slid. The sequencer now schedules notes **ahead against `ctx.currentTime`**, and
the frame only asks what has come due. The drift became **exactly 0 ms**.

**The loop lasted 8–17 seconds.** Four chords of sixteen beats. The forest
repeated forty-nine times in ten minutes, the boss theme seventy-two — and a boss
fight lasts 15–39 seconds: the same thing several times per fight.

Two changes. The progressions were doubled in length — the second half moves to
relative degrees and comes back. And the arpeggio is now indexed by an
**absolute** beat number rather than by position in the bar: `arp[beat % len]`
used to restart the figure every bar, so its length affected nothing. Take a
length that is not a multiple of sixteen and you get a shift — the figure only
coincides with itself again at the least common multiple.

| theme | was | now |
|---|---|---|
| city | 10.9 s | 326 s |
| forest | 12.2 s | 122 s |
| mire | 14.7 s | 206 s |
| ridge | 13.4 s | 242 s |
| waste | 9.9 s | 694 s |
| dungeon | 16.6 s | 233 s |
| boss | 8.3 s | 1281 s |

An honest caveat: that is the length of a **full** coincidence. The harmony still
goes round in eight bars — 21.8 seconds in the forest. What does not repeat is
the combination, and it is the combination that creates the sense of a loop. The
player will now never hear the boss theme the same way twice in any fight.

**The music heard nothing.** The same loop played in an empty city, under three
goblins, and on a boss. Tension 0..1 was added: the game counts woken enemies
within 190 pixels (a boss goes straight to maximum), and the music mixes in a
pulse on the beat and a counter-voice an octave lower. Not volume but density:
louder does not mean more anxious; more anxious is when the music runs out of
room.

Tension moves slowly, about a second for the full range: music that twitches with
every goblin running past sounds broken. Measured live: calm 0 → three regulars
0.48 → plus a boss 1.0 → after the fight, down to zero in three seconds.

**Changing theme was a cut.** Measured: bus volume 0.34 before the change, 0.34
during and 0.34 after — there was no fade at all, `setTargetAtTime` to the same
value does nothing. Themes trod on each other: for **0.14 seconds** both placed
notes inside the lookahead window, and the old bed holds for `stepTime × 15` — up
to three seconds — so the forest chord rang under the boss theme in a foreign key.

Now the bus goes to zero, the theme changes in silence, and it comes back. Old
notes finish under the fade — that is more honest than cutting them mid-way.

    volume    0.34 ──▼── 0 over 0.3 s ──▲── 0.34 over 1.5 s
    overlap   0.14 s → 0.03 s, and it falls at zero volume

A boss cuts the biome theme quickly — it is meant to interrupt — and raises its
own over a second and a half, exactly under the roar and the screen shake:
entering at full volume sounded like switching radio stations rather than an
approaching threat. On the way back after victory it takes its time, 1.6 seconds:
the fight is over, the world returns rather than switches on.

### The frame profiler

I measured the frame by hand about five times during this work, and **twice it
lied**: once I ran `update` with my own pauses and the game went three times
faster than real time, another time I called `update` on top of the page's
running loop and it went twice as fast. Both times the numbers looked convincing.

[`core/profiler.js`](src/core/profiler.js) is built on one rule: **it moves
nothing and calls nobody**. The real `loop` tells it where the frame boundaries
are, and the sections are marked directly in `draw`. Remove the profiler and the
game runs exactly the same. F3 or the backtick toggles the panel.

A 240-frame ring — four seconds. Median and worst 5%, not the average: an average
over frames is useless, a rare stall dissolves in it, and it is precisely the
stall the player notices. A separate line shows the **gap between frames**:
garbage collection and browser work happen between calls, and measuring only
inside the frame will not see them.

The very first run showed things I did not know:

| | median | p95 | max |
|---|---|---|---|
| frame | 2.50 | 2.90 | 3.10 |
| · update | 0.00 | 0.20 | 0.30 |
| · draw | 2.40 | 2.80 | 3.10 |
| gap between | 14.20 | 14.60 | 15.40 |

    light      1.06     ← 42% of the frame
    objects    0.57
    interface  0.30
    ground     0.17
    effects    0.00

**The whole simulation is zero.** Monsters, projectiles, zones and collision cost
nothing measurable; the frame goes entirely to drawing. And inside drawing,
almost half is eaten by **light** — more than fifteen hundred objects put
together. I knew neither of those two facts, despite measuring the frame all day.

### A sprite atlas: checked and rejected

I proposed replacing a hundred and fifty canvases with an atlas myself — and
checked it myself before doing it. In the thick of the forest: **826 `drawImage`
calls per frame from 178 different sources, but they take 0.74 ms out of 2.6** —
28% of the frame, and the frame is 15% of the budget. Even drawing twice as fast
would win 0.35 ms out of 16.7.

A large rewrite for two per cent of the budget is a bad deal. Proposal withdrawn.

### The forge, the runes and the elements found their own voice

Twenty-two effects for the whole game — and some events borrowed others'. The
list of substitutions, gathered from every call site:

| event | sounded like |
|---|---|
| crafting | a purchase in the shop |
| salvaging an item | opening a chest |
| reforging | a level up |
| reforging | a level up |
| fusing runes | a level up |
| a sharpening succeeded | a level up |
| a sharpening failed | **the hero took damage** |
| a weapon shattered | **an enemy died** |
| five elemental reactions | three borrowed sounds between them |

The last two substitutions are worse than the rest: the player heard "I was hit"
when a sharpening failed, and "somebody died" when their own weapon shattered.

Nine sounds were added: `forge` (a hammer on an anvil), `sharpen` (a whetstone),
`sharpenFail`, `shatterItem`, `salvage`, `fuse`, `acid`, `steam`. Crafting and
reforging share one — both are the smith's work, and separating them would be
contrived.

**What I cannot check: how they sound.** I have no way to hear them, and no
measurement replaces that. What can be checked is whether the player will **tell
them apart**. The first two attempts at a metric were useless: cosine similarity
over raw spectra put every pair between 0.90 and 1.00, and after a logarithm it
returned `ui / uiBig` = 0.99 — which are obviously different things by ear. The
reason is that the window is 1.2 seconds while the sounds last 0.1–0.3, and the
silence in the tail makes everything short look related.

So instead of a dubious similarity number, three descriptive traits, each of
which we can defend:

| sound | duration | spectral centre | movement |
|---|---|---|---|
| forge (was buy) | 0.44 s (0.14) | 629 → 1816 (1094 → 1188) | up (flat) |
| salvage (was chest) | 0.30 s (0.43) | 588 → 3540 (1881 → 880) | up (down) |
| sharpen (was level) | 0.63 s (0.50) | 1246 → 2287 (521 → 1125) | up, twice as bright |
| sharpenFail (was hurt) | 0.31 s (0.10) | 1576 → 270 (432 → 413) | down (flat) |
| shatterItem (was die) | 0.37 s (0.22) | 1145 → 2084 (495 → 444) | up (flat) |
| fuse (was level) | 0.56 s (0.50) | 637 → 909 (521 → 1125) | a rise of 1.4 against 2.2 |

Seven of eight are clearly distinct from their predecessors. `fuse` is the
closest: the same shape as `level`. I rewrote it (the first version ended in a
rise and came out almost a fanfare; now two tones converge on one and fade
downwards), but I did not tune it further: my three-number measure cannot see
that `level` is a four-note arpeggio while `fuse` is two sliding tones. Tuning
code to a blind metric is worse than honestly saying where the metric is blind.

### Mixing: the game sounded four times quieter than it could

I assumed combat effects were hitting the ceiling and clipping. An analyser
measurement refuted half the guess and confirmed the other:

| | output peak | frames clipping | effects RMS | music RMS |
|---|---|---|---|---|
| silence | 0.04 | 0 | — | 0.005 |
| thick of a fight | 0.26 | 0 of 176 | 0.054 | 0.006 |

**There is no clipping at all**, and a peak of 0.26 against an available 1.0
means the game sounded four times quieter than it could. It also turned out that
an old note in the code — "at 1.0 the synthesis starts clipping on hit peaks" —
is not supported by the numbers. What was supported is masking: **effects are
nine times louder than music**, and in a fight the music simply cannot be heard.

Raising the level directly would have been wrong — a rare volley of five
simultaneous hits would immediately hit the ceiling. So compression appeared on
the output (threshold −16 dB, 4:1, 4 ms attack), and the bus levels were raised
to meet it. Result: **RMS 0.049 → 0.110, peak 0.26 → 0.54, still zero clipping.**

The effects-to-music ratio moved from 9.0 to 7.0 — better, but there is no
correct answer here: some people want the ring of hits, others the music. So
instead of a balance I picked myself, settings gained **three sliders** —
master, music, effects — remembered along with the rest of the settings. The
panel had to be tightened: the layout is only 270 pixels tall, so buttons shrank
from 20 to 18.

The effects slider had to be checked by sound rather than by code: `gain.value`
on that bus does not reflect automation — you read the old value, and the first
measurement said the knob "does not work". By the output everything is honest:
0.20 → RMS 0.015, 1.00 → 0.079, a ratio of 5.3 against an expected 5.0. The
measurement lied, not the game — the fourth time during this work.

### Bosses twice as strong

The measure here is neither health nor damage separately but the **damage
budget**: how many health bars the hero will take over a fight if he stands and
trades blows. It is the only number in which both sides of strength meet.

Doubling both health and damage would have been **four times** by that count —
and would have repeated the mistake already recorded in
[`abyss.js`](src/systems/abyss.js): "it was not breaking, it was sagging — fights
stretched out but danger did not grow". The Colossus would have become a
46-second slog that kills in three hits. So health ×1.45, damage ×1.40: the fight
is exactly twice as dangerous and less than half again as long.

| boss | fight | hits until the hero dies | budget |
|---|---|---|---|
| Rootgrave the Treant | 8.8 → 12.3 s | 9 → 7 | 0.9 → 1.7 bars (×1.92) |
| The Silt Hag | 11.4 → 16.2 s | 8 → 6 | 1.6 → 3.2 (×2.00) |
| Warden of the Frost | 16.5 → 24.6 s | 7 → 5 | 2.5 → 5.2 (×2.07) |
| The Molten Colossus | 23.1 → 32.9 s | 6 → 5 | 3.9 → 7.7 (×1.98) |

All nine bosses were raised, including the Abyss rotation: leaving them as they
were would have made the endgame guardians weaker than the biome ones.

The curve stayed rising — 15.4 → 20.9 → 27.9 → 38.9 seconds in "rare" gear, the
very gear the player arrives in under the new rarity caps. The first fight was
checked separately: the Treant hits for 56 against a hero bar of 205, that is,
six hits to death instead of nine. Dodging is now required rather than optional.

### The Breach: difficulty from the terrain, not from health

Act three had to exceed everything before it. The simplest way to do that is to
multiply monster health, and it is also the worst: we already have it on record
how that ended at depth — "fights stretched out but danger did not grow". So the
Breach builds its difficulty out of two things that did not exist before.

**The first is the ground.** Void vents breathe near the rifts: 16 permanent
zones per zone, tied to liquid tiles. While you stand inside you lose health and
move 38% slower; a step outside stops the damage at once, and a dash carries you
through for free.

The damage is computed as a **fraction of maximum** rather than a flat number,
and that is not cosmetic. A flat 8 per second is 3.3% of health at level 8 and
0.8% at level 46: the danger would vanish exactly where it was intended, because
the hero gains health from gear. The void does not care what you are wearing —
3.5% per tick. Measured on a live hero: 21% of health for three seconds of
standing, meaning you cannot fight inside a vent but you can cross one.

The damage goes the same route as burning rather than through `takeDamage`. That
one grants 0.42 s of
invulnerability — a permanent vent would become **cover**: you stand in the acid
of the void and take half as much in the face from the monsters. It also knocks
you away from the source, so it would push you out of the zone by itself, and the
decision "leave or endure" would stop being the player's decision.

The edge of the zone had to be redone by measurement. The first version drew a
soft cloud with a ring, and scanning a row of pixels through the centre showed
why it did not read: **the inside was brighter than its own edge** — 226 against
190. The zone looked like a blot with no boundary, and the player learns the
radius only by losing health. The fill was dimmed threefold, the ring
strengthened and doubled with a dark contour on the outside (the ground of the
Breach runs in patches from nearly black to pale lilac, and one line is not
enough). After the change the edge gives a sharp peak of 167 against 79–82 at
neighbouring pixels.

**The second is the inhabitants.** Seven kinds, and almost every one demands
something:

| Who | What makes them awkward | Gets through per combo |
|---|---|---|
| Pale Warden | shield in front, 0.5 armour | 25% |
| The Breach Heart | shield + armour, summons | 37% |
| Rift Titan | 0.42 armour, resists knockback | 72% |
| Pale Smith | 0.34 armour, corrosion | 77% |
| Rift Stalker | 22% dodge, flies | 78% |

The measurement uncovered a real hole along the way: **`dodge` from an enemy's
definition never reached the instance**. The constructor had `this.dodge = 0`,
and the field was only filled by an elite affix — so `resolveHit` read zero, and
the Stalker with its 0.22 dodged not a single blow. A silent bug: in combat it
looks like "this enemy is just weaker than intended", without a line in the
console. Affixes now also **add** dodge rather than replace it: an elite Stalker
with an affix that has no dodge used to lose its own.

**The boss had to be cut.** The first version gave 147.6 s of pure trading — the
stand caught it itself, its threshold is 120 s. That is a sponge exactly: three
times longer than the Molten Colossus, even though a level 52 hero hits harder
than a level 32 one. Health was lowered from a multiplier of 31 to 15; the
shield, the armour and the summoning stayed — they are the difficulty. It became
72.5 s: the longest fight in the game, ×1.86 the Colossus, but decided by
execution rather than endurance.

The measured result: the Breach is harder than the previous biome at both ends of
the trade — a regular enemy dies in 1.4 s against the Smoldering Waste's 1.1,
while the player takes **7 hits** against the waste's 9, the ridge's 8, the
mire's 10 and the forest's 21.

### The Breach's loot has to do something

A material you can only sell is half a material. Pale ash and rift glass started
out exactly like that, and the biome came out as "kill and sell". Each now has
two ends.

**Ash** comes from salvaging endgame items (tier 6, epic and above) and goes into
two potions unlocked exactly at level 40 — that is, at the Breach. **Glass** is
taken from Pale Smiths and Titans, and what is forged from it is what they forged.

**Breach forging** is the fifth tab in the forge and the only way to get a biome
property **by choice** rather than by a roll. It also drops from the monsters, but
which one is decided by luck; here the player takes the one they need for 4
glass, 6 ash and 7200 gold. Four glass is four Titans or Smiths: a cheap road to
a legendary would devalue both the loot and the sharpening milestones.

Five properties, and each answers something that makes the Breach awkward rather
than just adding damage:

| Property | What it does | Against what |
|---|---|---|
| Breachmaker | three hits in a row on one enemy break its shield for 4 s | Pale Warden, the Heart |
| True Eye | an enemy cannot dodge more than once every 2 s | Rift Stalker |
| Voidskin | damage from terrain hazards halved | void vents |
| Stepthrough | a dash leaves a rift: damage and slow | crowds of voidspawn |
| Heartshard | a kill quiets the nearest vent for 6 s | an arena full of vents |

Measured on the stand: a warden's shield lets 7 damage of 100 through on a light
hit, with Breachmaker 50 — ×7.1. The Stalker's dodge: 400 hits out of 400 went
into a dodge, with True Eye zero.

**Sharpening had to be rolled back.** The first version required glass from +5
onwards, and measurement showed how that would end: reaching +5 on a rare weapon
takes around 53 thousand gold and about 60 weapons of fuel — the player gets
there long before level 40. And +7 is the "unique property" milestone, the reason
a weapon is kept for a long time. Pushing it behind the Breach would break what
the milestones were made for in the first place. All three milestones (3, 5, 7)
stayed where they were; only +7 → +8 sits behind the Breach — a step that grants
no milestone at all.

**The hint in the forge lied.** At the bottom of the crafting screen stood
"crafting does not grant unique properties — you find them or take them by
sharpening to +7", and the Breach tab made it false. A lying hint is worse than
no hint: the player believes it and never opens the tab. The text now depends on
the tab.

**The loot audit had to be taught as well.** It checks that every unique property
is reachable, and honestly reported five unreachable ones: the Breach properties
live in a separate pool, like the Abyss ones, and deliberately do not enter the
common one. But "deliberately outside the pool" is not the same as "reachable". A
simple exclusion would have switched the check off: the list would grow while
there was nothing left to check. Instead the audit now checks both real routes —
dropping from the biome's inhabitants and forging — and catches the converse as
well: a recipe that forges a property that does not exist, or one belonging
somewhere else.

### Sharpening: the player chooses the fuel

Three weapons for sharpening were picked automatically — the three weakest by
power of the same rarity — and the slots showed "?". It worked correctly and did
not work as a game:
the player could not see what would burn and could not decide for themselves.
"Weakest by the numbers" and "not needed" are different things: a legendary with
poor stats may be valuable for its property, and Breach forging now makes the
property a matter of choice outright.

A strip of your own weapons appeared on the right — only the eligible ones, by
the same rule the auto-pick used. Showing the whole bag and greying out the
ineligible was rejected: by level forty there are a hundred items in there, and a
strip of grey icons hides the rule rather than explaining it. The rule is written
in words under the grid.

Dragging and clicking are **one path, not two handlers**: press and release in
place and the item goes to the first free slot; press, move the cursor away and
release over a slot and that is a drag. The player does not decide in advance
what they are doing, they just pick up an item. A click on an occupied slot takes
it back out. The "Auto" button stayed: choosing by hand should not turn a routine
action into three extra clicks.

We keep references to the items themselves rather than indices: between frames
the bag is rebuilt (selling, picking up, salvaging), and an index would start
pointing at somebody else's item. Before every draw the list is cleaned of what
is no longer there, and `sharpen()` checks each item again by the same rule —
burning something other than what the person saw in the slots is worse than
burning nothing.

Measured in the live game: the auto-pick would have taken one set, the player
chose another, and exactly the three chosen ones burned — the bag went 16 → 13,
and none of the chosen remained.

The English layout caught its own problem: the page counter sat on the same line
as the rarity caption, and "“legendary” only" ran into "1/2". In Russian
"легендарное" is shorter and it could not be seen there — the caption moved under
the grid.

### Weapons: the profile meant nothing

The combat audit had held one finding since it first appeared: at level 8 a
dagger killed in 1.5 s and a spear in 2.5 s, ×1.66. The weapon profile mean­while
intended a spread of ×1.04. Measurement found four causes, and all four were
about the numbers in the profile not meaning what they said.

**The damage multiplier worked at half strength.** `atk` from the profile was
applied once — at crafting, to the item's own damage. But an item's damage is
exactly half of the total attack (48–50% at every level, the rest being level and
strength), while `spd` from the same profile divided the attack rate in full. So
speed applied at full force while damage applied at half. The profile now
multiplies the base as well, and `atk × spd` became the real ratio of damage per
second.

**Speed was counted twice.** The profile also laid `spd` down as a stat on the
item, and that divided the rate a second time through `gear.spd/220`. It gave the
dagger an extra 4.5% and took 1.8% from the axe. The stat was removed from the
base ones — it remains on affixes ("Swift") and trinkets, where it duplicates
nothing.

**Crit was not part of the profile.** The dagger's eight points of crit are worth
another +4% damage per second, the bow's four +1.4%, and after the first two
fixes they stayed above the intent by exactly that. Now folded into their `atk`.

**The staff promised what it did not give.** The hint read "+magic power", yet the
staff received no `magic` at all: magic is computed from `g.magic` and half of
`g.atk`, and since a staff's attack is below average it gave **less magic than a
sword**. A promise in a hint is part of the rules too, and the staff now keeps it.

| | was | now |
|---|---|---|
| melee spread | ×1.49 | ×1.08 |
| audit finding (lvl 8) | ×1.66 | none |
| staff in a magic build | ×0.98 of a sword | ×1.15–1.20 |

The ×1.08 spread holds at every level from 8 to 46 — it used to wander between
×1.24 and ×1.66, because it depended on the weapon's share of the total attack.

**The price showed up on the item card.** By removing the duplicated speed stat
we also removed the last sign that a dagger strikes more often: the player saw
"damage 52" against an axe's "damage 101" and read the dagger as strictly worse.
A weapon card now has a **"damage per second"** line — `damage × rate` — compared
against the equipped item like every other stat. The dagger shows damage 52
(▼−19) and damage per second 75 (▲+4): an honest picture. That number only became
possible after the fix — before it, `damage × rate` would have lied.

### Builds: strength against intellect

While measuring weapons we ran into a bigger question: is intellect a trap? The
first, hand-rolled calculation said a magic build gives **59%** of a physical one
— a death sentence for a whole branch of progression.

It was wrong. Magic skills hit areas, and the hand formula counted a single
target. The fifth finding in this project that turned out to be in the measure
rather than in the game.

The check was rewritten into the audit as section 7 and measures skills on the
same stand as section 6 — with real targets, projectiles and zones, against one
target and against five:

| | one target | five targets |
|---|---|---|
| intellect against strength, lvl 8 | ×0.91 | ×1.22 |
| lvl 46 | ×0.87 | ×1.15 |

That is a healthy trade rather than a trap: strength is better on a boss,
intellect on a pack. The audit's threshold is set on the better of the two cases
(a build is entitled to specialise) and fires below 75% or above 140%. The same
section also checks whether a magic build needs a staff at all — if it hits just
as hard with a sword, the weapon type changes nothing and the hint's promise is
empty.

### Combat moved to the server
`db.js` has said it honestly for a long time: the server **stored** the character
but verified no change at all — the snapshot arrived from the client wholesale.
Everything could be faked: hits, loot, level. The same note says where to begin —
with combat.

No second engine appeared. The room already built the zone with the same
generator and held the same `Enemy` instances; now it resolves a swing too, with
`swingHits` and `resolveHit` from `systems/combat.js`, the same functions the
single-player game strikes with and the stands measure with. It is not rules that
diverge, it is copies; and there is no copy.

The client no longer reports who it hit. It says "I swung, here is my facing and
which blow of the combo this is" — everything else is decided by the room: hits,
damage, weapon marks, lifesteal, knockback, death and experience. A stream of
`ev` events comes back (hit, dodge, death), from which the client plays the
spectacle: sparks, numbers, sound. The same split as everywhere else in the game
— rule apart, spectacle apart.

**The check is written as a dishonest client.**
`tools/combat-online-check.js` connects to the room and swings **without sending
any damage at all**. If the enemy loses health, the server is doing the maths; if
not, the client had been doing it all along and we moved nothing. Measured:
155 → 104 hp over twelve swings, six hit events, and out of forty consecutive
swings the server accepted one — the cooldown holds.

The first run found a hole of my own: the broadcast listed snapshot fields by
name, and the new `ev` field simply did not reach the client — the snapshot
carried it and the broadcast dropped it.

A biome room is raised with a variable (`ROOM_BIOME=forest`): in the city there
is nobody to measure combat against, it is safe by design. The same thing will be
needed when parties go out into the zones.

### Progress is computed by the world, not sent by the client

`db.js` had been honest about this from the start: the server **stored** the
character but verified nothing — the snapshot arrived from the client whole.
Combat moved to the room, then spawns, then loot ownership; what stayed was the
last and widest door.

**Measured first, as a dishonest client.** A stand signs in with a real
keypair — exactly what Phantom does, just by hand — and asks for what it never
earned: a legendary with 9999 attack and 9 999 999 gold. The server took it,
wrote it to the database and handed it back on the next login.

Loot is the room's now. It rolls the drop through the same rule the game rolls
it with (`systems/loot.js` — one rule, no copies), keeps it on the ground with
an owner, and hands it over only through `pickup`, which checks three things the
client could lie about: that the item exists, that it is within 26 px, and that
it is yours. It is yours for the first minute; after that anyone can take it,
because loot belonging to someone who logged off should not lie there forever.

**Two characters per address, and that is the boundary of trust.** `data` is a
backup of the single-player hero: the client sends it, nothing can verify it, and
it exists for exactly one purpose — so a character is not lost with the browser
cache. It never enters the shared world. `world` is the world's hero: the room
computes it and the room writes it. The client does not touch that column.

That is the whole fix. The first version was weaker — accept the client's
snapshot once, "to migrate an offline hero" — and the measurement went straight
through it: a fresh account uploads a legendary and walks in with it. There is no
way to tell an earned legendary from a requested one, so imported heroes are not
a thing. The shared world starts you in it.

The room also tells each player their own numbers (`me`, five times a second):
gold, experience, level, points. Not in the shared snapshot — nobody else's gold
is anyone's business — and not optional either: the client used to keep those
numbers itself, and now that the room computes them, one lost message would leave
a lie on the screen.

[`tools/progress-server-check.js`](tools/progress-server-check.js) is that
dishonest client, kept: it asks for the legendary, enters the world and finds
itself at level 1 with a rank-0 sword; kills something and watches the room drop
the loot, refuse it from 84 px, hand it over up close; then logs out and back in
and checks that the gold and experience the world counted are still there. Three
mutations were tried against it — the room reading the client's backup again,
pickup without a distance check, the room not writing at all — and it went red on
all three. The distance check only caught its mutation after the stand was taught
to **walk away first**: loot falls at your feet, so the check had been silently
skipped.

Verified in the browser end to end: kill, walk over the drop, and the client's
numbers match the world's exactly — 47 gold and 15 experience on both sides.

**What is still missing.** Buying, selling, forging and sharpening still happen
on the client: in the shared world those change gold and items too, and the room
does not see them yet. The single-player game is deliberately untouched — it must
work without a network at all.

### The client hands combat over

The room could compute combat; the game was still computing it for itself. Now
the client, once it is in a room outside the city, stops resolving its own
swings: it sends "I swung, here is the combo and my facing", and takes hits,
damage, deaths and enemy positions from the snapshot. Its own hero it still
moves itself — otherwise every keypress would wait for the network — but nobody
else's health is its business any more.

**Both sides had to build the same zone, and they did not.** The first
measurement in the browser: 43 enemies at the client, 39 in the snapshot. Two
formulas for the biome seed had grown up in two places — `(worldSeed ^
id.length*7919) + code*131` at the client, `seed ^ 0x2a1d` at the room. While
people played alone that bothered nobody. In a shared world the snapshot points
at an enemy **by number**, and with different lists a player would see one enemy
and hit another. There is one rule now, `zoneSeedFor`, and all three kinds of
place go through it — city, biome and dungeon. Measured after: 39 = 39, and for
each of the 39 the kind and the position match to within 3 px.

**The first green light was the stand lying.** The check compared `enemy.type`
against the snapshot's `t` and reported "39 of 39 match" — while the client's
field is `key` and the snapshot's is `k`. It was comparing `undefined` with
`undefined`. The eighth case in this project where the finding turned out to be
in the measure. Now it compares the kind and the coordinates, and those cannot
both be absent.

**A real bug came out of it.** The number in the snapshot is the enemy's place in
the room's list, and the room's list never thins out — the client's does, it
sweeps corpses away after 1.2 s. After the first death every number after it
shifted by one. The number is now **the enemy's own**, handed out at birth and
carried on the creature, and the client looks it up by that rather than by a
position in an array that changes underneath it.

**Whose kill.** With combat on the server, the client learns of a death by the
enemy vanishing from the snapshot — and it was handing out loot, experience and
quest credit for **everyone's** kills, including other players'. The room already
says who struck the blow; the client now checks. Verified with two clients: one
sat in the forest doing nothing while the other killed. The kill arrived (39 → 38
alive), and the observer got zero experience, zero gold, no kill counted and
nothing in the bag. The stand guards the field: the `ev` field has been dropped
by the broadcast once already, and the whole loot rule hangs on this one.

### Standing too close, and swinging through the enemy

The stand failed one run in four: the target was 9 px away, and out of fourteen
swings not one hit. Measured on the real rules — an enemy walked around the hero
in a circle, the hero facing straight at it:

| distance | swings that hit |
|---|---|
| 4 px | 26% |
| 8 px | 43% |
| 10 px | 54% |
| 12 px and beyond | 100% |

The range test measures from the chest (`y − 11`), and the direction was measured
from there too — to a point in the middle of the enemy. Far away that hardly
matters; up close the difference in **height** outweighs the distance, the
direction to the enemy points downwards rather than forwards, and the arc misses
by more than its own width. "Pressed up against it and swinging through it" was
exactly this. Facing is a direction along the ground, so the angle is now
measured along the ground, foot to foot; the range still comes from the chest.
After: 100% from 4 px out, and nothing changed at the far edge.

It was a rule, not a display quirk — so single player had it too, and the whole
audit suite ran again on top of it: combat, loot, descent, zones, content, saves,
onboarding, soak. All green.

### One world, and it must not be eaten

The design is one shared world rather than parties, and that changes what has to
be true. Measured first, on the real rules: a geared player strips a biome in
**1.5 to 3.5 minutes** — and that is a lower bound, since the bot walks in
straight lines and nothing fights back.

| biome | population | cleared in |
|---|---|---|
| Emerald Forest | 39 | 1.5 min |
| Ashen Mire | 38 | 1.6 min |
| Frozen Ridge | 43 | 3.4 min |
| Smoldering Waste | 46 | 2.5 min |
| The Breach | 39 | 3.5 min |

The room never brought anyone back. In a shared world that means the first player
through the forest empties it **permanently, for everyone**.

The fallen now return. The delay comes from the same measurement: one hunter kills
0.43 creatures a second, so over 45 s they owe the room about twenty — half a
biome. Population does not sink below half while one player hunts.

Nobody rises in your face: within 120 px of a living player the return is
postponed. But not indefinitely — otherwise camping a corpse would hold a piece
of the shared world empty for everyone else. After twice the delay the creature
comes back regardless.

**Two more things had to move to one place.** The room used to build its
creatures the short way — `new Enemy(key, level, x, y)` — while the game applied
pack membership, floor modifiers, corruption and elite affixes. So a "pack
leader's lair" guardian, which in single player carries a shield or a rage, came
out plain on the server. Populating a zone is a rule, not a detail of one side:
it now lives in [`world/populate.js`](src/world/populate.js), and both sides call
it. A creature returns through the same function that first placed it, so it comes
back as itself.

**A real crash was hiding behind it, and the server log found it, not the
stand.** The moment any monster landed a hit on any player, the room's whole tick
threw: `takeDamage` calls `game.proc` for legendary effects, and the room had no
`proc`. Every creature after the striker in the list stopped updating that tick.
The stand saw only "the world did not come back" and pointed at the wrong thing.
The room now runs procs — they are rules, they heal and burn — and knows what to
do when a player dies: the same twelfth of gold as in single player, no death
screen, back on their feet at the entrance after five seconds. A shared world does
not stop for one funeral.

[`tools/world-alive-check.js`](tools/world-alive-check.js) guards it, talking to
the room as a client with no world of its own: kill, stand over the body past the
delay (must not return), stand past the cap (must return) — same kind, full
health, its own corner. Stands raise the room with a short delay
(`RESPAWN_SEC=8`) so a run takes seconds instead of minutes; the room states its
own rule in `welcome`, and the stand waits by what it is told rather than by what
it remembers.

**Three times over, the stand was the thing that was broken**, which is becoming
the pattern worth writing down:

- It sent a fixed 50 ms per step while real time ran slower, and the room's
  anti-speedhack budget ate the surplus — the hero crawled at half speed.
- It walked "away from the body" and hit the map's western wall after fifty
  pixels, then reported that the fallen never returned.
- Worst of all, it stood **silent** for eleven seconds while waiting. The room
  disconnects the silent after fifteen, so every later reading came from a frozen
  snapshot, and it stated with confidence that the world had not recovered. It now
  beats like a live client while it waits.

### The guardian belongs to everyone

The boss was spawned by the client. In a shared world that means everyone has
their own — one the server never sees, never checks and never validated the loot
from, and the biome's best drops come off it.

The room owns the arena threshold now. It raises one guardian, and two players
standing in the same forest see the same one with the same health: hit it and
the number moves for both. It returns four times slower than a regular creature
— it is an event, not a headcount — and only when somebody walks back into the
arena. Appearing right in front of you is the point; that is what people come
for.

**The ambush camps were worse than "one each".** Walk up to a camp online and
the client spawned the raiders itself. The room knew nothing about them, so they
were absent from the snapshot — and the client buries everything missing from the
snapshot, **with full loot and experience**. Free reward for a squad nobody saw.
The rule is now simple and covers the whole class: in the shared world a kill
pays out only when the room says who struck the last blow. Camps are the room's
too, they re-arm after they are cleared, and they reuse their own slots in the
list rather than claiming new ones every raid.

The snapshot carries one extra number for creatures the room adds while it runs
— their level. Zone population the client reconstructs by number through the
shared rule, but a guardian or a raider did not come from the zone's description
and cannot be rebuilt from a number alone.

### The room could not do what the game can

Twice in a row the room died the same way: an entity called a method the room did
not have, and the **whole tick** threw — every creature after that point in the
list stopped moving. First `proc`, on any monster's first hit. Then `onLevelUp`,
and that one only showed up in the Breach, where the guardian gives enough
experience to level up on the spot; the same code ran clean in the forest. Both
times the stand pointed elsewhere: "the world did not come back", "the guardian
broke".

Catching that by luck does not work. [`tools/room-surface-check.js`](tools/room-surface-check.js)
builds the list **from the code** — every `game.something(` in the entities and
the reaction system — and checks it against what the room can do. It found a
third one immediately, still live at the time: elemental reactions. The room
applies weapon marks itself, a second mark on a target fires a reaction, and the
reaction calls `bolt` and `onReaction`. A hero with two elements on their weapon
needed one fight to bring the room down.

Then it does it for real: puts a monster next to a hero for six seconds, hands
over a hundred thousand experience, and kills the hero — because a method can be
present and still do nothing.

The mutation test earned its place here too. Breaking the arena threshold on
purpose, the stand caught it. Breaking "the guardian is already standing" — it
did **not**: the boss was recreated every tick in the same slot, so the count
stayed one and the number stayed the same, while its health quietly returned to
full and it could never be killed. That check exists now because the break
existed first.

**What is still missing.** Loot on the ground is still each client's own, and the
room does not validate what dropped.

### A clean sweep for defects: thirty-six found, thirty-six fixed

All twenty-one stands were green. That is exactly why the sweep was worth
running: whatever they catch, they had already caught. Six independent passes
went over the code by dimension — the online layer, the protocol, numeric
hazards, lifetimes and leaks, saves, and the interface — and every finding had
to come with a reproduction that runs. Thirty-six survived an adversarial
re-check that tried to refute each one; not a single one was thrown out.

**Four crashes.** Three of them were the same shape as `proc` and `onLevelUp`
before them: shared rules calling something the room does not have. The steam
reaction pushes into `game.hazards` — the room had no such field, and since the
room applies weapon marks itself, a "Burning … icy" sword fired a reaction on the
server and broke the swing mid-way: some targets took damage, the rest did not,
and the cooldown was already spent. "Frost Heart", the only legendary on the
`hurt` hook the room actually plays, calls `g.aoeDamage`, which did not exist —
every hit on a player wearing it threw out of the entire tick. A rune with a
rarity not in the table (`RARITY[rarity].mult`, no fallback where every neighbour
has one) crashed `continueGame` outright: the save passed the integrity check,
became the main slot, and "Continue" died every time from then on. And WebSocket
continuation frames were capped per frame but not in total — a thousand
one-megabyte pieces grew the server's memory without limit, before any `hello`,
from anyone.

**Eight ways to lose or corrupt data.** The shop priced a stack per item and took
the whole stack: fifty dragon scales sold for 52 gold instead of 2600.
`Player.fromJSON` was a bare `Object.assign` — and that one line was the widest
hole in the game. A string where a number belongs (`level: 'ой'`) made `maxHp`
NaN; then `hp -= dmg` is NaN too, and `if (hp <= 0)` is always false on NaN, so
the hero never died and everyone in the room got `null` health in their snapshot.
A missing `statPoints` made `statPoints <= 0` false on `undefined`, so points
could be spent forever; a missing `xp` made `xp >= xpNext` false on NaN, and the
hero silently stopped levelling. A quest reward vanished into nothing when the
bag was full — `addItem` returns false and drops the item, while the quest was
already marked done and the player was shown "Reward: …". A save the client
itself had **rejected** still went up to the server, which keeps no copies and no
checks. One `deepest: 1e18` broke the leaderboard for everyone and the owner's own
login: sqlite stores it, `node:sqlite` throws `RangeError` reading it back, and
neither call caught that. Item ids restarted from one on every page load, so a
fresh drop took the id of something already worn — and set bonuses are cached by
worn ids, so the hero kept the bonuses of a set they had taken off.

**Five holes.** `Infinity` in a movement step survived `|| 0`, and
`Math.hypot(∞,∞)` made the player's coordinates NaN permanently — after which
nobody in the room could be chosen as "the nearest player", and if that hero was
alone there, every creature froze. The character snapshot was authoritative:
`level: 9999, str: 1e5` came back as a hero with 960 046 health and 1.9 billion
damage, computed by the server. Sessions were created on an open guest endpoint
and never evicted — three thousand requests, three thousand permanent entries.
A socket that never sent `hello` belonged to no room, so nothing pinged it and
nothing closed it: forty of them sat there while `/health` reported zero players.
And the cosmetic `look` object, taken from `hello` unchecked, is embedded in every
snapshot to every player twenty times a second.

**Nineteen more of wrong behaviour**, of which the sharpest were shared-world
ones. Chain Lightning and Thunderer hit a single target four times instead of
chaining: `nearestEnemy` had no "already hit" argument, both callers passed one
anyway, and the wrappers dropped it silently — while the skills audit kept its
**own** copy of `nearestEnemy` that honoured it, so the stand was measuring a
chain the game did not have. Enemy projectiles were created and then never
touched: the list grew for the lifetime of the room, and archers and casters did
no damage at all in the shared world. Corpses never faded online — `deadT` only
grows inside `Enemy.update`, which the online path skips, so a body stood at full
opacity, indistinguishable from a live monster and unhittable, until the room
respawned it. A dungeon room ignored the floor modifier, so client and room built
**different maps**. A room swept when its last player left took the whole
respawn state with it — leave to the city and come back for a full biome and a
live guardian on the spot.

The fixes follow this project's usual rule: put it where the rule already lives.
Where a material drops was known only to the content audit, so the objective
pointer went blank on nine quests out of thirty-four — that lookup now lives in
`systems/objective.js` and the audit's private copy of `nearestEnemy` is gone.

[`tools/hardening-check.js`](tools/hardening-check.js) guards all of it: twenty-nine
checks that each replay the original defect. It was mutation-tested three ways —
trusting the snapshot again, dropping the chain's skip list, removing
`aoeDamage` — and went red on all three.

**And the eleventh case of the instrument lying**, this time mine. The workflow
stitched findings to verdicts by exact title match, and the verifiers had
rewritten the titles — so only twelve of the thirty-six confirmed findings
reached the synthesis. The other twenty-four were sitting in the journal the
whole time.

### A flaky check is worse than none

The onboarding audit went red one run in ten — and had been doing so before any
of this work: measured 3 of 24 before the fixes and 2 of 24 after. That is not a
regression, it is a check nobody can trust, and this project already knows what
those are worth.

Two real gaps did come out of chasing it. The objective pointer returned nothing
for `collect` and `elite` quests — nine of thirty-four — because their target is
not a place; and inside the right biome it went blank instead of pointing at the
creature that drops the material. Both are fixed, and the audit now checks the
rule **deterministically**: every quest, standing in the city, must yield a
destination. 34 of 34.

The residual flakiness was the bot's own blindness, and it is now reported as
such rather than as a finding. Two checks were passing `Infinity` straight
through — "long until the first fight: Infinity seconds" is a statement about a
bot that never fought, not about the game. Measured across thirty runs, the real
first kill lands at 21–30 seconds, once at 39. After separating the verdict from
the observation: 0 red in 40 runs.

### A room per biome

There was one room and it was the city forever. That is what kept co-op locked
up: the server had learned to compute combat, but it had nowhere with anything to
fight.

Now there are as many rooms as needed. One city for everyone — that is where
people meet — and one per biome, alive for as long as somebody is in it. Empty
ones are swept away: a zone in memory costs about a megabyte, and a dozen
abandoned ones is already noticeable.

Travel is leaving one room and entering another over the same connection, and the
character is **rebuilt from the database**. A room does not hand it to its
neighbour: the source of truth is the database, not the neighbour. The client
sends `travel` with the same description of a place it uses to walk through gates
in single player.

The `combat-online-check` now walks the whole path: entered the city (zero
enemies), asked to travel, arrived in the forest (39 enemies), walked to the
target and killed it **without sending a single point of damage**. 73 hp → dead,
five hit events, one death event, one swing accepted out of forty in a row.

**The stand was measuring the wrong thing again, and it cost an hour.** It picked
a target from the first snapshot, walked to where it had been and measured its
health there — while the enemy moved away in the meantime. The stand hit whoever
happened to be nearby and reported "the server takes no health off", while the
server was taking it off others. It now walks **after the target** rather than to
a point, and closes the distance again between swings: the enemy fights back,
runs off, gets knocked around. The seventh case in this project.

### Tools that lied

Two regression tools silently reported somebody else's breakage.

`world-check` failed with "no welcome in 3 s". The cause was not in the server:
the room had stopped admitting anyone by name alone once accounts appeared, and
closed the connection with code 1008 before `welcome`. The check reported the
symptom and stayed silent about the cause. It now takes a guest token the same
way the title screen does, and prints the reason for a closure if one happens.

Next, the same tool declared that **the server does not move the hero** — 0 px in
1.5 s. Also untrue: the room accepts not "I am going there" but a list of played
steps `[mx, my, dt]` — that is how the time budget against speed hacks works. The
tool was sending the old shape without `s`, `applyInput` returned on its first
line, and the hero honestly stood still. After the fix: 91.8 px in 1.5 s,
teleports rejected, no way off the edge of the map.

A permanently red check is worse than no check: people get used to it.

### Rarity by place

Measurement showed that **rarity did not depend on place at all**: 0.9%
legendaries from a regular monster and 3.8% from an elite — identically in the
Emerald Forest at level one and in the Smoldering Waste at twenty-one. The first
biome's boss dropped a legendary 40% of the time. There was no point in going
further: the same things were dropping at your feet from the start.

Every place now has its own ceiling:

| place | ceiling | boss |
|---|---|---|
| Veloria, Emerald Forest | rare | epic |
| Ashen Mire, Frozen Ridge | epic | legendary |
| Smoldering Waste | legendary | legendary |
| catacombs and the Abyss | by floor level | one grade higher |

The thresholds match the quest rewards (uncommon → rare → epic): loot must not
outrun the story, otherwise a quest reward looks like a handout.
A boss gets one grade above its place's ceiling — it is supposed to be an event;
the forest Treant now **always** drops an epic instead of a 40% chance of a
legendary and 60% of an epic.

The ceiling lowers a rolled rarity rather than discarding the roll: under a
"rare" ceiling the share of rare items simply rises (14% against 10%).

The rarity decision was moved into a single `dropRarity` function — it used to be
smeared across `dropLoot`, chests, the altar and the shop, and closing them
selectively did not work: first legendaries kept dropping as **runes**, then it
turned out the blacksmith was selling them at level one. The shop now wraps every
line of its stock without exceptions.

**A ceiling is dangerous because it is easy to lock something away with it**, so
[`tools/loot-audit.js`](tools/loot-audit.js) checks not only the rule but its
consequences: that every unique property and every set is reachable somewhere (14
properties of 17 — the other three only from the Abyss, as intended; 4 sets of
4), and that **the hero enters each biome in gear that can fight there**. The last
is computed with the real combat rules:

| biome | arrives in | kills a regular | takes hits |
|---|---|---|---|
| Emerald Forest | rare | 0.4 s | 21 |
| Ashen Mire | rare | 1.5 s | 10 |
| Frozen Ridge | epic | 1.5 s | 10 |
| Smoldering Waste | epic | 1.5 s | 10 |

The first version of this check had to be thrown out: it compared a quest reward
with the biome's ceiling and complained that "uncommon is worse than rare". That
is nonsense — a ceiling is the best that can drop at all, not what lies around at
your feet. The check was comparing a gift with the unattainable.

Verified in the live game too: in the forest, **not one legendary** from four
hundred boss kills, two thousand elites and six thousand regulars; in the waste,
10.3% from the boss and 0.2% from a regular.

### The descent audit: does the trade add up?

Floor modifiers existed before — eleven of them, a choice of two doors on every
floor, plus cursed altars and elite affixes. There was no reason to build them
again. There was also no reason to believe they were balanced: the player sees
"+90% reward" while nobody sees the price in difficulty — it is smeared across
damage, speed, armour, enemy count and light.

[`tools/descent-audit.js`](tools/descent-audit.js) computes that price with the
real combat rules (`resolveHit`, `swingHits`, `Player.takeDamage`): how many times
longer a floor is than "Lull" and how many times more fragile the hero is on it.
Three things turned up.

**The reward number multiplied incomparable currencies.** `modReward` multiplied
loot by gold by experience: Greed's ×2.6 loot and ×3 gold turned into **+680%**,
although the player gets 2.6 times the loot *and* 3 times the gold, not 7.8 times
of something. It is now a weighted average (loot 0.5, gold and experience 0.25
each) — a summary of three numbers into one rather than their product.

**And it ignored the number of enemies.** Loot drips from the dead: twice the
enemies is twice the chances of an item dropping. Without that, "Horde" showed
half of what it actually gives, and "Lull" twice as much.

**"Greed" was free money.** A price of ×1.27 against a reward with no equal: 25.3
reward per unit of risk against Horde's 0.8 — a thirty-two-fold gap. Greed now
bites: the guardians are thicker (×1.5) and hit harder (+30% damage taken).
"Fortification", conversely, stretched a floor by nearly half again and paid the
least — its reward was raised to match its price.

| gap between the best and worst door | was | now |
|---|---|---|
| floor 10 | ×32.4 | ×2.8 |
| floor 30 | ×32.4 | ×2.6 |
| floor 50 | ×32.4 | ×1.5 |

**The stand does not see everything, and that is written into it directly.** The
price of "Hunger" is in potions the hero does not drink; of "Gloom" in vision the
stand does not have; of "Hunted" in an elite pack, and here there is one skeleton.
Such modifiers are flagged and **excluded from the verdict**: writing them down as
"reward without risk" would be the stand lying rather than a finding about the
game. "Cavity" and "Greed" are marked as partially measured — their price is
understated, so the deal comes out overstated, and the error leans towards
strictness.

### The Abyss got its own doors

The same audit showed a degeneration nobody had noticed: **the door pool did not
depend on depth**. On floor fifty the player saw exactly the same eleven options
as on floor three. Depth grew, choice did not.

From floor 26, three modifiers of the Abyss itself join the risky pool:

- **The Maw** — enemies are thicker and faster;
- **Thirst** — potions are dead and wounds run deeper;
- **Cavity** — enemies are shelled, and there is almost no light.

Distinct door pairs went from 70 to **130**.

### Saving: the one irreversible mistake

Combat can be rebalanced, a zone regenerated, graphics rolled back. An erased
character cannot be brought back. And yet saving was the simplest place in the
game: one `veloria.save.v1` key, no copies and no checks.

First I worked out what exactly to be afraid of. A torn write into localStorage
does not happen — `setItem` either goes through completely or throws, and then the
old value
is intact. There are three real ways to lose a character, and each has its own
defence:

1. **the game wrote something corrupt over something whole** → a rough check
   before writing: if it fails, the old save is left untouched;
2. **reading failed and the game silently offered to start over** → backup copies
   and an explicit message saying which copy was used and how old it is;
3. **the browser cleared storage** (incognito, "delete site data", quota) → an
   export of the character to a file, done by the player.

The copies are spaced **by time, not by number of writes**. The game saves often —
an autosave every 45 seconds plus every zone transition — and the last three
writes would all be from the last minute. Copies like that do not help against
corruption noticed half an hour later. A new copy is only started if the freshest
one is already more than ten minutes old: three slots cover roughly half an hour
of play.

The cost was measured: a save weighs 4 KB with an empty bag and 25.6 KB with one
packed to the brim. Four copies is about 100 KB, that is 2% of the five-megabyte
limit.

**The integrity check does not catch everything, and I found that out the hard
way.** I called save from the title screen, where `player` is still empty — and
wrote a level one hero over a level thirty-five one. The data was perfectly
intact and the check had nothing to object to. So a second rule was added: a
hero's level never falls (death takes gold, not levels), so a falling level is a
reliable sign that the wrong thing is being written. The one exception is
`save({ fresh: true })` from "New game".

Level thirty-five, incidentally, came back from a backup — the system proved
itself on a live example within the first hour.

[`tools/save-check.js`](tools/save-check.js) — 39 checks against real storage:
a write-and-read round trip with legendaries and runes, six kinds of corruption
(all rejected, the hero intact), recovery from a copy when the main slot is
broken, spacing of copies by time, export and import as a file, three kinds of
foreign file (all rejected), a level downgrade, and "new game" taking the copies
with it.

Three checks out of thirty-nine I wrote incorrectly along the way: I expected
zero copies where the first copy is correctly created immediately; I expected an
unchanged chain after a series of writes, although one shift is legitimate; and I
aged only the main slot, whereas the rule compares it against a copy — both came
out the same age. Every time it was the stand that lied, not the code.

Settings gained a "Saving" section: a summary (level, number of copies, size) and
two buttons — "Export" and "Import".

### The zone audit

You reported that on catacomb floor four the hero appears in a river and cannot
move. Searching for that by hand is pointless — zones are generated, and the bug
sits not in a particular map but in the placement rule. So
[`tools/zone-audit.js`](tools/zone-audit.js) was written: it builds fifteen
hundred zones and checks them with a flood fill over the **real collision** (the
same `canBeAt` the hero walks with, rather than the tile map — a house stands on
walkable ground but you cannot walk through it):

- you can stand at the spawn point;
- from it, the exits, the descent, the boss arena, chests and residents are all
  reachable;
- nobody stands inside a wall or an object.

Five causes were found and fixed, all the same flaw in different places: **the
point was chosen from the map, and then somebody with a body stood on it.**

- **The hero in a river.** `spawnPoint` in the dungeon was placed two tiles below
  the room centre without a check, and water counts as impassable. Caught on every
  sixth floor. Now the nearest place where the body fits is found.
- **Enemies in rocks.** `z.findFree` does not know about objects — 2–9 monsters
  per zone ended up inside boulders and columns and simply took no part in the
  fight. A pass over the real collision was added, with each enemy's body and an
  allowance for fliers.
- **A descent in the void.** On boss floors the staircase shifted four tiles below
  the room centre — and if the room is small it went past its wall. The floor
  turned into a dead end: you can enter, you cannot descend. Caught on floors 15,
  20 and 30. The shift is now bounded by the room's size, with a reachability
  safety net.
- **A chest in a pocket.** The terrain leaves areas cut off by walls; a chest
  there is visible on the minimap but unreachable.
- **A merchant behind a wall.** The same thing but worse: a player walks to a
  merchant on purpose and will go looking for a way through.

Worth remembering separately is how the first version of the fix **did not work**:
the placement pass stood before `bakeSolid()`, and before that `canBeAt` sees no
objects at all and considers everything walkable. Not one of the 140 enemies in
walls moved, and it looked like "the fix did not help".

Result: 1490 zones, zero problems. The cost of generation did not change — 22 ms
for a biome, 12 ms for a dungeon.

### The content audit

The zone audit answered "where can you walk".
[`tools/content-audit.js`](tools/content-audit.js) answers a different question:
"is there anything worth walking to". An impossible quest is the same dead end as
a floor with no descent, only crueller: the player searches for hours and blames
themselves.

It checks that every quest target exists somewhere and is available at the level
the quest is given; that every material in a recipe drops from somewhere, and not
from a biome that opens much later; and that the generator does not produce
weapons with no damage, armour with no defence, or negative stats. The run: 24
quests, 67 recipes, 15 materials, 2100 generated items.

Three discrepancies turned up, and two thirds of them were **a flaw in the tool
itself** rather than in the game:

- The "Abyss Tear" supposedly dropped from nowhere. In fact it does drop — from
  Abyss bosses, but those appear in no biome table: they show up on rotation on
  deep floors, and the check did not know about them.
- One was real: **the "Elixir of Fury" unlocked at level 14, while the ember it
  needs only drops in the Smoldering Waste, which opens at 21.** For six levels
  the recipe hung in the list unreachable. Moved to level 20.

The useful conclusion is not about the game but about method: a tool that finds
something must itself pass a sanity check. Two thirds of the first run were false
alarms, and taking them for truth I would have "fixed" what works.

### New player onboarding: the measurement is back in tools
The onboarding timing had been measured once before — and was lost together with
the script, which lived in scratch files. A check that cannot be repeated is not
a check: since then came act three, manual fuel selection, the reworked weapon
profile and touch controls, and there was no way to say which of them had moved
the opening. The measurement now lives in `tools/onboarding-audit.js`, next to
the rest.

The stand boots **the real game with no screen** — the same `Game`, the same
quests, NPCs and hints — and drives a bot through it. It also had to be taught to
draw every frame: menu hit areas are created **during drawing**, and without it
no buttons exist. That brought a side benefit — the run fails if a new player's
interface breaks anywhere.

The road to the first quest turned out longer than remembered: talk to the
captain → "Quests" → the journal → "Accept". Four steps.

**What this stand does not measure is written inside it.** The bot walks in
straight lines and goes round obstacles blindly — there is no pathfinding in the
game, and the enemies have none either. The price is visible in the report: about
23 px/s against the hero's 62, meaning two thirds of the "walking" is eaten by
detours. So the verdict is passed only on the first thirty seconds — those are
played almost from a score and repeat from run to run — while everything after is
printed as observation. The "long until the first fight" check carries its own
caveat: it is the only one from the opening that depends on navigation, and it
first asks whether the bot itself was working.

What was found and what was done:

- **The game never says how to move.** It explains runes, the attack combo,
  rarity and stat points — and not a word about WASD. While only we played, that
  did not matter; someone arriving from a link sees a hero and does not know what
  to do with their hands. A **"How to play"** card appeared — first in the list,
  fired immediately, with text that fits the device: on a phone there is no point
  talking about WASD.

- **Hints came back to back.** The condition let the next card through half a
  second after the previous one left: 9.5 s on screen plus half a second — and a
  newcomer got three cards in nineteen seconds, during their first fight, where
  they are already busy. The first one never gets read. A 10 s gap appeared, and
  it is counted **from when the card leaves** rather than from when it arrives: a
  player who closes a hint early should not get the next one instantly. Measured:
  it was 10 s between cards, now 20.

- **Text ran into text.** On the very first screen of a new game "...will give
  you the first quest" collided with "Take: First Blood". The objective label now
  remembers where it stands, and toasts go round it. The first fix immediately
  pushed the line under the "How to play" card — a detour around one obstacle
  that creates a second is not a fix — so they go round both, and the card's
  rectangle is computed on the spot rather than taken from the drawing that
  follows and would be a frame late.

**One finding the measurement overturned.** The bot entered the forest at second
17 and fought in the second minute, and the conclusion suggested itself: the first
quest ("six slimes") leads past the nearest enemies to a particular species —
slimes are only a quarter of the forest's population. A measurement across 60
zones refuted it: 226 px to the nearest enemy, 294 px to the nearest slime — 1.3
times further, five seconds on foot, and beyond 600 px it lands in one zone out of
sixty. The delay was the bot's. The sixth case in this project where a finding
turned out to be in the measure rather than in the game.

### The first ten minutes

The opening was measured the same way as the economy: with a script, not by eye.
A bot plays a new game — to the captain, take the quest, into the forest, into a
fight — and writes a chronicle by seconds. The real game loop is frozen for the
duration of the measurement: otherwise the game lives between the bot's steps and
the hero manages to die while standing next to a monster.

What the first run showed and what was done about it:

- **Loading took 0.55 s, and a quarter of it was wasted.** Of the loader's four
  steps, two — "picking the palette" and "lighting the torches" — did nothing,
  yet every step waits two frames. Two steps remain, exactly matching the real
  work (baking props 193 ms, monsters 118 ms); the waiting fell from 134 ms to 67.

- **Twenty-four seconds to the first blow, sixteen of them walking.** The captain
  who gives the first quest is not visible from the starting point; from him to
  the forest gate is another screen and a half. No marker, no arrow — the player
  walked at random. An **objective pointer** appeared (`systems/objective.js`):
  one point for the whole game, drawn in two places — a diamond above the target
  while it is on screen, and an arrow with a label at the edge when it has left —
  plus a pulsing mark on the minimap. The order is deliberate: first "deliver what
  is done", then "take something new", and only then "go and do it" — a player
  with a completed quest most often does not remember who to bring it to.

- **An elite within the first two screens.** Points of interest were placed no
  closer than 240 px from the portal, and a "pack leader's lair" puts an elite
  three levels above the zone: in a quarter of the runs the nearest creature to a
  level one hero (103 hp, 25 damage) was an elite with 1092 hp and 41 damage —
  forty-four hits to kill, three to die. The points were pushed out to 460 px, and
  a **shallows** appeared at the entrance: in the first 420 px the level is pinned
  to the biome's lower bound, affixes are removed and elites are evicted. That
  pass stands at the very end of the generator — spawns are added in four
  different places, and a change in the middle missed half of them.

  Measured across 40 fresh zones per biome: in the shallows the maximum is
  `zone level − 1`, zero elites, and the nearest elite no closer than 462 px (was
  228). The distance to the first enemy did not change — 240 px, the same opening
  pace.

- **The first hint popped up at second zero.** "Skills are runes" fired on having
  a rune in the bag, and the hero starts the game with one: the card explained
  skill slots to somebody who had not taken a step. The condition became "has a
  rune and is in a fight" — it now arrives at second 20, in the first skirmish.

The chronicle after the changes (the first minute, compared with the old one):

```
rune hint            0 s → 20 s
first kill          24 s → 22 s
quest objective     76 s → 31 s
second level        96 s → 71 s
first death         55 s → did not happen
```

The bot is deliberately dim: it does not retreat, does not press `F`, and gets
stuck outright on a shield bearer — the numbers after the first minute say nothing
about balance. The time to the first blow does not depend on its skill, and that
is exactly what was measured.

### Two languages

Russian and English, switched in Settings without a reload. The dictionary key is
**the Russian string itself** rather than an invented identifier: what stays in
the code is live text you can see while reading, not `t('menu.pause.save')`.
Translation is substituted **inside `text()`** rather than at the call sites.
Measured before the work: of 901 occurrences of Russian strings, 833 reach
drawing untouched, so one change at the drawing level covered them all. Only 13
places had to be touched explicitly, where a name is interpolated into a string.

Three kinds of composite that do not exist in the dictionary as a whole are taken
apart on the fly:

- **Item names.** "Steel Blade of Fury" is assembled on drop and lies in the save
  in that form. All combinations cannot be written down — there are thousands:
  seven tiers by six weapon types, twenty prefixes in four grammatical genders and
  ten suffixes. A dictionary miss is decomposed into prefix, stem and suffix, and
  each part is translated separately. That also fixes **old saves**: the Russian
  string sitting in one is translated the same way as fresh loot.
- **Numbers.** "FLOOR 7", "+240 experience", "XP 1.2K / 3K" — numbers are replaced
  with placeholders, a translation is looked up by the `FLOOR {0}` pattern, and
  the numbers are put back.
- **Contract descriptions.** The string used to be assembled at issue time and go
  into the save. Now the save holds a template key and the fields that were
  already there, and the text is assembled when shown.

Verified with a hook in `t()`: a pass over every screen — title, settings, pause,
six journal tabs, all merchants and their shops, four forge tabs in every
category, fusing, the gates, the descent doors, the altars, death, eighty item
and rune cards — left **zero** untranslated strings.

Layout: English is on average **the same width** as Russian (measured across 860
strings at three sizes), and longer in 38% of cases. Panels with paragraphs
compute their height from the number of lines and grow by themselves. Button
labels are now clipped to the button's width — buttons here are fixed width, and
fitting them per language separately is more expensive than clipping once in the
widget itself.

### The font: percent signs sticking together

There is no font file: the system monospace is drawn into a buffer and cut by an
alpha threshold of 118 — the smoothing disappears and crisp pixels remain. The
threshold swells round glyphs by a pixel, and the pairs `00`, `0%`, `40%` merge
into a single blob. Measured by columns: of twenty-one volume values,
**sixteen** stick together, and the same trouble affects every percentage in the
game — "crit 25%", "−30%".

Raising the threshold is not an option: at 160 the pairs finally separate, but
across all glyphs at four sizes `N`, `m`, `ё` and the separator dot `·` — of
which the interface is full — fall apart. The defect was not cosmetic: on the
character sheet "−9% damage" read as "−94", because the `%` merged with the nine
(checked on a live character — damage reduction there is 9.0%).

**Fixed by moving the interface to a vector font** — there is nothing left to cut
by a threshold. The pixel font remains only in the world: damage numbers and the
plates above enemies must live in the same grid as the sprites, and there is
nothing there to stick together — they are short numbers without percent signs.

### Impassability

Terrain is by 16×16 tiles: wall, water, cliff. **Objects are per pixel.** The
object's blocking rectangle used to be baked into tiles too, and a 56×18 rectangle
under a house swelled to 80×32: an invisible wall stood around every building, up
to 10 pixels at the sides and a whole tile below. Tiles remain only as an index —
each holds the numbers of the rectangles crossing it, so one or two need checking,
and a single check costs 0.05 µs.

The blocking strip (`footBlock`) ends **7 pixels above the bottom of the sprite**.
That is not taste but a consequence of the body model: a creature is defined by a
point at its feet and a height upwards (the hero's is 11×9), so a strip flush with
the bottom of the sprite would push the hero away by those 9 pixels as well.
Measured: the approach to buildings was 11–17 px, it is now exactly 2 px on every
side; walkable ground in the forest grew by a third, and unreachable chests and
exits went from seven to zero.

## How the picture works

The frame pipeline: ground → liquid glints → decals → Y-sorting (shadows, props,
creatures) → projectiles → particles → light (multiply) → bloom (additive) →
weather → two-tone grading → vignette → interface.

- **Tiles** are generated in 5×5 blocks (rocks in 8×8) and sampled at `(x%n, y%n)`,
  so the pattern flows across tile boundaries. Seams between ground types are
  dithered with a Bayer matrix **only along the shared edge**. The city's cobbles
  and the dungeon's floors are cellular noise with real joints between stones.
- **The large scale** is set by a separate lighting layer over the whole map. Its
  noise is domain-warped: plain value noise is aligned to a grid and reads as
  rectangular blocks.
- **Directional light**: an outline plus a rim highlight are baked into every
  sprite, while the shadow is drawn in real time — the silhouette, offset and
  squashed. In the dungeon the sun is different: the shadow sits almost underfoot.
- **Bloom** takes the bright places of the frame itself (a downscaled copy raised
  to the fourth power) and adds them back through two blur stages — torches, lava,
  magic and loot glow.
- **Motion**: trees, bushes and grass sway with a shear transform that grows
  towards the top; a tall object with the hero behind it becomes translucent.
- **Creatures** are not assembled from flat shapes: the basic brick is a "sphere"
  of four layers of ellipses offset towards the light. On beasts the far pair of
  legs is a shade darker than the near one; on golems the torso is built from
  overlapping fragments with a light top edge and a dark bottom one (the
  arrangement is seeded deterministically, otherwise the stones would jitter).
- **Reflections**: an object right at the water's edge is drawn as an inverted
  copy sliced into horizontal bands offset by a sine — which gives ripples. It is
  clipped by the depth of the water strip beneath it.
- **Light shafts** in the catacombs are bands with gaps, so the shadow of the
  grate's bars reads without a separate darkening layer; dust turns in the beams.
  The tilt of the beam matches the direction of the shadows.

---

## Author

**[therealden4700](https://github.com/therealden4700)** — concept, code, art,
sound, balance.

© 2026 therealden4700. All rights reserved.

There is deliberately no licence file in the repository: looking at the code and
taking it apart is free, reusing it in your own projects needs a word first. If
that changes, a `LICENSE` will appear here.
