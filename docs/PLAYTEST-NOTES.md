# Playtest notes

Feedback from real play sessions. Log first, fix later.

## Playtest 1: teacher + son + friend, morning before class

| # | Where | What happened | Suspected cause (not yet verified) |
|---|---|---|---|
| 1 | Landing page | The class icons (crests) flash and pulse constantly | The crests stack two animations: an SVG glow drop-shadow plus a bobbing animation on the hero graphic (`.sa-node`) and the class cards. Repainting a filtered SVG every frame can flicker on Chromebooks. |
| 2 | Student class-select screen | Same crest flashing and pulsing | Same glow and animation stack on the hero-select cards. The screen may also be redrawn on every Firebase update. |
| 3 | Teacher lobby | Call signs flash | The squad list in the lobby (`renderLobbySquad`) is probably rebuilt from scratch on every room update, so names and crests redraw each time. |
| 4 | Student screen | Students need a full-screen toggle | Right now there's only a "press F11" tip. Add a full-screen button (Fullscreen API), probably on the student HUD and the join screen. |
| 5 | Medic healing | Picking a teammate to heal takes two clicks; it should take one | The squad list on the student screen (`renderSquad`) is probably rebuilt on every game update. If it redraws between press and release, the first click is lost and the student has to click again. Same root cause as #3. |
| 6 | Vault puzzle | **Student screens go blank** (puzzle can't be played) | **Confirmed:** empty slots are stored as `null`, and real Firebase drops nulls, so students receive `value: undefined`. `next/js/student/puzzle.js` checks `x.value !== null` and then crashes on `SYMBOLS[undefined].glyph`. Fix: check `x.value == null`. Also make `tests/e2e/mock-db.js` drop nested nulls the way Firebase does, so tests catch this class of bug. Workaround for now: use Boss Rush. |

Status: **all 6 fixed.**

What was really going on:
- **Flashing (#1–#3):** the projector re-sent its clock value 4 times a second. Every update made each screen rebuild its lists, including fresh copies of every crest, each with a live glow filter. Changes:
  - The clock is now sent every few seconds.
  - Lists only redraw when something in them actually changed (`setHTML` in `ui.js`).
  - The crest glow is now a cheap painted halo instead of a filter.
  - The badges that pulsed nonstop are now still.
- **Full screen (#4):** there's a full-screen button on every student screen and in the projector controls.
- **Heal clicks (#5):** picking a teammate now registers on press, so it takes one tap even if the list refreshes mid-tap.
- **Vault blank (#6):** fixed. The same Firebase "drops empty values" behavior would also have crashed student screens in the final boss's Last Stand and in "every class" role calls. Those are fixed too. The test database now drops empty values the way Firebase does, so this kind of bug is caught before release.

## Playtest 2: full class, Regular difficulty

**Result:** the class **beat Regular**, with lots of talking and communicating.

| # | Where | What happened | Fix |
|---|---|---|---|
| 7 | Landing page | The class icons were still flashing and "tweaking out" after the first fix | The real cause was website-only effects that are known to flicker on Chromebook graphics chips: a blurred see-through nav bar (`backdrop-filter`), a fixed background, and nonstop animations under them (spinning rings, flowing dashes, floating crests). Removed all three. The hero graphic is now static. Devices set to "reduce motion" get calm screens everywhere. |

**Puzzles:** students really liked them. They failed the first time, learned from their mistakes, and solved it on the next try. This is the loop we want: failing should teach, not just punish.

**Feature requests from students:**
1. A puzzle after every boss
2. More team synergies and combos
3. Leaderboards
4. Loot drops, or a class vote on an upgrade, skill-tree perk or power-up after each wave
5. More boss mechanics (done: Weak Spot, Sniper Mark, Repair Drones, Silence, Elemental Shield)

**Teacher feedback:** the bosses felt like health sponges, even with the upgrades.

| # | Where | What happened | Fix |
|---|---|---|---|
| 8 | Boss fights | Fights dragged on, about twice as long as intended at a real classroom pace | Boss HP is cut about in half, and there are more burst moments: a stagger at 50% on bosses 2 and 3, bigger role-call chunks, and a Last Stand win that takes 15% of the final boss's HP. Then new mechanics that speed fights up when the squad talks: Weak Spot, Sniper Mark, Repair Drones, Silence and Elemental Shield (see REBUILD.md). Typical fights now last 0:50 / 1:20 / 1:30 / 3:00. |

## Playtest 3: full classes with the new boss mechanics

| # | Where | What happened | Fix |
|---|---|---|---|
| 9 | Student screen | Some students couldn't see the bottom answers | **Confirmed:** at real Chromebook window sizes (browser bars, 125% display zoom) the answers ran past the bottom of the screen; on a 1366×650 window, answers C and D sat 100px below the edge. The screen now gives the answers room first: the boss picture shrinks or hides, at most two banners show (one on tiny screens), and spacing tightens on short screens. New check: `npm run e2e:layout` loads a real student screen at five window sizes with the worst case on screen at once and fails if any answer is cut off, covered or untappable. |
| 10 | Student screen | Popups covered the question | The achievement card sat right on top of the question. Achievements and toasts now pop up in the bottom-right corner over the squad list, and the big center text is smaller on short screens and stays inside the boss area. |
| 11 | Student screen | Questions switched to a different one before the student answered | **Confirmed:** getting knocked down or revived threw away the current question and dealt a new one. If it happened while the "wrong answer" result was showing, a timer swapped the question again 1.7s later. Every screen redraw also faded the answers out and back in. Now the current question stays until it's answered, the timer can't replace a question it doesn't own, and a redraw never re-fades answers that were already showing. |
