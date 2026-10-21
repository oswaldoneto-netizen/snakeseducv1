const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');

const app = express();
// procura o index.html em public/ ou ao lado do server.js
const pubDir = fs.existsSync(path.join(__dirname, 'public', 'index.html'))
  ? path.join(__dirname, 'public')
  : __dirname;
console.log('Servindo arquivos de: ' + pubDir, '| index.html existe:', fs.existsSync(path.join(pubDir, 'index.html')));
app.use(express.static(pubDir));
app.get('/', (req, res) => res.sendFile(path.join(pubDir, 'index.html')));
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const W = 4000, H = 4000, TICK = 33, SEG = 10, SPEED = 3, BOOST = 5.2, TURN = 0.11;
const FOOD_N = 600, BOTS = 8, VIEW = 1100, HEAD_R = 9;
const rnd = (a, b) => a + Math.random() * (b - a);
const BOT_NAMES = ['Naja', 'Jiboia', 'Sucuri', 'Cascavel', 'Mamba', 'Coral', 'Viper', 'Anaconda', 'Python', 'Boto'];

let nextId = 1;
const snakes = new Map();
let food = [];

function addFood(x, y, v) {
  food.push({ x: x ?? rnd(40, W - 40), y: y ?? rnd(40, H - 40), v: v || 1, c: Math.floor(rnd(0, 8)) });
}
for (let i = 0; i < FOOD_N; i++) addFood();

function spawn(nick, ws, bot) {
  const x = rnd(400, W - 400), y = rnd(400, H - 400), a = rnd(0, Math.PI * 2);
  const s = { id: nextId++, nick, ws, bot: !!bot, a, ta: a, boost: false, score: 0, drain: 0,
    hue: Math.floor(rnd(0, 360)), seg: [], turnT: 0 };
  for (let i = 0; i < 10; i++) s.seg.push({ x: x - Math.cos(a) * i * SEG, y: y - Math.sin(a) * i * SEG });
  snakes.set(s.id, s);
  return s;
}
const spawnBot = () => spawn(BOT_NAMES[Math.floor(rnd(0, BOT_NAMES.length))] + Math.floor(rnd(1, 99)), null, true);
for (let i = 0; i < BOTS; i++) spawnBot();

function kill(s) {
  snakes.delete(s.id);
  for (let i = 0; i < s.seg.length; i += 2) {
    addFood(s.seg[i].x + rnd(-8, 8), s.seg[i].y + rnd(-8, 8), 2);
  }
  if (s.ws && s.ws.readyState === 1) s.ws.send(JSON.stringify({ t: 'dead', score: s.score }));
  if (s.bot) setTimeout(spawnBot, 2000);
}

function think(s) {
  const h = s.seg[0];
  s.turnT--;
  if (s.turnT > 0) return;
  s.turnT = 6 + Math.floor(rnd(0, 10));
  if (h.x < 250 || h.x > W - 250 || h.y < 250 || h.y > H - 250) {
    s.ta = Math.atan2(H / 2 - h.y, W / 2 - h.x);
    return;
  }
  let best = null, bd = 350 * 350;
  for (const f of food) {
    const d = (f.x - h.x) ** 2 + (f.y - h.y) ** 2;
    if (d < bd) { bd = d; best = f; }
  }
  if (best) s.ta = Math.atan2(best.y - h.y, best.x - h.x);
  else s.ta += rnd(-0.6, 0.6);
  // foge de corpos próximos
  for (const o of snakes.values()) {
    if (o === s) continue;
    for (let i = 0; i < o.seg.length; i += 3) {
      const dx = o.seg[i].x - h.x, dy = o.seg[i].y - h.y;
      if (dx * dx + dy * dy < 90 * 90) { s.ta = Math.atan2(-dy, -dx) + rnd(-0.5, 0.5); return; }
    }
  }
}

function step(s) {
  if (s.bot) { think(s); s.boost = false; }
  let d = s.ta - s.a;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  s.a += Math.max(-TURN, Math.min(TURN, d));
  const boosting = s.boost && s.score > 5;
  if (boosting && ++s.drain >= 8) {
    s.drain = 0; s.score--;
    const t = s.seg[s.seg.length - 1];
    addFood(t.x, t.y, 1);
  }
  const sp = boosting ? BOOST : SPEED;
  const h = s.seg[0];
  h.x += Math.cos(s.a) * sp;
  h.y += Math.sin(s.a) * sp;
  for (let i = 1; i < s.seg.length; i++) {
    const p = s.seg[i - 1], q = s.seg[i];
    const dx = p.x - q.x, dy = p.y - q.y, dist = Math.hypot(dx, dy);
    if (dist > SEG) { q.x += dx / dist * (dist - SEG); q.y += dy / dist * (dist - SEG); }
  }
  const target = 10 + Math.floor(s.score / 2);
  while (s.seg.length < target) { const t = s.seg[s.seg.length - 1]; s.seg.push({ x: t.x, y: t.y }); }
  while (s.seg.length > target && s.seg.length > 10) s.seg.pop();
}

function tick() {
  for (const s of snakes.values()) step(s);
  const dead = [];
  for (const s of snakes.values()) {
    const h = s.seg[0];
    if (h.x < 0 || h.x > W || h.y < 0 || h.y > H) { dead.push(s); continue; }
    for (const o of snakes.values()) {
      if (o === s) continue;
      let hit = false;
      for (let i = 0; i < o.seg.length; i++) {
        const dx = o.seg[i].x - h.x, dy = o.seg[i].y - h.y;
        if (dx * dx + dy * dy < (HEAD_R + 8) ** 2) { hit = true; break; }
      }
      if (hit) { dead.push(s); break; }
    }
  }
  dead.forEach(kill);
  for (const s of snakes.values()) {
    const h = s.seg[0];
    for (let i = food.length - 1; i >= 0; i--) {
      const f = food[i], dx = f.x - h.x, dy = f.y - h.y;
      if (dx * dx + dy * dy < 22 * 22) { s.score += f.v; food.splice(i, 1); }
    }
  }
  while (food.length < FOOD_N) addFood();
  if (food.length > FOOD_N + 600) food.splice(0, food.length - FOOD_N - 600);

  const lb = [...snakes.values()].sort((a, b) => b.score - a.score).slice(0, 10).map(s => [s.nick, s.score, s.id]);
  for (const s of snakes.values()) {
    if (!s.ws || s.ws.readyState !== 1) continue;
    const h = s.seg[0];
    const sn = [];
    for (const o of snakes.values()) {
      const oh = o.seg[0];
      if (Math.abs(oh.x - h.x) > VIEW + o.seg.length * SEG || Math.abs(oh.y - h.y) > VIEW + o.seg.length * SEG) continue;
      const pts = [];
      for (const p of o.seg) pts.push(Math.round(p.x), Math.round(p.y));
      sn.push({ id: o.id, n: o.nick, h: o.hue, sc: o.score, s: pts });
    }
    const f = [];
    for (const p of food) if (Math.abs(p.x - h.x) < VIEW && Math.abs(p.y - h.y) < VIEW) f.push([Math.round(p.x), Math.round(p.y), p.v, p.c]);
    s.ws.send(JSON.stringify({ t: 's', me: s.id, sc: s.score, sn, f, lb, pl: snakes.size }));
  }
}
setInterval(tick, TICK);

wss.on('connection', (ws) => {
  let me = null;
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'join' && !me) {
      const nick = String(m.nick || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 15) || 'Anônimo';
      me = spawn(nick, ws, false);
      ws.send(JSON.stringify({ t: 'init', id: me.id, w: W, h: H }));
    } else if (m.t === 'a' && me && snakes.has(me.id) && Number.isFinite(m.a)) {
      me.ta = m.a; me.boost = !!m.b;
    } else if (m.t === 'join' && me && !snakes.has(me.id)) {
      const nick = me.nick; me = spawn(nick, ws, false);
      ws.send(JSON.stringify({ t: 'init', id: me.id, w: W, h: H }));
    }
  });
  ws.on('close', () => { if (me && snakes.has(me.id)) { me.ws = null; kill(me); } });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Rodando na porta ' + PORT));
