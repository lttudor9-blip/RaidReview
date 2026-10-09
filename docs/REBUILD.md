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

**Balance.** The goal is that squads which talk to each other win and squads which don't, wipe. Run `npm run sim` (40 runs per scenario) to check. The current results:

| Scenario | Difficulty | Win rate |
| --- | --- | --- |
| Good teamwork | Regular | ~100%, with the final boss close to its timer |
| So-so teamwork | Regular | ~78% |
| Poor teamwork | Regular | ~0% |
| All Warriors | Regular | ~35% |
| 6 students | Regular | ~80% |
| Struggling class | Elementary | ~60% |
| Strong class | Heroic | ~75% |

Running out of time matters. The boss enrages when the timer ends, then gets stronger every 20 seconds.
