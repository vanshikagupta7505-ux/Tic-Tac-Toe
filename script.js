// Agar koi JavaScript error aaye to page ke upar dikha do
window.addEventListener("error", e => {
  document.body.insertAdjacentHTML("afterbegin",
    '<p style="background:#fee;color:#900;padding:10px;margin:0;font-family:monospace">JS error: ' +
    e.message + " (line " + e.lineno + ")</p>");
});

const $ = s => document.querySelector(s);
const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

/* ---------- Saved data (localStorage): score, theme, settings ---------- */
const STORE = "ttt_v2";
let saved = {
  theme: "pastel", mode: "ai", level: "hard", side: "X", sound: true,
  scores: { ai: { w: 0, l: 0, d: 0 }, two: { x: 0, o: 0, d: 0 } }
};
try {
  const s = JSON.parse(localStorage.getItem(STORE) || "null");
  if (s && typeof s === "object") {
    const sc = s.scores || {};
    saved = { ...saved, ...s, scores: {
      ai: { ...saved.scores.ai, ...(sc.ai || {}) },
      two: { ...saved.scores.two, ...(sc.two || {}) }
    }};
  }
} catch (e) {}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch (e) {}
}

/* ---------- State ---------- */
let mode = saved.mode;                  // "ai" ya "two"
let level = saved.level;
let human = saved.side, ai = saved.side === "X" ? "O" : "X";
let turn = "X";                         // 2 player mode me kiski baari hai
let board = [], over = false, busy = false;

/* ---------- Sound (Web Audio, koi file nahi chahiye) ---------- */
const sound = {
  on: true, ctx: null,
  getCtx() {
    this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
    return this.ctx;
  },
  beep(freq, dur = 0.12, type = "sine", delay = 0) {
    if (!this.on) return;
    try {
      const c = this.getCtx(), t = c.currentTime + delay;
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(0.08, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(c.destination);
      o.start(t); o.stop(t + dur);
    } catch (err) {}
  },
  // Awaaz neeche girti hui (sad trombone jaisa "wah wah wahhh")
  glide(from, to, dur, delay = 0) {
    if (!this.on) return;
    try {
      const c = this.getCtx(), t = c.currentTime + delay;
      const o = c.createOscillator(), g = c.createGain();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(from, t);
      o.frequency.exponentialRampToValueAtTime(to, t + dur);
      g.gain.setValueAtTime(0.07, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
      o.connect(g); g.connect(c.destination);
      o.start(t); o.stop(t + dur + 0.05);
    } catch (err) {}
  },
  // Crowd cheer jaisa shor (noise burst)
  cheer(dur = 1.4) {
    if (!this.on) return;
    try {
      const c = this.getCtx(), t = c.currentTime;
      const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const src = c.createBufferSource(); src.buffer = buf;
      const f = c.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1800; f.Q.value = 0.6;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.25);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(c.destination);
      src.start(t);
    } catch (err) {}
  },
  // Browser ki awaaz se bolna: "Yeahhh!" / "Oh no"
  speak(text, pitch, rate) {
    if (!this.on || !("speechSynthesis" in window)) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.pitch = pitch; u.rate = rate; u.volume = 1;
      speechSynthesis.speak(u);
    } catch (err) {}
  },
  place(isHuman) { this.beep(isHuman ? 620 : 420, 0.1, "triangle"); },
  win() {
    [523, 659, 784, 1047, 1319].forEach((f, i) => this.beep(f, 0.22, "triangle", i * 0.1));
    this.cheer();
    this.speak("Yeaaaah!", 1.6, 0.8);
  },
  lose() {
    this.glide(311, 294, 0.35, 0);
    this.glide(294, 277, 0.35, 0.4);
    this.glide(277, 262, 0.35, 0.8);
    this.glide(262, 175, 1.0, 1.2);
    this.speak("Oh noooo", 0.5, 0.7);
  },
  draw() { this.beep(400, 0.2, "sine"); this.beep(400, 0.2, "sine", 0.2); }
};

/* ---------- Effects: confetti aur sad rain ---------- */
function shower(items, count, ms) {
  const wrap = document.createElement("div");
  wrap.className = "shower";
  for (let i = 0; i < count; i++) {
    const s = document.createElement("span");
    s.textContent = items[i % items.length];
    s.style.left = Math.random() * 100 + "vw";
    s.style.fontSize = (18 + Math.random() * 22) + "px";
    s.style.animationDuration = (ms / 1000 - 1 + Math.random()) + "s";
    s.style.animationDelay = (Math.random() * 0.8) + "s";
    wrap.appendChild(s);
  }
  document.body.appendChild(wrap);
  setTimeout(() => wrap.remove(), ms + 1500);
}
function shakeBoard() {
  const b = $("#board");
  b.classList.add("shake");
  setTimeout(() => b.classList.remove("shake"), 600);
}

/* ---------- Game logic ---------- */
function winner(b) {
  for (const [a, c, d] of LINES) {
    if (b[a] && b[a] === b[c] && b[a] === b[d]) return { p: b[a], line: [a, c, d] };
  }
  return null;
}
const full = b => b.every(v => v !== "");
const empties = b => b.reduce((r, v, i) => (v === "" ? r.concat(i) : r), []);

/* ---------- AI: Minimax ---------- */
// AI jeete to +score, human jeete to -score, draw to 0.
// depth se AI jaldi jeetne wali move prefer karta hai.
function minimax(b, aiTurn, depth) {
  const w = winner(b);
  if (w) return w.p === ai ? 10 - depth : depth - 10;
  if (full(b)) return 0;
  let best = aiTurn ? -Infinity : Infinity;
  for (const i of empties(b)) {
    b[i] = aiTurn ? ai : human;
    const s = minimax(b, !aiTurn, depth + 1);
    b[i] = "";
    best = aiTurn ? Math.max(best, s) : Math.min(best, s);
  }
  return best;
}
function bestMove(b) {
  if (empties(b).length === 9) {            // pehli move: corner ya center (fast)
    const open = [0, 2, 4, 6, 8];
    return open[Math.floor(Math.random() * open.length)];
  }
  let best = -Infinity, move = null;
  for (const i of empties(b)) {
    b[i] = ai;
    const s = minimax(b, false, 0);
    b[i] = "";
    if (s > best) { best = s; move = i; }
  }
  return move;
}
function randomMove(b) {
  const e = empties(b);
  return e[Math.floor(Math.random() * e.length)];
}
function pickAiMove() {
  if (level === "easy") return randomMove(board);
  if (level === "medium") return Math.random() < 0.5 ? bestMove(board) : randomMove(board);
  return bestMove(board);
}

/* ---------- UI ---------- */
function render(winLine = [], last = -1) {
  const el = $("#board");
  el.innerHTML = "";
  board.forEach((v, i) => {
    const b = document.createElement("button");
    b.className = "cell" + (v ? " " + v.toLowerCase() : "") +
                  (i === last ? " pop" : "") + (winLine.includes(i) ? " win" : "");
    b.textContent = v;
    b.disabled = over || busy || v !== "";
    b.setAttribute("aria-label", "Cell " + (i + 1) + (v ? ", " + v : ", empty"));
    b.addEventListener("click", () => cellClick(i));
    el.appendChild(b);
  });
  showScores();
}
function showScores() {
  if (mode === "ai") {
    const s = saved.scores.ai;
    $("#sYou").textContent = s.w; $("#sDraw").textContent = s.d; $("#sAi").textContent = s.l;
  } else {
    const s = saved.scores.two;
    $("#sYou").textContent = s.x; $("#sDraw").textContent = s.d; $("#sAi").textContent = s.o;
  }
}
function updateLabels() {
  if (mode === "ai") {
    $("#levelTag").textContent = "Level: " + level[0].toUpperCase() + level.slice(1);
    $("#youLabel").textContent = "You (" + human + ")";
    $("#aiLabel").textContent = "AI";
  } else {
    $("#levelTag").textContent = "2 Players";
    $("#youLabel").textContent = "Player X";
    $("#aiLabel").textContent = "Player O";
  }
}
const setStatus = t => { $("#status").textContent = t; };

function checkEnd(last) {
  const w = winner(board);
  if (w) {
    over = true; busy = false;
    let title, sub, good;
    if (mode === "ai") {
      good = w.p === human;
      if (good) saved.scores.ai.w++; else saved.scores.ai.l++;
      title = good ? "You won!" : "AI wins";
      sub = good ? "Yeahhh! The AI did not see that coming." : "Aww, better luck next round.";
    } else {
      good = true;
      if (w.p === "X") saved.scores.two.x++; else saved.scores.two.o++;
      title = "Player " + w.p + " wins!";
      sub = "Great game! Ready for a rematch?";
    }
    save();
    if (good) {
      sound.win();
      shower(["🎉", "✨", "🎊", "⭐", "💖"], 50, 3500);
    } else {
      sound.lose();
      shower(["😢", "💧", "🌧️"], 24, 4500);
      shakeBoard();
    }
    render(w.line, last);
    setStatus(title);
    setTimeout(() => showResult(title, sub), 900);
    return true;
  }
  if (full(board)) {
    over = true; busy = false;
    if (mode === "ai") saved.scores.ai.d++; else saved.scores.two.d++;
    save();
    sound.draw();
    render([], last);
    setStatus("It’s a draw");
    setTimeout(() => showResult("It’s a draw", "Well played. Try again?"), 700);
    return true;
  }
  return false;
}
function showResult(title, sub) {
  $("#mTitle").textContent = title;
  $("#mSub").textContent = sub;
  $("#overlay").classList.remove("hidden");
}
function cellClick(i) {
  if (over || busy || board[i] !== "") return;
  const who = mode === "ai" ? human : turn;
  board[i] = who;
  sound.place(who === "X");
  busy = mode === "ai";                 // AI mode me AI ki baari tak click band
  render([], i);
  if (checkEnd(i)) return;
  if (mode === "ai") {
    aiTurn();
  } else {
    turn = who === "X" ? "O" : "X";
    setStatus("Player " + turn + "’s turn");
  }
}
function aiTurn() {
  busy = true;
  setStatus("AI is thinking…");
  render();
  setTimeout(() => {
    const m = pickAiMove();
    board[m] = ai;
    sound.place(false);
    busy = false;
    render([], m);
    if (!checkEnd(m)) setStatus("Your turn (" + human + ")");
  }, 450);
}
function newRound() {
  $("#overlay").classList.add("hidden");
  board = Array(9).fill("");
  over = false; busy = false; turn = "X";
  render();
  if (mode === "ai") {
    if (ai === "X") aiTurn();           // X hamesha pehle khelta hai
    else setStatus("Your turn (" + human + ")");
  } else {
    setStatus("Player X’s turn");
  }
}
function showScreen(id) {
  $("#start").classList.toggle("hidden", id !== "start");
  $("#game").classList.toggle("hidden", id !== "game");
  $("#overlay").classList.add("hidden");
}

/* ---------- Menu controls ---------- */
function setPill(id, attr, val) {
  document.querySelectorAll("#" + id + " .pill").forEach(b =>
    b.classList.toggle("on", b.dataset[attr] === val));
}
function bindPills(id, attr, cb) {
  document.querySelectorAll("#" + id + " .pill").forEach(btn => {
    btn.addEventListener("click", () => {
      setPill(id, attr, btn.dataset[attr]);
      cb(btn.dataset[attr]);
    });
  });
}
function syncMenu() {                   // 2 player me level aur side ki zaroorat nahi
  $("#levelGroup").classList.toggle("hidden", mode === "two");
  $("#sideGroup").classList.toggle("hidden", mode === "two");
  document.querySelector(".sub").textContent =
    mode === "ai" ? "Can you outsmart the AI?" : "Challenge a friend!";
}
function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
}

bindPills("modes", "mode", v => { mode = v; saved.mode = v; save(); syncMenu(); });
bindPills("levels", "level", v => { level = v; saved.level = v; save(); });
bindPills("sides", "side", v => {
  human = v; ai = v === "X" ? "O" : "X"; saved.side = v; save();
});
bindPills("themes", "skin", v => { saved.theme = v; save(); applyTheme(v); });

$("#play").addEventListener("click", () => {
  updateLabels();
  showScreen("game");
  newRound();
});
$("#back").addEventListener("click", () => showScreen("start"));
$("#toMenu").addEventListener("click", () => showScreen("start"));
$("#restart").addEventListener("click", newRound);
$("#again").addEventListener("click", newRound);
$("#resetScore").addEventListener("click", () => {
  if (!confirm("Is mode ka saved score reset kar du?")) return;
  if (mode === "ai") saved.scores.ai = { w: 0, l: 0, d: 0 };
  else saved.scores.two = { x: 0, o: 0, d: 0 };
  save();
  showScores();
});
$("#sound").addEventListener("click", () => {
  sound.on = !sound.on;
  saved.sound = sound.on; save();
  $("#sound").textContent = "Sound: " + (sound.on ? "On" : "Off");
});

/* ---------- Start: saved settings wapas lagao ---------- */
sound.on = saved.sound !== false;
$("#sound").textContent = "Sound: " + (sound.on ? "On" : "Off");
applyTheme(saved.theme);
setPill("modes", "mode", mode);
setPill("levels", "level", level);
setPill("sides", "side", human);
setPill("themes", "skin", saved.theme);
syncMenu();