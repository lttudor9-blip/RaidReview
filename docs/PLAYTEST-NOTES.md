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

Status: documented only. To fix after the session.
