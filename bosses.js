// ============================================================
// RAID REVIEW — Boss Renderer
// Every boss is drawn in code on a <canvas>; no image files.
//
//   const boss = BossRenderer.create(canvasEl, 'raider');
//   boss.setPhase('ENRAGED');      // NORMAL | ENRAGED | DESPERATE
//   boss.setHealth(0.4);           // 0..1, drives battle damage (cracks)
//   boss.hit(1500, { crit: true }); // flash + recoil + sparks
//   boss.windUp(4000);             // telegraph an attack over 4s
//   boss.release();                // the attack lands
//   boss.die(() => {...});         // boss-specific death, then callback
//   boss.destroy();
//
// Boss types: raider, enforcer, construct, omega
// ============================================================
(function () {
    const TAU = Math.PI * 2;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const lerp = (a, b, t) => a + (b - a) * t;
    const easeOut = t => 1 - Math.pow(1 - t, 3);
    const rand = (a, b) => a + Math.random() * (b - a);

    function hexToRgb(hex) {
        const n = parseInt(hex.slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    function rgba(hex, a) {
        const [r, g, b] = hexToRgb(hex);
        return `rgba(${r},${g},${b},${a})`;
    }
    function mix(hexA, hexB, k) {
        const a = hexToRgb(hexA), b = hexToRgb(hexB);
        const c = a.map((v, i) => Math.round(lerp(v, b[i], k)));
        return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
    }
    function seeded(seed) {
        return function () {
            seed |= 0; seed = seed + 0x6D2B79F5 | 0;
            let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    // ---------- drawing helpers ----------
    function poly(c, pts) {
        c.beginPath();
        c.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
        c.closePath();
    }
    function rrect(c, x, y, w, h, r) {
        c.beginPath();
        c.moveTo(x + r, y);
        c.arcTo(x + w, y, x + w, y + h, r);
        c.arcTo(x + w, y + h, x, y + h, r);
        c.arcTo(x, y + h, x, y, r);
        c.arcTo(x, y, x + w, y, r);
        c.closePath();
    }
    function lin(c, x0, y0, x1, y1, stops) {
        const g = c.createLinearGradient(x0, y0, x1, y1);
        stops.forEach(([o, col]) => g.addColorStop(o, col));
        return g;
    }
    function rad(c, x, y, r0, r1, stops) {
        const g = c.createRadialGradient(x, y, r0, x, y, r1);
        stops.forEach(([o, col]) => g.addColorStop(o, col));
        return g;
    }
    function fillStroke(c, fill, stroke, lw) {
        c.fillStyle = fill; c.fill();
        if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw || 4; c.stroke(); }
    }
    // Soft glow that does not depend on shadowBlur (cheap on Chromebooks)
    function glowDot(c, x, y, r, hex, a) {
        c.save();
        c.globalCompositeOperation = 'lighter';
        c.fillStyle = rad(c, x, y, 0, r, [[0, rgba(hex, a)], [0.4, rgba(hex, a * 0.35)], [1, rgba(hex, 0)]]);
        c.fillRect(x - r, y - r, r * 2, r * 2);
        c.restore();
    }
    function neonStroke(c, hex, width, a) {
        c.save();
        c.globalCompositeOperation = 'lighter';
        c.strokeStyle = rgba(hex, 0.18 * a); c.lineWidth = width * 4; c.stroke();
        c.strokeStyle = rgba(hex, 0.35 * a); c.lineWidth = width * 2; c.stroke();
        c.strokeStyle = rgba(mix(hex, '#ffffff', 0.5), a); c.lineWidth = width; c.stroke();
        c.restore();
    }
    function rivets(c, pts, r, col) {
        c.fillStyle = col || '#1a1a1f';
        for (let i = 0; i < pts.length; i += 2) {
            c.beginPath(); c.arc(pts[i], pts[i + 1], r, 0, TAU); c.fill();
        }
    }

    // Gives a flat shape depth: lit rim on the upper-left inside edge,
    // shadow on the lower-right, then a bold outline that reads on a projector.
    function shade(c, pathFn, fill, o = {}) {
        const rw = o.rimW || 14;
        pathFn(); c.fillStyle = fill; c.fill();
        c.save();
        pathFn(); c.clip();
        c.save(); c.translate(rw * 0.5, rw * 0.7); pathFn();
        c.strokeStyle = rgba(o.rim || '#ffffff', o.rimA ?? 0.25); c.lineWidth = rw; c.stroke();
        c.restore();
        c.save(); c.translate(-rw * 0.8, -rw * 1.1); pathFn();
        c.strokeStyle = `rgba(0,0,0,${o.darkA ?? 0.45})`; c.lineWidth = rw * 2.2; c.stroke();
        c.restore();
        c.restore();
        pathFn();
        c.lineJoin = 'round';
        c.strokeStyle = o.outline || '#000000'; c.lineWidth = o.lw || 7; c.stroke();
    }

    // ============================================================
    // BOSS DESIGNS — local coords, origin at the boss's center,
    // roughly -350..350 wide and -340..340 tall.
    // s = live state, fx(kind, x, y, opts) = particle emitter
    // ============================================================
    const DESIGNS = {};

    // ---------- WAVE 1: WASTELAND RAIDER ----------
    // A scrap-built marauder with a gas mask and a buzzsaw arm.
    DESIGNS.raider = {
        name: 'WASTELAND RAIDER', color: '#ff4757', deathStyle: 'explode',
        hitColor: '#ffa502',
        idle(s, fx, dt) {
            const rate = 3 + s.enr * 6 + s.wind * 10;
            for (const side of [-1, 1]) {
                if (Math.random() < rate * dt) {
                    fx('smoke', side * 150 + rand(-8, 8), -300, { vx: side * rand(5, 25), vy: rand(-90, -50), size: rand(14, 24), life: rand(1.4, 2.2), color: s.wind > 0.5 ? '#3a2a22' : '#55505a' });
                }
                if (s.wind > 0.3 && Math.random() < s.wind * 25 * dt) {
                    fx('ember', side * 150 + rand(-6, 6), -300, { vx: rand(-20, 20), vy: rand(-220, -120), size: rand(3, 6), life: rand(0.4, 0.8), color: '#ffa502' });
                }
            }
        },
        attack(s, fx) {
            const tip = this._sawCenter(s);
            for (let i = 0; i < 60; i++) {
                const a = rand(-Math.PI, 0);
                const v = rand(200, 700);
                fx('spark', tip.x, tip.y + 60, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 900, size: rand(2, 4), life: rand(0.3, 0.7), color: i % 2 ? '#ffa502' : '#ffffff' });
            }
            for (let i = 0; i < 10; i++) fx('smoke', tip.x + rand(-60, 60), tip.y + 80, { vx: rand(-80, 80), vy: rand(-60, -20), size: rand(20, 34), life: rand(1, 1.6), color: '#5a4a40' });
        },
        _armAngle(s) {
            return lerp(-0.42, -2.25, easeOut(s.wind)) + s.atk * 1.9 + Math.sin(s.t * 1.7) * 0.04;
        },
        _sawCenter(s) {
            const a = this._armAngle(s);
            return { x: 190 - Math.sin(a) * 235, y: -70 + Math.cos(a) * 235 };
        },
        draw(c, s, fx) {
            const t = s.t, w = s.wind, br = Math.sin(t * 2.2);
            const eyeHex = mix('#ff4757', '#ffe0e0', w * 0.6);

            // exhaust stacks
            for (const side of [-1, 1]) {
                c.save();
                c.translate(side * 150, -150);
                c.rotate(side * 0.12);
                rrect(c, -18, -150, 36, 160, 6);
                fillStroke(c, lin(c, -18, 0, 18, 0, [[0, '#2a2a30'], [0.5, '#6a6a75'], [1, '#2a2a30']]), '#0e0e12', 4);
                rrect(c, -24, -158, 48, 20, 4);
                fillStroke(c, '#3a3a42', '#0e0e12', 4);
                if (w > 0.2) {
                    c.save(); c.globalCompositeOperation = 'lighter';
                    c.fillStyle = rad(c, 0, -170, 0, 50 + w * 30, [[0, rgba('#fff3c4', w)], [0.35, rgba('#ffa502', w * 0.8)], [1, rgba('#ff4757', 0)]]);
                    c.beginPath(); c.ellipse(0, -185 - w * 20, 22 + w * 8, 45 + w * 30, 0, 0, TAU); c.fill();
                    c.restore();
                }
                c.restore();
            }

            c.save();
            c.translate(0, br * 3);

            // left arm (viewer's left) — hanging spiked fist
            c.save();
            c.translate(-190, -60);
            c.rotate(0.18 + Math.sin(t * 1.3) * 0.05 - s.atk * 0.2);
            rrect(c, -36, 0, 72, 150, 30);
            fillStroke(c, lin(c, -36, 0, 36, 0, [[0, '#3a3a44'], [0.5, '#6a6a78'], [1, '#2a2a32']]), '#0e0e12', 5);
            rrect(c, -42, 140, 84, 90, 22);
            fillStroke(c, lin(c, 0, 140, 0, 230, [[0, '#8a4b2a'], [1, '#4a2414']]), '#1a0d08', 5);
            for (let i = 0; i < 4; i++) {
                poly(c, [-34 + i * 22, 230, -24 + i * 22, 262, -14 + i * 22, 230]);
                fillStroke(c, '#c9ccd3', '#2a2a30', 3);
            }
            // chain wrap
            c.strokeStyle = '#9a9aa5'; c.lineWidth = 6;
            for (let i = 0; i < 4; i++) { c.beginPath(); c.ellipse(0, 165 + i * 15, 44, 8, 0, 0, Math.PI); c.stroke(); }
            c.restore();

            // torso
            poly(c, [-195, -95, 195, -95, 155, 120, 115, 300, -115, 300, -155, 120]);
            fillStroke(c, lin(c, 0, -95, 0, 300, [[0, '#b0653a'], [0.45, '#7a3c1e'], [1, '#3a1a0c']]), '#1a0d08', 7);
            // scrap plates
            c.save();
            poly(c, [-195, -95, 195, -95, 155, 120, 115, 300, -115, 300, -155, 120]);
            c.clip();
            c.fillStyle = 'rgba(0,0,0,0.18)';
            for (let i = 0; i < 4; i++) { rrect(c, -150 + (i % 2) * 20, 140 + i * 38, 300, 30, 6); c.fill(); }
            // hazard stripe band
            c.save();
            rrect(c, -175, 40, 350, 48, 4); c.clip();
            c.fillStyle = '#ffa502'; c.fillRect(-175, 40, 350, 48);
            c.fillStyle = '#16120c';
            for (let x = -220; x < 220; x += 44) { poly(c, [x, 88, x + 22, 88, x + 52, 40, x + 30, 40]); c.fill(); }
            c.restore();
            c.restore();
            // welded patch
            c.save(); c.translate(-80, -30); c.rotate(-0.12);
            rrect(c, -50, -40, 100, 70, 6);
            fillStroke(c, lin(c, 0, -40, 0, 30, [[0, '#7c7c88'], [1, '#45454f']]), '#15151a', 4);
            rivets(c, [-40, -30, 40, -30, -40, 20, 40, 20], 5);
            c.restore();
            // chest skull emblem (spray paint)
            c.save(); c.translate(70, -20); c.globalAlpha = 0.85;
            c.fillStyle = '#e8e2d4';
            c.beginPath(); c.arc(0, 0, 26, 0, TAU); c.fill();
            c.fillRect(-14, 18, 28, 16);
            c.fillStyle = '#2a120a';
            c.beginPath(); c.arc(-9, -2, 7, 0, TAU); c.arc(9, -2, 7, 0, TAU); c.fill();
            c.restore();
            rivets(c, [-170, -80, 170, -80, -130, 290, 130, 290, 0, 115], 6);

            // head
            c.save();
            c.translate(0, -165 + br * 2);
            c.rotate(Math.sin(t * 0.9) * 0.04 + s.look * 0.05 - w * 0.08);
            // mohawk blades
            for (let i = 0; i < 5; i++) {
                const x = -48 + i * 24, h = [70, 95, 115, 95, 70][i];
                poly(c, [x - 13, -78, x, -78 - h, x + 13, -78]);
                fillStroke(c, lin(c, x, -78, x, -78 - h, [[0, '#4a4a55'], [1, '#d6d8de']]), '#15151a', 4);
            }
            rrect(c, -82, -92, 164, 158, 34);
            fillStroke(c, lin(c, 0, -92, 0, 66, [[0, '#5a5a66'], [1, '#26262e']]), '#0e0e12', 6);
            // visor slit
            rrect(c, -64, -46, 128, 30, 12);
            fillStroke(c, '#140406', '#050102', 4);
            const eyePulse = 0.65 + Math.sin(t * 3.2) * 0.2 + w * 0.6;
            const ex = s.look * 14;
            rrect(c, -56 + ex, -38, 112, 14, 7);
            c.fillStyle = rgba(eyeHex, clamp(eyePulse, 0, 1)); c.fill();
            glowDot(c, -26 + ex, -31, 40 + w * 30, eyeHex, 0.7 * eyePulse);
            glowDot(c, 26 + ex, -31, 40 + w * 30, eyeHex, 0.7 * eyePulse);
            // gas mask snout + filters
            rrect(c, -46, 0, 92, 62, 18);
            fillStroke(c, lin(c, 0, 0, 0, 62, [[0, '#3a3a44'], [1, '#18181e']]), '#0a0a0e', 5);
            c.strokeStyle = '#0a0a0e'; c.lineWidth = 4;
            for (let i = 0; i < 4; i++) { c.beginPath(); c.moveTo(-30, 14 + i * 12); c.lineTo(30, 14 + i * 12); c.stroke(); }
            for (const side of [-1, 1]) {
                c.beginPath(); c.arc(side * 74, 36, 30, 0, TAU);
                fillStroke(c, rad(c, side * 70, 30, 4, 32, [[0, '#8a8a96'], [1, '#2a2a32']]), '#0a0a0e', 5);
                c.beginPath(); c.arc(side * 74, 36, 14, 0, TAU); fillStroke(c, '#141418');
            }
            c.restore();

            // right arm — buzzsaw
            const ang = this._armAngle(s);
            c.save();
            c.translate(190, -70);
            c.rotate(ang);
            rrect(c, -38, 0, 76, 150, 30);
            fillStroke(c, lin(c, -38, 0, 38, 0, [[0, '#3a3a44'], [0.5, '#6a6a78'], [1, '#2a2a32']]), '#0e0e12', 5);
            rrect(c, -22, 130, 44, 110, 10);
            fillStroke(c, '#8a4b2a', '#1a0d08', 4);
            // saw blade
            c.save();
            c.translate(0, 235);
            const spin = t * (5 + w * 22 + s.enr * 4);
            c.rotate(spin);
            const R = 112, teeth = 18;
            c.beginPath();
            for (let i = 0; i < teeth; i++) {
                const a0 = (i / teeth) * TAU, a1 = ((i + 0.6) / teeth) * TAU, a2 = ((i + 1) / teeth) * TAU;
                c.lineTo(Math.cos(a0) * (R - 14), Math.sin(a0) * (R - 14));
                c.lineTo(Math.cos(a1) * (R + 10), Math.sin(a1) * (R + 10));
                c.lineTo(Math.cos(a2) * (R - 14), Math.sin(a2) * (R - 14));
            }
            c.closePath();
            fillStroke(c, rad(c, 0, 0, 20, R + 10, [[0, '#f2f3f6'], [0.7, '#a8acb6'], [1, '#5a5e68']]), '#2a2a30', 4);
            c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 6;
            for (let i = 0; i < 6; i++) {
                const a = (i / 6) * TAU;
                c.beginPath(); c.arc(0, 0, 70, a, a + 0.6); c.stroke();
            }
            c.beginPath(); c.arc(0, 0, 34, 0, TAU);
            fillStroke(c, '#2a2a32', '#ff4757', 6);
            c.restore();
            // motion blur ring when spinning hard
            if (w > 0.2) {
                c.beginPath(); c.arc(0, 235, R + 4, 0, TAU);
                neonStroke(c, '#ffa502', 3, w * 0.8);
            }
            c.restore();
            // shoulder pauldrons (drawn over arms)
            for (const side of [-1, 1]) {
                c.save(); c.translate(side * 188, -82);
                c.beginPath(); c.ellipse(0, 0, 88, 62, side * 0.25, Math.PI, TAU); c.closePath();
                fillStroke(c, lin(c, 0, -62, 0, 0, [[0, '#c0703f'], [1, '#5a2a14']]), '#1a0d08', 6);
                for (let i = 0; i < 3; i++) {
                    const x = side * (-40 + i * 40);
                    poly(c, [x - 13, -42 + Math.abs(i - 1) * 10, x + side * 14, -110 + Math.abs(i - 1) * 22, x + 13, -42 + Math.abs(i - 1) * 10]);
                    fillStroke(c, lin(c, x, -40, x, -110, [[0, '#55555f'], [1, '#e2e4ea']]), '#15151a', 4);
                }
                c.restore();
            }
            c.restore();

            // saw sparks while winding up
            if (w > 0.25 && Math.random() < w * 40 / 60) {
                const p = this._sawCenter(s);
                const a = rand(0, TAU);
                fx('spark', p.x + Math.cos(a) * 115, p.y + Math.sin(a) * 115, { vx: -Math.sin(a) * 500, vy: Math.cos(a) * 500, g: 700, size: 2.5, life: 0.35, color: '#ffd28a' });
            }
        }
    };

    // ---------- WAVE 2: ELITE ENFORCER ----------
    // A riot-armored peacekeeper: T-visor, shield, charging rail rifle.
    DESIGNS.enforcer = {
        name: 'ELITE ENFORCER', color: '#ffa502', deathStyle: 'glitch',
        hitColor: '#ffd28a',
        idle(s, fx, dt) {
            if (s.wind > 0.2 && Math.random() < s.wind * 30 * dt) {
                const m = this._muzzle(s);
                const a = rand(0, TAU), d = rand(60, 110);
                fx('ember', m.x + Math.cos(a) * d, m.y + Math.sin(a) * d, { vx: -Math.cos(a) * d * 3, vy: -Math.sin(a) * d * 3, size: 3, life: 0.3, color: '#ffd28a' });
            }
        },
        attack(s, fx) {
            const m = this._muzzle(s);
            fx('flash', m.x, m.y, { size: 220, life: 0.25, color: '#ffd28a' });
            fx('ring', m.x, m.y, { size: 30, grow: 240, life: 0.45, color: '#ffa502' });
            for (let i = 0; i < 40; i++) {
                const a = this._aim(s) + rand(-0.35, 0.35), v = rand(500, 1200);
                fx('spark', m.x, m.y, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, size: rand(2, 4), life: rand(0.2, 0.45), color: i % 3 ? '#ffa502' : '#ffffff' });
            }
            for (let i = 0; i < 3; i++) fx('shard', 230, -10, { vx: rand(80, 220), vy: rand(-380, -220), g: 1200, vr: rand(-15, 15), size: 10, life: 1, color: '#d4a64a' });
        },
        _aim(s) { return -0.32 + Math.sin(s.t * 0.8) * 0.04 + lerp(0, 0.5, easeOut(s.wind)) - s.atk * 0.35; },
        _muzzle(s) {
            const a = this._aim(s);
            return { x: 205 + Math.cos(a) * 330, y: 40 + Math.sin(a) * 330 };
        },
        draw(c, s) {
            const t = s.t, w = s.wind, br = Math.sin(t * 1.8);
            const glowHex = mix('#ffa502', '#ff4757', s.enr * 0.6);
            const blink = (Math.sin(t * 4) > 0.6) ? 1 : 0.25;

            c.save();
            c.translate(0, br * 3);

            // back antennas
            for (const side of [-1, 1]) {
                c.beginPath(); c.moveTo(side * 120, -110); c.lineTo(side * 170, -300);
                c.strokeStyle = '#2a3346'; c.lineWidth = 8; c.stroke();
                glowDot(c, side * 170, -300, 24, glowHex, side === 1 ? blink : 1.25 - blink);
            }

            // torso
            const torso = [-205, -105, 205, -105, 172, 60, 92, 300, -92, 300, -172, 60];
            poly(c, torso);
            fillStroke(c, lin(c, 0, -105, 0, 300, [[0, '#33415f'], [0.5, '#1e2a44'], [1, '#0e1424']]), '#070a12', 7);
            c.save(); poly(c, torso); c.clip();
            // ab plates
            for (let i = 0; i < 3; i++) {
                rrect(c, -80 + i * 6, 130 + i * 52, 160 - i * 12, 40, 8);
                fillStroke(c, lin(c, 0, 130 + i * 52, 0, 170 + i * 52, [[0, '#4a5a7a'], [1, '#26324c']]), '#070a12', 4);
            }
            // chest plates
            poly(c, [-170, -95, -15, -95, -15, 90, -120, 60]);
            fillStroke(c, lin(c, -170, -95, -15, 90, [[0, '#6a7c9e'], [1, '#2c3956']]), '#070a12', 5);
            poly(c, [170, -95, 15, -95, 15, 90, 120, 60]);
            fillStroke(c, lin(c, 170, -95, 15, 90, [[0, '#5a6c8e'], [1, '#26324c']]), '#070a12', 5);
            c.restore();
            // glowing chevrons
            for (let i = 0; i < 3; i++) {
                c.beginPath(); c.moveTo(-60, 0 + i * 30); c.lineTo(0, 35 + i * 30); c.lineTo(60, 0 + i * 30);
                neonStroke(c, glowHex, 4, 0.5 + 0.5 * Math.sin(t * 3 - i * 0.8) + w * 0.5);
            }

            // head
            c.save();
            c.translate(0, -175 + br * 2);
            c.rotate(s.look * 0.05);
            rrect(c, -40, 30, 80, 45, 10); fillStroke(c, '#1a2238', '#070a12', 4);
            const helm = [-72, -95, 72, -95, 98, -30, 84, 40, 0, 72, -84, 40, -98, -30];
            poly(c, helm);
            fillStroke(c, lin(c, 0, -95, 0, 72, [[0, '#5d6f93'], [0.5, '#2c3956'], [1, '#141c30']]), '#070a12', 6);
            poly(c, [-72, -95, 0, -110, 72, -95, 40, -70, -40, -70]);
            fillStroke(c, '#7d8fb3', '#070a12', 4);
            // T visor
            const vis = clamp(0.7 + 0.25 * Math.sin(t * 2.5) + w * 0.5, 0, 1);
            const vx = s.look * 10;
            rrect(c, -66 + vx, -40, 132, 20, 6); c.fillStyle = '#05070c'; c.fill();
            rrect(c, -10 + vx, -40, 20, 76, 6); c.fill();
            rrect(c, -60 + vx, -36, 120, 12, 6); c.fillStyle = rgba(mix(glowHex, '#ffffff', w * 0.5), vis); c.fill();
            rrect(c, -5 + vx, -36, 10, 66, 5); c.fill();
            glowDot(c, vx, -30, 90 + w * 50, glowHex, 0.55 * vis);
            c.restore();

            // right arm + rail rifle
            const aim = this._aim(s);
            c.save();
            c.translate(205, 40);
            c.rotate(aim);
            rrect(c, -40, -32, 150, 64, 14);
            fillStroke(c, lin(c, 0, -32, 0, 32, [[0, '#3a4766'], [1, '#141c30']]), '#070a12', 5);
            rrect(c, 90, -24, 190, 48, 8);
            fillStroke(c, lin(c, 0, -24, 0, 24, [[0, '#4a5878'], [1, '#1a2238']]), '#070a12', 5);
            rrect(c, 270, -13, 60, 26, 5);
            fillStroke(c, '#2a3346', '#070a12', 4);
            for (let i = 0; i < 5; i++) {
                rrect(c, 120 + i * 28, -8, 16, 16, 3);
                c.fillStyle = rgba(glowHex, clamp(0.25 + w * 0.9 * ((Math.sin(t * 14 - i) + 1) / 2 + 0.3), 0, 1)); c.fill();
            }
            if (w > 0) {
                c.save(); c.globalCompositeOperation = 'lighter';
                c.beginPath(); c.moveTo(330, 0); c.lineTo(2000, 0);
                c.strokeStyle = rgba('#ff4757', w * 0.55); c.lineWidth = 3 + w * 3; c.stroke();
                c.restore();
                glowDot(c, 335, 0, 30 + w * 80, glowHex, w);
            }
            c.restore();

            // left arm + riot shield
            c.save();
            c.translate(-170, 30 + Math.sin(t * 1.2) * 6);
            c.rotate(-0.08 + s.atk * 0.08);
            rrect(c, -110, -150, 210, 330, 34);
            fillStroke(c, lin(c, -110, -150, 100, 180, [[0, '#4a5878'], [0.5, '#26324c'], [1, '#121a2c']]), '#070a12', 7);
            c.save(); rrect(c, -110, -150, 210, 330, 34); c.clip();
            c.strokeStyle = 'rgba(160,190,255,0.10)'; c.lineWidth = 2;
            for (let y = -170; y < 200; y += 34) {
                for (let x = -130; x < 120; x += 40) {
                    const ox = ((y / 34) & 1) ? 20 : 0;
                    c.beginPath();
                    for (let k = 0; k < 6; k++) { const a = k * TAU / 6; c.lineTo(x + ox + Math.cos(a) * 18, y + Math.sin(a) * 18); }
                    c.closePath(); c.stroke();
                }
            }
            c.restore();
            rrect(c, -80, -10, 150, 26, 6); c.fillStyle = '#ffa502'; c.fill();
            c.font = 'bold 22px sans-serif'; c.fillStyle = '#0e1424'; c.textAlign = 'center';
            c.fillText('ENFORCER', -5, 11);
            c.beginPath(); c.moveTo(-50, -90); c.lineTo(-5, -50); c.lineTo(40, -90);
            neonStroke(c, glowHex, 6, 0.8);
            c.restore();

            // pauldrons
            for (const side of [-1, 1]) {
                c.save(); c.translate(side * 195, -95);
                poly(c, [side * -70, -30, side * 30, -55, side * 95, -5, side * 85, 50, side * -50, 40]);
                fillStroke(c, lin(c, 0, -55, 0, 50, [[0, '#7d8fb3'], [1, '#26324c']]), '#070a12', 6);
                poly(c, [side * -50, 0, side * 70, -10, side * 75, 8, side * -45, 18]);
                c.fillStyle = '#ffa502'; c.fill();
                glowDot(c, side * 40, -30, 26, glowHex, side === 1 ? blink : 1.25 - blink);
                c.restore();
            }
            c.restore();
        }
    };

    // ---------- WAVE 3: APEX CONSTRUCT ----------
    // A floating AI core: one watching eye, spinning rings, orbiting shards.
    DESIGNS.construct = {
        name: 'APEX CONSTRUCT', color: '#a55eea', deathStyle: 'shatter',
        hitColor: '#d9b8ff',
        idle(s, fx, dt) {
            if (Math.random() < (4 + s.enr * 6) * dt) {
                fx('bit', rand(-260, 260), rand(-40, 220), { vx: rand(-10, 10), vy: rand(-70, -30), size: rand(4, 8), life: rand(1, 2), color: Math.random() < 0.5 ? '#a55eea' : '#4de1ff' });
            }
        },
        attack(s, fx) {
            fx('flash', 0, -40, { size: 360, life: 0.3, color: '#e6d4ff' });
            fx('ring', 0, -40, { size: 100, grow: 600, life: 0.6, color: '#a55eea' });
            fx('ring', 0, -40, { size: 80, grow: 420, life: 0.5, color: '#4de1ff' });
            for (let i = 0; i < 50; i++) {
                const a = rand(0, TAU), v = rand(300, 800);
                fx('bit', Math.cos(a) * 90, -40 + Math.sin(a) * 90, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, size: rand(4, 8), life: rand(0.4, 0.8), color: i % 2 ? '#a55eea' : '#4de1ff' });
            }
        },
        draw(c, s) {
            const t = s.t, w = s.wind;
            const main = mix('#a55eea', '#ff5a3d', s.enr * 0.7);
            const cyan = mix('#4de1ff', '#ffd28a', s.enr * 0.6);
            const fl = Math.sin(t * 1.3) * 14;
            c.save();
            c.translate(0, -40 + fl);
            c.scale(1.28, 1.28);

            const shardR = 270 + w * 70;
            const shards = [];
            for (let i = 0; i < 6; i++) {
                const a = i * TAU / 6 + t * (0.35 + w * 1.2) + (s.des > 0.5 ? Math.sin(t * 30 + i) * 0.03 : 0);
                const r = shardR + Math.sin(t * 2 + i * 1.7) * 12;
                shards.push({ x: Math.cos(a) * r, y: Math.sin(a) * r * 0.72, a });
            }

            // tendrils core -> shards
            c.save(); c.globalCompositeOperation = 'lighter';
            for (const p of shards) {
                if (Math.random() < 0.85) {
                    c.beginPath(); c.moveTo(0, 0);
                    const mx = p.x / 2 + rand(-18, 18), my = p.y / 2 + rand(-18, 18);
                    c.quadraticCurveTo(mx, my, p.x, p.y);
                    c.strokeStyle = rgba(cyan, 0.25 + w * 0.4); c.lineWidth = 2 + w * 2; c.stroke();
                }
            }
            c.restore();

            // rings
            const rings = [
                { r: 250, sq: 0.28, tilt: 0.35, sp: 0.6, segs: 6, col: main, lw: 12 },
                { r: 205, sq: 0.36, tilt: -0.55, sp: -0.9, segs: 4, col: cyan, lw: 8 },
                { r: 300, sq: 0.13, tilt: 0.05, sp: 0.3, segs: 12, col: main, lw: 6 }
            ];
            for (const rg of rings) {
                c.save();
                c.rotate(rg.tilt);
                c.scale(1, rg.sq);
                for (let i = 0; i < rg.segs; i++) {
                    const a0 = i * TAU / rg.segs + t * rg.sp * (1 + w * 4);
                    c.beginPath(); c.arc(0, 0, rg.r, a0, a0 + (TAU / rg.segs) * 0.68);
                    c.strokeStyle = rgba('#1a1028', 1); c.lineWidth = rg.lw + 6; c.stroke();
                    neonStroke(c, rg.col, rg.lw * 0.5, 0.7 + w * 0.3);
                }
                c.restore();
            }

            // shards
            for (const p of shards) {
                c.save();
                c.translate(p.x, p.y);
                c.rotate(Math.atan2(-p.y, -p.x) + (w > 0 ? Math.sin(t * 20) * 0.05 * w : 0));
                poly(c, [36, 0, -30, -26, -16, 0, -30, 26]);
                fillStroke(c, lin(c, -30, -26, 36, 26, [[0, '#2a1840'], [0.5, main], [1, '#f0e4ff']]), '#0c0614', 4);
                c.beginPath(); c.moveTo(36, 0); c.lineTo(-16, 0);
                neonStroke(c, cyan, 2, 0.8);
                c.restore();
            }

            // hex plates around core
            const open = 128 + w * 36 + s.atk * 30;
            for (let i = 0; i < 6; i++) {
                c.save();
                c.rotate(i * TAU / 6 - t * 0.25);
                poly(c, [open, -46, open + 34, -34, open + 34, 34, open, 46]);
                fillStroke(c, lin(c, open, 0, open + 34, 0, [[0, '#3a2458'], [1, '#160c24']]), '#08040e', 4);
                c.beginPath(); c.moveTo(open + 12, -24); c.lineTo(open + 12, 24);
                neonStroke(c, main, 3, 0.5 + 0.5 * Math.sin(t * 3 + i));
                c.restore();
            }

            // core sphere
            const coreR = 100;
            glowDot(c, 0, 0, 260 + w * 120, main, 0.5 + w * 0.4);
            c.beginPath(); c.arc(0, 0, coreR, 0, TAU);
            fillStroke(c, rad(c, -30, -35, 10, coreR, [[0, mix('#ffffff', main, 0.3 - w * 0.3)], [0.45, main], [1, '#1a0c2c']]), '#08040e', 6);
            // eye
            const ex = s.look * 24, ey = Math.sin(t * 0.6) * 10;
            c.beginPath(); c.arc(ex, ey, 48, 0, TAU);
            fillStroke(c, rad(c, ex, ey, 6, 48, [[0, '#ffffff'], [0.35, cyan], [1, '#0a0614']]), '#05020a', 5);
            c.strokeStyle = rgba('#05020a', 0.6); c.lineWidth = 2;
            for (let i = 0; i < 12; i++) {
                const a = i * TAU / 12 + t * 0.5;
                c.beginPath(); c.moveTo(ex + Math.cos(a) * 22, ey + Math.sin(a) * 22); c.lineTo(ex + Math.cos(a) * 44, ey + Math.sin(a) * 44); c.stroke();
            }
            const pw = lerp(13, 4, w);
            c.beginPath(); c.ellipse(ex, ey, pw, 30, 0, 0, TAU); c.fillStyle = '#05020a'; c.fill();
            glowDot(c, ex - 14, ey - 16, 18, '#ffffff', 0.9);
            c.restore();
        }
    };

    // ---------- WAVE 4: OMEGA WEAPON (final boss) ----------
    // An obsidian titan: horned three-eyed mask, double halo, blade wings,
    // tattered cloak, clawed gauntlets and a reactor heart. When ENRAGED its
    // armor plates blast loose and float, exposing the molten core beneath.
    DESIGNS.omega = {
        name: 'OMEGA WEAPON', color: '#ff2a3d', deathStyle: 'meltdown',
        hitColor: '#ffffff',
        _bob(s) { return 10 + Math.sin(s.t * 1.4) * 5; },
        _armAngle(s, side) {
            return lerp(-0.3, -0.45, easeOut(s.wind)) + s.atk * 0.5 + Math.sin(s.t * 1.2 + side) * 0.05;
        },
        _elbow(s) { return lerp(0.18, 1.85, easeOut(s.wind)) - s.atk * 0.4; },
        _hand(s, side) {
            const a = this._armAngle(s, side), b = a + this._elbow(s);
            const x = 268 - Math.sin(a) * 185 - Math.sin(b) * 175;
            const y = -60 + Math.cos(a) * 185 + Math.cos(b) * 175 + this._bob(s);
            return { x: side * x, y };
        },
        _wingTip(s, side, i) {
            const ang = this._wingAngle(s, i), L = this._wingLen(s, i);
            return { x: side * (130 + Math.cos(ang) * L), y: -120 + this._bob(s) + Math.sin(ang) * L };
        },
        _wingAngle(s, i) { return lerp(-1.5, -0.08, i / 4) * (1 + s.wind * 0.12) + Math.sin(s.t * 1.1 + i * 0.5) * 0.05; },
        _wingLen(s, i) { return 400 - i * 38 + s.wind * 50; },
        backdrop(c, s) {
            // burning sky that fades to nothing at the edges
            c.fillStyle = rad(c, 500, 560, 40, 560, [[0, rgba('#5a0a16', 0.55 + s.enr * 0.2)], [0.55, rgba('#24040a', 0.45)], [1, 'rgba(0,0,0,0)']]);
            c.fillRect(0, 0, 1000, 1000);
        },
        idle(s, fx, dt) {
            if (Math.random() < (7 + s.enr * 12 + s.wind * 20) * dt) {
                fx('ember', rand(-380, 380), rand(-60, 360), { vx: rand(-15, 15), vy: rand(-120, -50), size: rand(2, 5), life: rand(1.2, 2.4), color: Math.random() < 0.7 ? '#ff2a3d' : '#ffb020' });
            }
            // fire drips off the wing tips once enraged
            if (s.enr > 0.3 && Math.random() < s.enr * 10 * dt) {
                const side = Math.random() < 0.5 ? -1 : 1, i = Math.floor(rand(0, 5));
                const p = this._wingTip(s, side, i);
                fx('ember', p.x, p.y, { vx: rand(-20, 20), vy: rand(20, 80), g: 120, size: rand(3, 6), life: rand(0.6, 1.2), color: '#ffb020' });
            }
            // energy gathers into the hands and heart while winding up
            if (s.wind > 0.15) {
                for (const side of [-1, 1]) {
                    if (Math.random() < s.wind * 40 * dt) {
                        const h = this._hand(s, side), a = rand(0, TAU), d = rand(90, 170);
                        fx('ember', h.x + Math.cos(a) * d, h.y + Math.sin(a) * d, { vx: -Math.cos(a) * d * 3, vy: -Math.sin(a) * d * 3, drag: 1, size: 3, life: 0.32, color: '#ffffff' });
                    }
                }
                if (Math.random() < s.wind * 40 * dt) {
                    const a = rand(0, TAU), d = rand(140, 240);
                    fx('ember', Math.cos(a) * d, 130 + Math.sin(a) * d, { vx: -Math.cos(a) * d * 2.6, vy: -Math.sin(a) * d * 2.6, drag: 1, size: 3, life: 0.38, color: '#ff8a8a' });
                }
            }
        },
        attack(s, fx) {
            fx('flash', 0, 130, { size: 640, life: 0.45, color: '#ff8a8a' });
            fx('ring', 0, 130, { size: 80, grow: 900, life: 0.75, color: '#ff2a3d' });
            fx('ring', 0, 130, { size: 60, grow: 650, life: 0.55, color: '#ffffff' });
            for (const side of [-1, 1]) {
                const h = this._hand(s, side);
                fx('flash', h.x, h.y, { size: 300, life: 0.3, color: '#ffffff' });
            }
            for (let i = 0; i < 100; i++) {
                const a = rand(0, TAU), v = rand(400, 1200);
                fx('spark', 0, 130, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, size: rand(2, 5), life: rand(0.3, 0.8), color: i % 3 ? '#ff2a3d' : '#ffd28a' });
            }
        },
        phaseUp(s, fx, phase) {
            // armor blasts loose: chunks + fire
            for (let i = 0; i < 24; i++) {
                const side = i % 2 ? 1 : -1;
                fx('shard', side * rand(80, 260), rand(-120, 60), { vx: side * rand(150, 450), vy: rand(-450, -150), g: 1100, vr: rand(-10, 10), size: rand(12, 24), life: rand(0.8, 1.4), color: '#2a2630' });
            }
            fx('ring', 0, 0, { size: 120, grow: 700, life: 0.6, color: phase === 'DESPERATE' ? '#ffffff' : '#ffb020' });
        },
        draw(c, s) {
            const t = s.t, w = s.wind, e = s.enr, atk = s.atk;
            const RED = '#ff2a3d', GOLD = '#ffb020';
            const pulse = 0.5 + 0.5 * Math.sin(t * 3);
            const hot = mix(RED, '#ffffff', w * 0.5);
            const roar = Math.max(atk, w > 0.8 ? (w - 0.8) / 0.2 : 0);
            const obsidian = (y0, y1) => lin(c, 0, y0, 0, y1, [[0, '#3a3542'], [0.45, '#17141c'], [1, '#060508']]);
            const rimO = { rim: '#c9b6d8', rimA: 0.28, lw: 8, rimW: 16 };

            c.save();
            c.translate(0, this._bob(s));

            // ---- halo (two counter-rotating rings) ----
            c.save();
            c.translate(0, -290);
            const hr = 220 + w * 30;
            c.beginPath(); c.arc(0, 0, hr, 0, TAU);
            c.strokeStyle = '#0c0306'; c.lineWidth = 24; c.stroke();
            neonStroke(c, RED, 6, 0.7 + pulse * 0.3 + w * 0.4);
            c.save(); c.rotate(t * (0.35 + w * 3));
            for (let i = 0; i < 16; i++) {
                const a = i * TAU / 16;
                if (s.des > 0.5 && i % 5 === 0 && Math.random() < 0.5) continue; // broken, flickering runes
                c.save(); c.rotate(a); c.translate(hr, 0);
                rrect(c, -9, -16, 18, 32, 4);
                c.fillStyle = i % 4 ? '#2a0a10' : GOLD; c.fill();
                c.strokeStyle = '#000'; c.lineWidth = 3; c.stroke();
                c.restore();
            }
            c.restore();
            c.save(); c.rotate(-t * (0.6 + w * 4));
            for (let i = 0; i < 6; i++) {
                const a = i * TAU / 6;
                c.beginPath(); c.arc(0, 0, hr - 46, a, a + 0.65);
                neonStroke(c, GOLD, 4, 0.55 + w * 0.45);
            }
            c.restore();
            c.restore();

            // ---- blade wings ----
            for (const side of [-1, 1]) {
                for (let i = 4; i >= 0; i--) {
                    c.save();
                    c.scale(side, 1);
                    c.translate(130, -120);
                    c.rotate(this._wingAngle(s, i));
                    const L = this._wingLen(s, i);
                    const blade = () => poly(c, [0, -16, L * 0.55, -34, L, -4, L * 0.9, 10, L * 0.55, 24, 0, 16]);
                    shade(c, blade, lin(c, 0, 0, L, 0, [[0, '#0b0a10'], [0.6, '#24080e'], [1, '#5a0f1a']]), { rim: RED, rimA: 0.35, lw: 6, rimW: 12 });
                    c.beginPath(); c.moveTo(16, -15); c.lineTo(L * 0.55, -32); c.lineTo(L, -4);
                    neonStroke(c, RED, 3, 0.55 + w * 0.45 + pulse * 0.2 + e * 0.2);
                    glowDot(c, L, -4, 40 + w * 40 + e * 30, e > 0.3 ? GOLD : RED, 0.5 + w * 0.5);
                    c.restore();
                }
            }

            // ---- tattered cloak ----
            const cloak = () => {
                c.beginPath();
                c.moveTo(-235, -110); c.lineTo(235, -110); c.lineTo(275, 330);
                for (let i = 0, x = 275; x >= -275; x -= 37, i++) {
                    c.lineTo(x, 380 + (i % 2 ? 55 : 0) + Math.sin(t * 1.8 + i * 0.9) * 14);
                }
                c.lineTo(-275, 330);
                c.closePath();
            };
            shade(c, cloak, lin(c, 0, -110, 0, 430, [[0, '#4a0812'], [0.6, '#22040a'], [1, '#0c0204']]), { rim: RED, rimA: 0.2, lw: 7, rimW: 18 });

            // ---- torso ----
            const torso = () => poly(c, [-250, -135, 250, -135, 218, 55, 152, 205, 122, 350, -122, 350, -152, 205, -218, 55]);
            shade(c, torso, obsidian(-135, 350), rimO);
            // molten seams (glow brighter as armor breaks)
            c.save(); torso(); c.clip();
            const seams = [[-215, -40, -95, 30, -120, 190], [215, -40, 95, 30, 120, 190], [-70, 230, 0, 290, 70, 230], [-150, 260, -95, 345], [150, 260, 95, 345]];
            for (const sm of seams) {
                c.beginPath(); c.moveTo(sm[0], sm[1]);
                for (let i = 2; i < sm.length; i += 2) c.lineTo(sm[i], sm[i + 1]);
                neonStroke(c, RED, 4, 0.45 + pulse * 0.3 + w * 0.3 + e * 0.3);
            }
            // ab plates with gold trim
            for (let i = 0; i < 3; i++) {
                const y = 205 + i * 46, hw = 110 - i * 14;
                const plate = () => poly(c, [-hw, y, hw, y, hw - 12, y + 36, -hw + 12, y + 36]);
                shade(c, plate, obsidian(y, y + 36), { rim: '#c9b6d8', rimA: 0.22, lw: 5, rimW: 8 });
                c.beginPath(); c.moveTo(-hw + 6, y + 4); c.lineTo(hw - 6, y + 4);
                c.strokeStyle = rgba(GOLD, 0.8); c.lineWidth = 3; c.stroke();
            }
            c.restore();

            // ---- chest plates: blast loose when enraged ----
            for (const side of [-1, 1]) {
                const plate = () => poly(c, [side * 240, -122, side * 22, -122, side * 28, 52, side * 150, 82, side * 208, 42]);
                // molten cavity revealed underneath
                c.save();
                plate();
                c.fillStyle = rad(c, side * 120, -20, 10, 200, [[0, rgba('#ffd28a', 0.9 * e)], [0.4, rgba(RED, 0.85 * e)], [1, rgba('#3a0610', e)]]);
                c.fill();
                c.restore();
                c.save();
                const drift = Math.sin(t * 2 + side) * 6 * e;
                c.translate(side * e * 48, -e * 22 + drift);
                c.rotate(side * e * 0.12);
                shade(c, plate, obsidian(-122, 82), rimO);
                c.beginPath(); c.moveTo(side * 228, -112); c.lineTo(side * 34, -112);
                c.strokeStyle = GOLD; c.lineWidth = 5; c.stroke();
                c.restore();
            }

            // ---- reactor heart ----
            c.save();
            c.translate(0, 132);
            const coreK = 1 + 0.08 * Math.sin(t * 4) + w * 0.5 + atk * 0.35;
            glowDot(c, 0, 0, 230 * coreK, RED, 0.6 + w * 0.4);
            c.beginPath(); c.arc(0, 0, 78, 0, TAU);
            c.fillStyle = '#0b0a10'; c.fill();
            c.lineWidth = 10; c.strokeStyle = GOLD; c.stroke();
            c.lineWidth = 4; c.strokeStyle = '#000'; c.stroke();
            c.save(); c.rotate(-t * (1 + w * 7));
            for (let i = 0; i < 6; i++) {
                c.rotate(TAU / 6);
                poly(c, [20, -8, 66, -22, 68, 10, 24, 10]);
                c.fillStyle = '#2e2a36'; c.fill(); c.strokeStyle = '#000'; c.lineWidth = 3; c.stroke();
            }
            c.restore();
            c.beginPath(); c.arc(0, 0, 44 * coreK, 0, TAU);
            c.fillStyle = rad(c, 0, 0, 2, 44 * coreK, [[0, '#ffffff'], [0.35, mix('#ff8a8a', '#ffffff', w)], [1, rgba(RED, 0.15)]]);
            c.fill();
            c.restore();

            // ---- head ----
            c.save();
            c.translate(0, -245);
            c.rotate(s.look * 0.05 - w * 0.06);
            // horns
            for (const side of [-1, 1]) {
                const horn = () => {
                    c.beginPath();
                    c.moveTo(side * 70, -40);
                    c.quadraticCurveTo(side * 190, -60, side * 205, -215 - w * 20);
                    c.quadraticCurveTo(side * 160, -95, side * 82, 0);
                    c.closePath();
                };
                shade(c, horn, lin(c, 0, 0, 0, -215, [[0, '#3a3442'], [1, '#d8cce4']]), { rim: '#ffffff', rimA: 0.35, lw: 6, rimW: 10 });
                c.beginPath(); c.moveTo(side * 82, -6); c.quadraticCurveTo(side * 165, -95, side * 203, -210 - w * 20);
                neonStroke(c, RED, 2.5, 0.5 + w * 0.5);
                if (s.des > 0.3) glowDot(c, side * 205, -215 - w * 20, 50, GOLD, s.des * (0.6 + 0.4 * pulse));
            }
            // crown spikes
            const crown = [[-62, -60, 24, 120], [-31, -72, 22, 165], [0, -78, 28, 235], [31, -72, 22, 165], [62, -60, 24, 120]];
            for (const [x, y, wd, h] of crown) {
                const sp = () => poly(c, [x - wd / 2, y, x, y - h - w * 25, x + wd / 2, y]);
                shade(c, sp, lin(c, x, y, x, y - h, [[0, '#17141c'], [1, '#6a6278']]), { rim: '#e8dcf0', rimA: 0.3, lw: 5, rimW: 8 });
            }
            // jaw (drops open on the roar)
            c.save();
            c.translate(0, roar * 34);
            const jaw = () => poly(c, [-62, 52, 62, 52, 44, 128, -44, 128]);
            glowDot(c, 0, 52, 90 * roar + 1, RED, roar);
            shade(c, jaw, obsidian(52, 128), rimO);
            c.strokeStyle = '#000'; c.lineWidth = 5;
            for (let i = 0; i < 5; i++) { c.beginPath(); c.moveTo(-30 + i * 15, 70); c.lineTo(-30 + i * 15, 112); c.stroke(); }
            c.restore();
            // mask
            const mask = () => poly(c, [-92, -88, 92, -88, 108, 8, 66, 66, -66, 66, -108, 8]);
            shade(c, mask, lin(c, 0, -88, 0, 66, [[0, '#5a5262'], [0.5, '#211d28'], [1, '#08070a']]), rimO);
            c.beginPath(); c.moveTo(-92, -88); c.lineTo(0, -48); c.lineTo(92, -88);
            c.strokeStyle = GOLD; c.lineWidth = 6; c.stroke();
            // three eyes, big enough to read from the back row
            const eyeA = clamp(0.8 + 0.2 * Math.sin(t * 5) + w * 0.6, 0, 1.4);
            const flick = s.des > 0.5 && Math.random() < 0.08 ? 0.25 : 1;
            const ex = s.look * 7;
            const eyeCol = rgba(mix(hot, '#ffffff', 0.25), clamp(eyeA * flick, 0, 1));
            const eyes = [
                [() => poly(c, [ex, -44, ex + 17, -12, ex, 20, ex - 17, -12]), ex, -12, 26],
                [() => poly(c, [ex - 84, -50, ex - 30, -28, ex - 36, -12, ex - 78, -32]), ex - 56, -30, 18],
                [() => poly(c, [ex + 84, -50, ex + 30, -28, ex + 36, -12, ex + 78, -32]), ex + 56, -30, 18]
            ];
            for (const [shape, gx, gy, r] of eyes) {
                shape(); c.lineJoin = 'round'; c.strokeStyle = '#000'; c.lineWidth = 12; c.stroke();
                glowDot(c, gx, gy, r * 5 + w * 40, RED, 0.75 * eyeA * flick);
                shape(); c.fillStyle = eyeCol; c.fill();
            }
            c.restore();

            // ---- arms with clawed gauntlets ----
            for (const side of [-1, 1]) {
                c.save();
                c.scale(side, 1);
                c.translate(268, -60);
                c.rotate(this._armAngle(s, side));
                const upper = () => rrect(c, -46, -10, 92, 205, 40);
                shade(c, upper, lin(c, -46, 0, 46, 0, [[0, '#3a3542'], [0.5, '#1c1922'], [1, '#08070a']]), rimO);
                c.translate(0, 185);
                c.rotate(this._elbow(s));
                const fore = () => rrect(c, -56, -10, 112, 175, 30);
                shade(c, fore, obsidian(-10, 165), rimO);
                for (let i = 0; i < 2; i++) {
                    c.beginPath(); c.moveTo(-50, 30 + i * 50); c.lineTo(50, 30 + i * 50);
                    c.strokeStyle = GOLD; c.lineWidth = 6; c.stroke();
                }
                c.beginPath(); c.moveTo(0, 10); c.lineTo(0, 150);
                neonStroke(c, RED, 3, 0.5 + pulse * 0.3 + w * 0.5);
                // claws
                for (let k = 0; k < 4; k++) {
                    const x = -42 + k * 28;
                    const claw = () => poly(c, [x - 11, 160, x + 4, 238 - Math.abs(k - 1.5) * 14 + w * 10, x + 11, 160]);
                    shade(c, claw, lin(c, 0, 160, 0, 238, [[0, '#2a2630'], [1, '#c9c2d4']]), { rim: '#ffffff', rimA: 0.3, lw: 4, rimW: 6 });
                }
                if (w > 0.05) glowDot(c, 0, 210, 30 + w * 90, hot, w);
                c.restore();
            }

            // ---- pauldrons (lift on enrage, glowing underneath) ----
            for (const side of [-1, 1]) {
                c.save();
                c.scale(side, 1);
                c.translate(255 + e * 26, -100 - e * 26);
                c.rotate(-e * 0.1);
                if (e > 0.05) glowDot(c, 0, 30, 160, RED, e * 0.8);
                const pd = () => poly(c, [-95, 25, -35, -75, 95, -92, 160, -22, 132, 78, -55, 78]);
                shade(c, pd, obsidian(-92, 78), rimO);
                c.beginPath(); c.moveTo(-35, -62); c.lineTo(92, -78); c.lineTo(146, -22);
                c.strokeStyle = GOLD; c.lineWidth = 6; c.stroke();
                for (const [x, h] of [[40, 120], [95, 160]]) {
                    const sp = () => poly(c, [x - 18, -78, x + 22, -78 - h, x + 18, -80]);
                    shade(c, sp, lin(c, 0, -78, 0, -78 - h, [[0, '#17141c'], [1, '#7a7088']]), { rim: '#e8dcf0', rimA: 0.3, lw: 5, rimW: 8 });
                }
                c.restore();
            }
            c.restore();
        }
    };

    // ============================================================
    // PARTICLES
    // ============================================================
    function makeParticle(o) {
        return Object.assign({ x: 0, y: 0, vx: 0, vy: 0, g: 0, drag: 0.985, size: 4, life: 1, max: 0, color: '#ffffff', kind: 'spark', rot: rand(0, TAU), vr: 0, grow: 0 }, o);
    }
    function updateParticles(list, dt) {
        for (let i = list.length - 1; i >= 0; i--) {
            const p = list[i];
            p.life -= dt;
            if (p.life <= 0) { list.splice(i, 1); continue; }
            const d = Math.pow(p.drag, dt * 60);
            p.vx *= d; p.vy *= d;
            p.vy += p.g * dt;
            p.x += p.vx * dt; p.y += p.vy * dt;
            p.rot += p.vr * dt;
        }
    }
    function drawParticles(c, list, back) {
        for (const p of list) {
            const isBack = p.kind === 'smoke';
            if (isBack !== back) continue;
            const a = clamp(p.life / p.max, 0, 1);
            c.globalCompositeOperation = (p.kind === 'smoke' || p.kind === 'shard') ? 'source-over' : 'lighter';
            switch (p.kind) {
                case 'smoke': {
                    const r = p.size * (1 + (1 - a) * 2.2);
                    c.fillStyle = rad(c, p.x, p.y, 0, r, [[0, rgba(p.color, a * 0.4)], [1, rgba(p.color, 0)]]);
                    c.fillRect(p.x - r, p.y - r, r * 2, r * 2);
                    break;
                }
                case 'spark':
                    c.strokeStyle = rgba(p.color, a);
                    c.lineWidth = p.size;
                    c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035); c.stroke();
                    break;
                case 'ember':
                    c.fillStyle = rgba(p.color, a);
                    c.beginPath(); c.arc(p.x, p.y, p.size * (0.4 + a * 0.6), 0, TAU); c.fill();
                    break;
                case 'bit':
                    c.fillStyle = rgba(p.color, a);
                    c.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
                    break;
                case 'shard':
                    c.save(); c.translate(p.x, p.y); c.rotate(p.rot);
                    c.fillStyle = rgba(p.color, a);
                    c.beginPath(); c.moveTo(p.size, 0); c.lineTo(-p.size * 0.7, -p.size * 0.6); c.lineTo(-p.size * 0.5, p.size * 0.7); c.closePath(); c.fill();
                    c.restore();
                    break;
                case 'ring':
                    c.strokeStyle = rgba(p.color, a);
                    c.lineWidth = 14 * a;
                    c.beginPath(); c.arc(p.x, p.y, p.size + (1 - a) * p.grow, 0, TAU); c.stroke();
                    break;
                case 'flash': {
                    const r = p.size * (0.6 + (1 - a) * 0.6);
                    c.fillStyle = rad(c, p.x, p.y, 0, r, [[0, rgba(p.color, a)], [1, rgba(p.color, 0)]]);
                    c.fillRect(p.x - r, p.y - r, r * 2, r * 2);
                    break;
                }
            }
        }
        c.globalCompositeOperation = 'source-over';
    }

    // Battle damage: jagged cracks that appear as HP drops
    function makeCracks(seed) {
        const r = seeded(seed);
        const cracks = [];
        for (let i = 0; i < 16; i++) {
            const a0 = r() * TAU, d0 = 60 + r() * 200;
            let x = Math.cos(a0) * d0, y = Math.sin(a0) * d0 * 0.9;
            let ang = r() * TAU;
            const pts = [x, y];
            const n = 4 + Math.floor(r() * 4);
            for (let k = 0; k < n; k++) {
                ang += (r() - 0.5) * 0.8;
                const len = 24 + r() * 34;
                x += Math.cos(ang) * len; y += Math.sin(ang) * len;
                pts.push(x, y);
            }
            cracks.push(pts);
        }
        return cracks;
    }

    // ============================================================
    // ENGINE
    // ============================================================
    const WORLD = 1000;          // logical canvas size
    const CX = 500, CY = 540;    // boss center in world coords

    function create(canvas, type, opts = {}) {
        const D = DESIGNS[type] || DESIGNS.raider;
        const ctx = canvas.getContext('2d');
        const off = document.createElement('canvas');
        const octx = off.getContext('2d');
        let W = 1, H = 1, dpr = 1, S = 1, ox = 0, oy = 0;
        let raf = 0, last = 0, destroyed = false;

        const s = {
            t: 0, look: 0, hp: 1, hitK: 0, atk: 0,
            wind: 0, winding: false, windDur: 1,
            phase: 'NORMAL', enr: 0, des: 0,
            dying: false, deathT: 0, deathDur: 2, deathCb: null, deathDone: false,
            introT: -1, introDur: 1.8, landed: true
        };
        const parts = [];
        const cracks = makeCracks(type.length * 7919 + 13);
        let death = null; // snapshot + per-style data

        function fx(kind, x, y, o = {}) {
            const p = makeParticle(Object.assign({ kind, x: CX + x, y: CY + y }, o));
            p.max = p.life;
            parts.push(p);
            if (parts.length > 700) parts.splice(0, parts.length - 700);
        }

        function resize() {
            const r = canvas.getBoundingClientRect();
            dpr = Math.min(2, window.devicePixelRatio || 1);
            W = Math.max(1, Math.round(r.width * dpr));
            H = Math.max(1, Math.round(r.height * dpr));
            if (canvas.width !== W || canvas.height !== H) {
                canvas.width = W; canvas.height = H;
                off.width = W; off.height = H;
            }
            S = Math.min(W, H) / WORLD;
            ox = (W - WORLD * S) / 2;
            oy = (H - WORLD * S) / 2;
        }
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
        if (ro) ro.observe(canvas); else window.addEventListener('resize', resize);
        resize();

        function update(dt) {
            s.t += dt;
            if (s.introT >= 0) {
                s.introT += dt;
                if (!s.landed && s.introT >= s.introDur * 0.7) {
                    s.landed = true;
                    s.hitK = 1;
                    fx('ring', 0, 330, { size: 60, grow: 700, life: 0.7, color: D.color });
                    fx('flash', 0, 0, { size: 600, life: 0.4, color: '#ffffff' });
                    for (let i = 0; i < 24; i++) fx('smoke', rand(-300, 300), 320 + rand(-20, 20), { vx: rand(-200, 200), vy: rand(-80, -10), size: rand(24, 40), life: rand(0.9, 1.5), color: '#3a3038' });
                }
                if (s.introT >= s.introDur) s.introT = -1;
            }
            s.look = Math.sin(s.t * 0.7) * 0.6 + Math.sin(s.t * 1.9) * 0.3;
            s.hitK = Math.max(0, s.hitK - dt * 4);
            s.atk = Math.max(0, s.atk - dt * 2.2);
            s.wind = s.winding ? Math.min(1, s.wind + dt / s.windDur) : Math.max(0, s.wind - dt * 3);
            const enrT = s.phase === 'ENRAGED' || s.phase === 'DESPERATE' ? 1 : 0;
            const desT = s.phase === 'DESPERATE' ? 1 : 0;
            s.enr += (enrT - s.enr) * Math.min(1, dt * 3);
            s.des += (desT - s.des) * Math.min(1, dt * 3);
            if (!s.dying) {
                D.idle && D.idle(s, fx, dt);
                if (s.des > 0.5 && Math.random() < 5 * dt) {
                    const a = rand(0, TAU), d = rand(40, 220);
                    for (let i = 0; i < 6; i++) fx('spark', Math.cos(a) * d, Math.sin(a) * d, { vx: rand(-300, 300), vy: rand(-400, -100), g: 900, size: 2.5, life: rand(0.25, 0.5), color: i % 2 ? '#ffd28a' : D.color });
                    if (Math.random() < 0.4) fx('smoke', Math.cos(a) * d, Math.sin(a) * d, { vx: rand(-20, 20), vy: rand(-80, -40), size: rand(14, 22), life: rand(1, 1.6), color: '#3a3a40' });
                }
            } else {
                s.deathT += dt;
                if (death && death.update) death.update(dt);
                if (!s.deathDone && s.deathT >= s.deathDur) {
                    s.deathDone = true;
                    if (s.deathCb) s.deathCb();
                }
            }
            updateParticles(parts, dt);
        }

        function worldTransform(c, dx = 0, dy = 0) {
            c.setTransform(S, 0, 0, S, ox + dx * S, oy + dy * S);
        }

        function renderBoss() {
            octx.setTransform(1, 0, 0, 1, 0, 0);
            octx.globalCompositeOperation = 'source-over';
            octx.globalAlpha = 1;
            octx.clearRect(0, 0, W, H);
            worldTransform(octx);
            octx.translate(CX, CY);
            if (s.introT >= 0) {
                const k = clamp(s.introT / (s.introDur * 0.7), 0, 1);
                octx.translate(0, (1 - easeOut(k)) * 420);
                octx.globalAlpha = Math.min(1, k * 1.6);
            }
            const breathe = 1 + Math.sin(s.t * 2) * 0.006;
            octx.translate(0, s.hitK * 14);
            octx.scale(breathe * (1 - s.hitK * 0.025), breathe * (1 - s.hitK * 0.025));
            D.draw(octx, s, fx);

            // battle damage cracks, clipped to the boss silhouette
            const show = Math.floor(10 * clamp((0.7 - s.hp) / 0.6, 0, 1));
            if (show > 0) {
                octx.globalCompositeOperation = 'source-atop';
                octx.lineJoin = 'round';
                for (let i = 0; i < show; i++) {
                    const pts = cracks[i];
                    octx.beginPath(); octx.moveTo(pts[0], pts[1]);
                    for (let k = 2; k < pts.length; k += 2) octx.lineTo(pts[k], pts[k + 1]);
                    octx.strokeStyle = 'rgba(0,0,0,0.8)'; octx.lineWidth = 6; octx.stroke();
                    octx.strokeStyle = rgba(mix(D.color, '#ffffff', 0.3), 0.45 + 0.35 * Math.sin(s.t * 6 + i)); octx.lineWidth = 2; octx.stroke();
                }
            }

            // full-silhouette tints
            octx.globalAlpha = 1;
            octx.setTransform(1, 0, 0, 1, 0, 0);
            octx.globalCompositeOperation = 'source-atop';
            if (s.enr > 0.01) {
                octx.fillStyle = rgba('#ff3a20', s.enr * (0.05 + 0.04 * Math.sin(s.t * 5)));
                octx.fillRect(0, 0, W, H);
            }
            if (s.wind > 0.01) {
                octx.fillStyle = rgba(D.color, s.wind * 0.16 * (0.5 + 0.5 * Math.sin(s.t * (8 + s.wind * 16))));
                octx.fillRect(0, 0, W, H);
            }
            if (s.hitK > 0.01) {
                octx.fillStyle = rgba('#ffffff', 0.8 * Math.pow(s.hitK, 1.5));
                octx.fillRect(0, 0, W, H);
            }
            octx.globalCompositeOperation = 'source-over';
        }

        function drawAura(c, k) {
            worldTransform(c);
            const a = (0.18 + s.enr * 0.12 + s.wind * 0.25) * k;
            const col = s.enr > 0.5 ? mix(D.color, '#ff3a20', 0.5) : D.color;
            c.fillStyle = rad(c, CX, CY - 40, 40, 460, [[0, rgba(col, a)], [1, rgba(col, 0)]]);
            c.fillRect(0, 0, WORLD, WORLD);
            c.fillStyle = rad(c, CX, CY + 330, 10, 280, [[0, 'rgba(0,0,0,0.55)'], [1, 'rgba(0,0,0,0)']]);
            c.save(); c.translate(CX, CY + 330); c.scale(1, 0.22);
            c.beginPath(); c.arc(0, 0, 280, 0, TAU); c.fill();
            c.restore();
        }

        // ---------- deaths ----------
        function tinted(src, hex) {
            const cv = document.createElement('canvas');
            cv.width = src.width; cv.height = src.height;
            const c = cv.getContext('2d');
            c.drawImage(src, 0, 0);
            c.globalCompositeOperation = 'source-atop';
            c.fillStyle = hex; c.fillRect(0, 0, cv.width, cv.height);
            return cv;
        }
        function burst(colors, n) {
            for (let i = 0; i < n; i++) {
                const a = rand(0, TAU), v = rand(200, 1100);
                fx('spark', rand(-60, 60), rand(-80, 80), { vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 500, size: rand(2, 5), life: rand(0.4, 1.1), color: colors[i % colors.length] });
            }
            for (let i = 0; i < n / 4; i++) {
                const a = rand(0, TAU), v = rand(150, 600);
                fx('shard', rand(-80, 80), rand(-80, 80), { vx: Math.cos(a) * v, vy: Math.sin(a) * v - 200, g: 900, vr: rand(-12, 12), size: rand(8, 20), life: rand(0.8, 1.6), color: i % 2 ? '#2a2a32' : '#55555f' });
            }
            for (let i = 0; i < n / 4; i++) {
                const a = rand(0, TAU), v = rand(60, 420);
                fx('ember', rand(-60, 60), rand(-60, 60), { vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, size: rand(4, 9), life: rand(0.6, 1.4), color: i % 2 ? '#ffa502' : colors[0] });
            }
            for (let i = 0; i < n / 10; i++) {
                fx('smoke', rand(-120, 120), rand(-120, 120), { vx: rand(-90, 90), vy: rand(-120, -20), size: rand(26, 44), life: rand(1.2, 2), color: '#2a2a30' });
            }
            fx('flash', 0, 0, { size: 700, life: 0.5, color: '#ffffff' });
            fx('ring', 0, 0, { size: 60, grow: 900, life: 0.7, color: colors[0] });
        }

        const DEATHS = {
            explode: {
                dur: 2.2,
                init(d) { d.burst = false; },
                draw(c, d, k) {
                    const cx = ox + CX * S, cy = oy + CY * S;
                    if (k < 0.3) {
                        const j = (k / 0.3) * 22 * dpr;
                        c.drawImage(d.snap, rand(-j, j), rand(-j, j));
                        c.globalCompositeOperation = 'lighter';
                        c.globalAlpha = k / 0.3;
                        c.drawImage(d.white, rand(-j, j), rand(-j, j));
                        c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
                        return;
                    }
                    if (!d.burst) { d.burst = true; burst([D.color, '#ffa502', '#ffffff'], 160); }
                    const f = (k - 0.3) / 0.35;
                    if (f >= 1) return;
                    const sc = 1 + f * 0.35;
                    c.globalAlpha = 1 - f;
                    c.setTransform(sc, 0, 0, sc, cx - cx * sc, cy - cy * sc);
                    c.drawImage(d.white, 0, 0);
                    c.setTransform(1, 0, 0, 1, 0, 0);
                    c.globalAlpha = 1;
                }
            },
            glitch: {
                dur: 2.0,
                init(d) { d.n = 30; d.off = new Array(d.n).fill(0); d.next = 0; d.burst = false; d.red = tinted(d.snap, '#ff4757'); d.cyan = tinted(d.snap, '#4de1ff'); },
                draw(c, d, k) {
                    if (s.deathT >= d.next) { d.next = s.deathT + 0.06; d.off = d.off.map(() => (Math.random() < 0.6 ? rand(-1, 1) : 0)); }
                    const amp = Math.min(1, k / 0.6) * 70 * dpr;
                    const cy = oy + CY * S;
                    let sy = 1;
                    if (k > 0.6) sy = Math.max(0.015, 1 - (k - 0.6) / 0.25);
                    if (k > 0.85 && !d.burst) { d.burst = true; burst(['#ffa502', '#4de1ff', '#ffffff'], 90); }
                    const alpha = k > 0.85 ? Math.max(0, 1 - (k - 0.85) / 0.15) : 1;
                    c.globalAlpha = alpha;
                    c.setTransform(1, 0, 0, sy, 0, cy - cy * sy);
                    const h = H / d.n;
                    for (let i = 0; i < d.n; i++) {
                        const dx = d.off[i] * amp;
                        c.drawImage(d.snap, 0, i * h, W, h, dx, i * h, W, h);
                    }
                    c.globalCompositeOperation = 'lighter';
                    c.globalAlpha = alpha * 0.45 * Math.min(1, k * 3);
                    c.drawImage(d.red, -10 * dpr - amp * 0.2, 0);
                    c.drawImage(d.cyan, 10 * dpr + amp * 0.2, 0);
                    c.globalCompositeOperation = 'source-over';
                    c.globalAlpha = 1;
                    c.setTransform(1, 0, 0, 1, 0, 0);
                }
            },
            shatter: {
                dur: 2.3,
                init(d) {
                    const cx = ox + CX * S, cy = oy + CY * S, span = 820 * S;
                    const n = 11, ts = span / n;
                    d.tiles = [];
                    for (let gy = 0; gy < n; gy++) for (let gx = 0; gx < n; gx++) {
                        const x = cx - span / 2 + gx * ts, y = cy - span / 2 + gy * ts;
                        const dxc = x + ts / 2 - cx, dyc = y + ts / 2 - cy;
                        const dist = Math.hypot(dxc, dyc) || 1;
                        const v = rand(250, 750) * dpr;
                        d.tiles.push({ x, y, s: ts, vx: dxc / dist * v + rand(-80, 80) * dpr, vy: dyc / dist * v - rand(100, 300) * dpr, vr: rand(-6, 6) });
                    }
                    d.burst = false;
                },
                draw(c, d, k) {
                    if (k < 0.15) {
                        c.drawImage(d.snap, 0, 0);
                        c.globalCompositeOperation = 'lighter';
                        c.globalAlpha = k / 0.15;
                        c.drawImage(d.white, 0, 0);
                        c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
                        return;
                    }
                    if (!d.burst) { d.burst = true; burst(['#a55eea', '#4de1ff', '#ffffff'], 100); }
                    const tt = s.deathT - 0.15 * d.dur;
                    c.globalAlpha = Math.max(0, 1 - (k - 0.15) / 0.8);
                    for (const tl of d.tiles) {
                        const x = tl.x + tl.vx * tt, y = tl.y + tl.vy * tt + 0.5 * 1400 * dpr * tt * tt;
                        c.save();
                        c.translate(x + tl.s / 2, y + tl.s / 2);
                        c.rotate(tl.vr * tt);
                        c.drawImage(d.snap, tl.x, tl.y, tl.s, tl.s, -tl.s / 2, -tl.s / 2, tl.s, tl.s);
                        c.restore();
                    }
                    c.globalAlpha = 1;
                }
            },
            meltdown: {
                dur: 3.2,
                init(d) {
                    d.sw = Math.max(2, Math.round(5 * dpr));
                    d.drop = [];
                    for (let x = 0; x < W; x += d.sw) d.drop.push(0.4 + Math.random() * 0.9 + Math.sin(x * 0.01) * 0.2);
                    d.hot = tinted(d.snap, '#ff6a2a');
                    d.burst = false;
                },
                update(dt) {
                    if (Math.random() < 30 * dt) fx('ember', rand(-300, 300), rand(-200, 300), { vx: rand(-30, 30), vy: rand(-260, -120), size: rand(3, 6), life: rand(0.6, 1.2), color: Math.random() < 0.5 ? '#ff2a3d' : '#ffa502' });
                },
                draw(c, d, k) {
                    const shake = (k < 0.75 ? k : 0) * 10 * dpr;
                    const sx = rand(-shake, shake);
                    const fade = Math.max(0, 1 - Math.max(0, k - 0.55) / 0.3);
                    if (fade <= 0) return;
                    c.globalAlpha = fade;
                    const melt = Math.pow(Math.max(0, k - 0.1), 2);
                    for (let i = 0, x = 0; x < W; x += d.sw, i++) {
                        const dy = melt * H * 0.55 * d.drop[i];
                        c.drawImage(d.snap, x, 0, d.sw, H, x + sx, dy, d.sw, H);
                    }
                    c.globalCompositeOperation = 'lighter';
                    c.globalAlpha = fade * Math.min(1, k * 2.5) * (0.6 + 0.3 * Math.sin(s.deathT * 20));
                    for (let i = 0, x = 0; x < W; x += d.sw, i++) {
                        const dy = melt * H * 0.55 * d.drop[i];
                        c.drawImage(d.hot, x, 0, d.sw, H, x + sx, dy, d.sw, H);
                    }
                    c.globalCompositeOperation = 'source-over';
                    c.globalAlpha = 1;
                    if (k > 0.7 && !d.burst) { d.burst = true; burst(['#ff2a3d', '#ffa502', '#ffffff'], 200); }
                }
            }
        };

        function frame(now) {
            if (destroyed) return;
            raf = requestAnimationFrame(frame);
            const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
            last = now;
            update(dt);

            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'source-over';
            ctx.clearRect(0, 0, W, H);

            const auraK = s.dying ? Math.max(0, 1 - s.deathT / (s.deathDur * 0.5)) : 1;
            if (D.backdrop && opts.backdrop !== false) {
                worldTransform(ctx);
                ctx.globalAlpha = auraK;
                D.backdrop(ctx, s);
                ctx.globalAlpha = 1;
            }
            drawAura(ctx, auraK);
            worldTransform(ctx);
            drawParticles(ctx, parts, true);

            ctx.setTransform(1, 0, 0, 1, 0, 0);
            if (!s.dying) {
                renderBoss();
                const sh = (s.hitK * 10 + s.atk * 16 + s.des * 2.5 + s.wind * 3) * dpr;
                let alpha = 1;
                if (s.des > 0.5 && Math.random() < 0.03) alpha = 0.55;
                ctx.globalAlpha = alpha;
                ctx.drawImage(off, rand(-sh, sh), rand(-sh, sh));
                ctx.globalAlpha = 1;
            } else if (death) {
                death.style.draw(ctx, death, clamp(s.deathT / s.deathDur, 0, 1));
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.globalAlpha = 1;
                ctx.globalCompositeOperation = 'source-over';
            }

            worldTransform(ctx);
            drawParticles(ctx, parts, false);
        }
        raf = requestAnimationFrame(frame);

        const api = {
            type, name: D.name, color: D.color,
            setPhase(p) {
                const next = (p || 'NORMAL').toUpperCase();
                const rank = { NORMAL: 0, ENRAGED: 1, DESPERATE: 2 };
                if (!s.dying && (rank[next] ?? 0) > (rank[s.phase] ?? 0)) {
                    // transformation moment
                    s.hitK = 0.9;
                    fx('flash', 0, 0, { size: 700, life: 0.5, color: next === 'DESPERATE' ? '#ffffff' : '#ffb020' });
                    fx('ring', 0, 0, { size: 80, grow: 800, life: 0.7, color: D.color });
                    D.phaseUp && D.phaseUp(s, fx, next);
                }
                s.phase = next;
            },
            intro(ms = 1800) { s.introDur = ms / 1000; s.introT = 0; s.landed = false; },
            setHealth(pct) { s.hp = clamp(pct, 0, 1); },
            hit(amount = 800, o = {}) {
                if (s.dying) return;
                const big = o.crit || amount >= 5000;
                s.hitK = Math.min(1, s.hitK + (big ? 1 : 0.6));
                const n = big ? 34 : 14;
                const a0 = rand(0, TAU), d0 = rand(20, 150);
                const hx = Math.cos(a0) * d0, hy = Math.sin(a0) * d0 - 40;
                for (let i = 0; i < n; i++) {
                    const a = rand(0, TAU), v = rand(200, big ? 900 : 550);
                    fx('spark', hx, hy, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 600, size: rand(2, big ? 5 : 3.5), life: rand(0.2, 0.5), color: i % 3 ? D.hitColor : '#ffffff' });
                }
                if (big) {
                    fx('flash', hx, hy, { size: 260, life: 0.22, color: '#ffffff' });
                    fx('ring', hx, hy, { size: 20, grow: 220, life: 0.35, color: D.hitColor });
                }
            },
            windUp(ms = 3000) { if (s.dying) return; s.winding = true; s.windDur = Math.max(0.2, ms / 1000); s.wind = Math.min(s.wind, 0.05); },
            release() {
                if (s.dying) return;
                s.winding = false;
                s.atk = 1;
                D.attack && D.attack(s, fx);
                s.wind = 0;
            },
            cancelWindUp() { s.winding = false; },
            die(cb, styleName) {
                if (s.dying) return;
                renderBoss();
                const snap = document.createElement('canvas');
                snap.width = W; snap.height = H;
                snap.getContext('2d').drawImage(off, 0, 0);
                const style = DEATHS[styleName || D.deathStyle] || DEATHS.explode;
                death = { style, snap, white: tinted(snap, '#ffffff'), dur: style.dur };
                style.init && style.init(death);
                if (style.update) death.update = style.update;
                s.deathDur = style.dur;
                s.dying = true; s.deathT = 0; s.deathCb = cb || null; s.winding = false; s.wind = 0;
            },
            reset() {
                s.dying = false; s.deathT = 0; s.deathDone = false; death = null;
                s.hp = 1; s.hitK = 0; s.atk = 0; s.wind = 0; s.winding = false;
                s.phase = 'NORMAL'; s.enr = 0; s.des = 0;
                s.introT = -1; s.landed = true;
                parts.length = 0;
            },
            destroy() {
                destroyed = true;
                cancelAnimationFrame(raf);
                if (ro) ro.disconnect(); else window.removeEventListener('resize', resize);
            }
        };
        return api;
    }

    window.BossRenderer = { create, types: Object.keys(DESIGNS), designs: DESIGNS };
})();
