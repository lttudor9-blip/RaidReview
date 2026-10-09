# Raid Review — Rebuild Plan

Raid Review is being rebuilt from the ground up (Dark Zone excluded). The current
game stays live at the site root until the new one, built in `next/`, is ready
and the teacher says "switch".

## What must keep working (contracts)

| Contract | Detail |
|---|---|
| Teacher accounts | Firebase Auth on project `raid-review-d6ad0`, app name `raidreview` (auth persists across pages by app name) |
| Saved BattleSets | `battleSets/{uid}/{setId}` = `{ id, title, created, modified, questions: [{ text, answers[], correct, type: 'mc' \| 'tf' }] }` |
| Dark Zone launch | dashboard writes `localStorage.rr_launch_questions` + `rr_launch_set_title`, then opens `darkzone.html?host=1` |
| Dark Zone join | room lookup in the Dark Zone project at `darkzone/{code}`, then `darkzone.html?name=…&room=…` |
| Live game data | `games/{code}` in the Raid Review database; students only write under `games/{code}/players/{theirId}` (security rules — to confirm) |

## Game design goals

1. **Talk to win.** Mixed teams beat mono-class teams by a visible margin; the boss
   demands specific classes at specific moments; raid stages between bosses can't
   be solved by one person.
2. **Learning first.** Accuracy beats speed. Every miss shows the right answer.
   Teachers get a per-question report and can re-run the most-missed questions.
3. **Every class matters every minute.** No class whose turn is "press heal and wait".
4. **Readable from the back row.** Projector screen tells the story; phones/Chromebooks
   are controllers.

### Core loop (per student)
Answer a question → on a correct answer, choose an action → effects resolve on the
host → repeat. Wrong answers cost a little HP and show the right answer.

### Team systems
- **Synergy:** each different class that acts within a rolling window raises a team
  multiplier (1 class ×1.0 → 4 classes ×1.5), shown big on the projector.
- **Class combos:** specific pairings trigger named combos (e.g. Tactician *Expose* →
  Warrior hits for a crit; Guardian *Fortify* → next boss attack is reflected).
- **Boss role calls:** some boss attacks require a class to respond in time
  ("GUARDIANS — RAISE SHIELDS: 0/3"). Success negates the attack; failure hurts everyone.

### Raid structure
`Boss → Raid Stage → Boss → Raid Stage → Boss → Final Boss`, built from
swappable *stages*. First raid stages: split-information puzzles where each
class/student sees one piece of the answer, so the class must communicate.

### Balance
All numbers live in one config file and run through a headless simulator
(`tests/sim`) that plays thousands of raids with simulated classes and accuracies,
so tuning is measured instead of guessed.

## Architecture (no build step, plain ES modules)

```
next/
  index.html            landing page + teacher sign-in + dashboard + BattleSet creator
  play.html             game shell (host when ?host=1, student otherwise)
  css/                  design system (no Tailwind CDN)
  js/
    firebase.js         one Firebase init + small data helpers
    content/            classes, bosses, stages, difficulty — all tunable numbers
    rules/              pure game rules (damage, synergy, combos, phases) — unit tested
    host/               director (stage timeline), arena, cinematics, end screen
    student/            controller screens: join, class select, tutorial, questions, actions
    stages/             boss fight, raid puzzles, celebration — one file each
    teacher/            auth, dashboard, BattleSet editor, bulk import
    ui/ audio/          shared components, procedural music + sfx
bosses.js               code-drawn bosses (shared with the current game)
tests/                  rules unit tests, balance simulator, end-to-end harness (mock Firebase)
```

**Host-authoritative:** students send *intents* (answered Q, chose action X on target Y)
into their own player node; the host applies the rules and writes results. One source
of truth, harder to cheat, all game logic in one place.

## Milestones

1. **Foundation** — folder layout, design system, Firebase module, rules engine + tests,
   mock-Firebase end-to-end harness.
2. **Core raid** — join, class select, interactive tutorial, MC + True/False questions,
   actions, synergy + combos, boss fights with role calls, lives/revive, end screen + report.
3. **Raid stages** — stage timeline + first two communication puzzles.
4. **Teacher side** — new landing page, sign-in, dashboard, BattleSet creator with bulk
   paste/CSV import and preview; Dark Zone launch preserved.
5. **Balance + polish** — simulator-driven tuning, audio, accessibility, Chromebook perf.
6. **Switch** — `next/` becomes the site root; old version archived in `legacy/`.

## Milestone 3 notes: soundtrack, raid puzzles, balance

**Soundtrack** (`next/js/audio.js`). Everything is synthesized in code: no files to load or license. The projector plays the music and student Chromebooks only play sound effects.
- **Boss themes:** each boss has its own theme. Layers come in as the boss loses HP.
- **Phase changes:** ENRAGED and DESPERATE arrive on the next bar, after a one-bar build.
- **Stingers:** ultimates, combos, hero moments, boss kills and wipes trigger a hit that lands on the beat.
- **Puzzle track:** a separate track whose ticking clock speeds up as time runs out.
- **Listening and checking:** `npm run audio` renders demo clips to `tests/audio/out/` and prints loudness and clipping stats.

**Raid puzzles** (`next/js/rules/puzzles.js`, `next/js/content/puzzles.js`). These are pure rules with tests in `tests/puzzles.test.mjs`.
- **The Vault:** each class holds the clue for a slot that another class enters. A wrong code is a strike.
- **Reactor Core:** only the intel class sees the order, and a wrong press resets the round.
- **Failing:** three strikes, or the timer running out, fails the puzzle.
- **Stakes:**

  | Result | Effect |
  | --- | --- |
  | Solved | Full heal, plus a bonus against the next boss |
  | Failed | No heal, and the next boss is tougher (`state.nextMods`, applied in `startBoss`) |

**Balance.** The goal is that squads which talk to each other win and squads which don't, wipe. Run `npm run sim` (40 runs per scenario) to check. The simulator assumes about 12 seconds per answer, a realistic classroom pace. The current results (after the "anti-sponge" pass, see below):

| Scenario | Difficulty | Win rate |
| --- | --- | --- |
| Good teamwork | Regular | ~95% |
| So-so teamwork | Regular | ~70% |
| Poor teamwork | Regular | ~5% |
| All Warriors | Regular | 0% |
| 6 students | Regular | ~65% |
| Struggling class | Elementary | ~55% |
| Strong class | Heroic | ~48% |

**Anti-sponge pass (after playtest 2).** The teachers said the bosses felt like health sponges. At a real classroom pace, fights were running about twice as long as intended. Changes:
- Boss HP is cut about in half (5000 / 9000 / 10500 / 22000 per player), and the timers are shorter to match.
- Bosses 2 and 3 now stagger at 50% too, like the Raider: a burst window where every class hits it.
- A met role call takes 8% of the boss's HP.
- Winning the Last Stand takes 15% of the final boss's HP.
- Boss damage is tuned so the shorter fights still need teamwork.

Typical fight lengths, Regular difficulty, good teamwork:

| Boss | Fight length |
| --- | --- |
| Raider | ~75s |
| Enforcer | ~90s |
| Construct | ~2 min |
| Omega | ~3 min |

Running out of time matters. The boss enrages when the timer ends, then gets stronger every 20 seconds.

## Boss arc v2 and chaos mode

Health bars stay short. The challenge comes from each boss's mechanics, and each boss teaches one thing:

| # | Boss | Lesson | Mechanics |
| --- | --- | --- | --- |
| 1 | Raider | Warm-up | One easy Guardian role call. At 50% the boss staggers: stunned and Exposed, and every class hits it for full synergy. |
| 2 | Enforcer | Protect the weak | Rail Shot hits the students with the lowest HP. Two classes get role calls. |
| 3 | Construct | The virus | Infection spreads every 6s. Infected students stop charging their ultimate. Medics cure it, and a Guardian shield quarantines it. If 40% of the squad is infected, SYSTEM OVERLOAD hits everyone. |
| 4 | Omega | The final test | A mix of everything. At 60%, Phase 2 forces the Extinction Wave (an ALL call). At 25%, the Last Stand: ultimates refill, and every class still standing must fire its ultimate before the countdown ends, or ANNIHILATION lands. |

**Chaos mode** is the teacher toolbar during fights. Each tool has its own cooldown:
- Meteor Strike
- Shield Drain
- Patient Zero
- Air Strike
- Supply Drop
- Reward: +35% ultimate for one class

The rules are in `chaos()` in `next/js/rules/engine.js`. The tests are in `tests/bosses.test.mjs`.

## Loot drop (upgrade vote)

After every boss except the last, each class votes on one of three upgrades from its own pool of five. The winning upgrade lasts for the rest of the raid, so by the final boss each class has a three-upgrade "build".

Where things live:
- **Upgrade list:** `next/js/content/perks.js`
- **Vote rules:** `next/js/rules/perks.js` (offer, vote, tally, winners, grant)
- **Upgrade effects:** wired into `next/js/rules/engine.js` through `hasPerk()`
- **Screens:** the projector loot screen is in `next/js/host/host.js`, and the student vote screen is `next/js/student/loot.js`
- **Tests:** `tests/perks.test.mjs`
