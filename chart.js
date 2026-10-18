// The Money Map calculator, browser edition. A line-by-line port of money-map/scripts/chart.py:
// birth chart, Human Design and Gene Keys from one daily ephemeris table (1919-2040),
// interpolated to the minute of birth. Runs entirely in the reader's browser.

const SIGNS = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
  "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"];
const ELEMENT = ["Fire", "Earth", "Air", "Water", "Fire", "Earth", "Air", "Water", "Fire", "Earth", "Air", "Water"];
const MODALITY = ["Cardinal", "Fixed", "Mutable", "Cardinal", "Fixed", "Mutable",
  "Cardinal", "Fixed", "Mutable", "Cardinal", "Fixed", "Mutable"];
const RULER_TRAD = ["Mars", "Venus", "Mercury", "Moon", "Sun", "Mercury",
  "Venus", "Mars", "Jupiter", "Saturn", "Saturn", "Jupiter"];
const RULER_MODERN = { 7: "Pluto", 10: "Uranus", 11: "Neptune" };
const TABLE_BODIES = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn",
  "Uranus", "Neptune", "Pluto", "North Node", "Lilith"];
const PLANETS = TABLE_BODIES.slice(0, 10);
// columns 12 and 13 hold obliquity and nutation; these follow them
const EXTRA_BODIES = ["Chiron", "Fortuna", "Tyche", "Abundantia", "Mony", "Midas", "Gold"];
const MONEY_ASTEROIDS = EXTRA_BODIES.slice(1);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

const rad = (d) => d * Math.PI / 180;
const deg = (r) => r * 180 / Math.PI;
const mod = (a, n) => ((a % n) + n) % n;
// Python's floor-modulo, which the original relies on for negative angles
const pmod = (a, n) => a - n * Math.floor(a / n);

// ------------------------------------------------------------ ephemeris

export async function loadEphemeris(arrayBuffer) {
  const head = new DataView(arrayBuffer, 0, 20);
  const jd0 = head.getFloat64(4, true);
  const n = head.getInt32(12, true);
  const cols = head.getInt32(16, true);
  const stream = new Blob([arrayBuffer.slice(20)]).stream().pipeThrough(new DecompressionStream("deflate"));
  const raw = await new Response(stream).arrayBuffer();
  const view = new DataView(raw);
  const v = new Int32Array(n * cols);
  for (let i = 0; i < v.length; i++) v[i] = view.getInt32(i * 4, true);
  return new Ephemeris(jd0, n, cols, v);
}

class Ephemeris {
  constructor(jd0, n, cols, v) { Object.assign(this, { jd0, n, cols, v }); }
  val(day, col) { return this.v[day * this.cols + col] / 100000.0; }
  at(jd, col, angular = true) {
    const d = jd - this.jd0;
    const i = Math.floor(d);
    if (i < 2 || i + 3 >= this.n) throw new Error("Birth date outside the supported range (1919 to 2040).");
    const xs = [i - 2, i - 1, i, i + 1, i + 2, i + 3];
    const ys = xs.map((x) => this.val(x, col));
    if (angular) {
      for (let k = 1; k < 6; k++) {
        while (ys[k] - ys[k - 1] > 180) ys[k] -= 360;
        while (ys[k] - ys[k - 1] < -180) ys[k] += 360;
      }
    }
    let total = 0;
    for (let j = 0; j < 6; j++) {
      let w = 1;
      for (let m = 0; m < 6; m++) if (m !== j) w *= (d - xs[m]) / (xs[j] - xs[m]);
      total += w * ys[j];
    }
    return angular ? pmod(total, 360) : total;
  }
  lon(jd, body) {
    const x = EXTRA_BODIES.indexOf(body);
    return this.at(jd, x >= 0 ? 14 + x : TABLE_BODIES.indexOf(body));
  }
  speed(jd, body) {
    const a = this.lon(jd - 0.02, body), b = this.lon(jd + 0.02, body);
    return (pmod(b - a + 180, 360) - 180) / 0.04;
  }
  obliquity(jd) { return this.at(jd, 12, false); }
  nutation(jd) { return this.at(jd, 13, false); }
}

// ------------------------------------------------------------ time and angles

function julday(y, m, dayFrac) {
  if (m <= 2) { y -= 1; m += 12; }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.trunc(365.25 * (y + 4716)) + Math.trunc(30.6001 * (m + 1)) + dayFrac + b - 1524.5;
}
function juldayFromMs(ms) {
  const t = new Date(ms);
  return julday(t.getUTCFullYear(), t.getUTCMonth() + 1,
    t.getUTCDate() + (t.getUTCHours() + t.getUTCMinutes() / 60 + t.getUTCSeconds() / 3600) / 24);
}
function msFromJulday(jd) { return Date.UTC(2000, 0, 1, 12) + (jd - 2451545.0) * 86400000; }

function armc(E, jd, lonEast) {
  const t = (jd - 2451545.0) / 36525;
  const gmst = 280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * t * t - t ** 3 / 38710000;
  const eps = rad(E.obliquity(jd));
  const gast = gmst + E.nutation(jd) * Math.cos(eps);
  return pmod(gast + lonEast, 360);
}
function ascendant(ramc, eps, lat) {
  const r = rad(ramc), e = rad(eps), f = rad(lat);
  return pmod(deg(Math.atan2(Math.cos(r), -(Math.sin(r) * Math.cos(e) + Math.tan(f) * Math.sin(e)))), 360);
}
function midheaven(ramc, eps) {
  const r = rad(ramc), e = rad(eps);
  return pmod(deg(Math.atan2(Math.sin(r), Math.cos(r) * Math.cos(e))), 360);
}
function vertex(ramc, eps, lat) {
  let v = ascendant(pmod(ramc + 180, 360), eps, 90 - lat);
  const dsc = pmod(ascendant(ramc, eps, lat) + 180, 360);
  if (Math.abs(pmod(v - dsc + 180, 360) - 180) > 90) v = pmod(v + 180, 360);
  return v;
}
function sunAltitude(E, jd, lat, lonEast, sunLon) {
  const eps = rad(E.obliquity(jd));
  const lam = rad(sunLon);
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  const h = rad(armc(E, jd, lonEast)) - ra;
  const f = rad(lat);
  return deg(Math.asin(Math.sin(f) * Math.sin(dec) + Math.cos(f) * Math.cos(dec) * Math.cos(h)));
}
const signIdx = (d) => Math.floor(pmod(d, 360) / 30);
function fmt(d0) {
  const d1 = pmod(d0, 360);
  const s = signIdx(d1);
  const r = d1 - 30 * s;
  let d = Math.floor(r);
  let m = pyRound((r - d) * 60);
  if (m === 60) { d += 1; m = 0; }
  return `${d}°${String(m).padStart(2, "0")}' ${SIGNS[s]}`;
}
// Python's round(): halves go to the even neighbour
function pyRound(x) {
  const f = Math.floor(x), diff = x - f;
  if (diff > 0.5) return f + 1;
  if (diff < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}
const fix1 = (x) => (Math.round(x * 10 + 1e-9) / 10).toFixed(1);

// ------------------------------------------------------------ Human Design

const GATE_WHEEL = [41, 19, 13, 49, 30, 55, 37, 63, 22, 36, 25, 17, 21, 51, 42, 3,
  27, 24, 2, 23, 8, 20, 16, 35, 45, 12, 15, 52, 39, 53, 62, 56,
  31, 33, 7, 4, 29, 59, 40, 64, 47, 6, 46, 18, 48, 57, 32, 50,
  28, 44, 1, 43, 14, 34, 9, 5, 26, 11, 10, 58, 38, 54, 61, 60];
const WHEEL_START = 302.0;
const GATE_SPAN = 360.0 / 64;
const CENTRE_GATES = {
  "Head": [64, 61, 63],
  "Ajna": [47, 24, 4, 17, 43, 11],
  "Throat": [62, 23, 56, 35, 12, 45, 33, 8, 31, 20, 16],
  "G": [1, 13, 25, 46, 2, 15, 10, 7],
  "Heart": [21, 40, 26, 51],
  "Sacral": [5, 14, 29, 59, 9, 3, 42, 27, 34],
  "Solar Plexus": [6, 37, 22, 36, 30, 55, 49],
  "Spleen": [48, 57, 44, 50, 32, 28, 18],
  "Root": [53, 60, 52, 19, 39, 41, 58, 38, 54],
};
const CENTRES = Object.keys(CENTRE_GATES);
const GATE_CENTRE = {};
for (const [c, gs] of Object.entries(CENTRE_GATES)) for (const g of gs) GATE_CENTRE[g] = c;
const CHANNELS = [[1, 8], [2, 14], [3, 60], [4, 63], [5, 15], [6, 59], [7, 31], [9, 52],
  [10, 20], [10, 34], [10, 57], [11, 56], [12, 22], [13, 33], [16, 48],
  [17, 62], [18, 58], [19, 49], [20, 34], [20, 57], [21, 45], [23, 43],
  [24, 61], [25, 51], [26, 44], [27, 50], [28, 38], [29, 46], [30, 41],
  [32, 54], [34, 57], [35, 36], [37, 40], [39, 55], [42, 53], [47, 64]];
const MOTORS = new Set(["Sacral", "Heart", "Solar Plexus", "Root"]);
const AUTHORITY_TIMING = {
  "Lunar": "about 28 days, a full lunar cycle, talked through with trusted people",
  "Emotional (Solar Plexus)": "never in the moment; wait out the emotional wave and decide once the high and the low have both passed, which takes days",
  "Sacral": "in the moment; the gut answers a yes-or-no question straight away, with no waiting needed",
  "Splenic": "in the moment; the first quiet instinct, which speaks once and does not repeat itself",
  "Ego Manifested": "say out loud what the will actually wants, then decide; no long waiting",
  "Ego Projected": "say out loud what the will actually wants, to someone who asked; no long waiting",
  "Self-Projected": "talk it through with someone trusted and listen to what your own voice says",
  "Mental (no inner authority; sounding board and environment)": "talk it over with trusted people in the right environment and take time; never decide alone in the head",
};
const HD_BODIES = ["Sun", "Earth", "Moon", "North Node", "South Node", "Mercury", "Venus",
  "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];

function gateLine(lon) {
  const off = pmod(lon - WHEEL_START, 360);
  const idx = Math.floor(off / GATE_SPAN);
  return [GATE_WHEEL[idx], Math.floor(pmod(off, GATE_SPAN) / GATE_SPAN * 6) + 1];
}
function hdPositions(E, jd) {
  const p = {};
  for (const b of ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto", "North Node"]) p[b] = E.lon(jd, b);
  p["Earth"] = pmod(p["Sun"] + 180, 360);
  p["South Node"] = pmod(p["North Node"] + 180, 360);
  const out = {};
  for (const b of HD_BODIES) out[b] = gateLine(p[b]);
  return out;
}
function designJd(E, jdBirth) {
  const target = pmod(E.lon(jdBirth, "Sun") - 88.0, 360);
  let lo = jdBirth - 95.0, hi = jdBirth - 80.0;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (pmod(target - E.lon(mid, "Sun"), 360) < 180) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
function humanDesign(pers, des) {
  const active = new Set([...Object.values(pers).map((x) => x[0]), ...Object.values(des).map((x) => x[0])]);
  const channels = CHANNELS.filter(([a, b]) => active.has(a) && active.has(b));
  const defined = new Set(channels.flatMap(([a, b]) => [GATE_CENTRE[a], GATE_CENTRE[b]]));
  const adj = {};
  for (const c of defined) adj[c] = new Set();
  for (const [a, b] of channels) { adj[GATE_CENTRE[a]].add(GATE_CENTRE[b]); adj[GATE_CENTRE[b]].add(GATE_CENTRE[a]); }
  const reach = (start) => {
    const seen = new Set([start]), stack = [start];
    while (stack.length) for (const n of adj[stack.pop()]) if (!seen.has(n)) { seen.add(n); stack.push(n); }
    return seen;
  };
  const comps = [];
  const left = new Set(defined);
  // Python iterates a set here; group order only affects the printed order, so follow centre order
  while (left.size) {
    const first = CENTRES.find((c) => left.has(c));
    const comp = reach(first);
    comps.push(comp);
    for (const c of comp) left.delete(c);
  }
  const definition = { 0: "None", 1: "Single", 2: "Split", 3: "Triple Split", 4: "Quadruple Split" }[comps.length];
  const throatNet = defined.has("Throat") ? reach("Throat") : new Set();
  const motorToThroat = [...throatNet].some((c) => MOTORS.has(c));

  let type;
  if (!defined.size) type = "Reflector";
  else if (defined.has("Sacral")) type = motorToThroat ? "Manifesting Generator" : "Generator";
  else if (motorToThroat) type = "Manifestor";
  else type = "Projector";

  const strategy = {
    "Generator": "To respond", "Manifesting Generator": "To respond, then inform",
    "Manifestor": "To inform before acting", "Projector": "To wait for recognition and the invitation",
    "Reflector": "To wait a lunar cycle (about 28 days) before big decisions",
  }[type];
  const [signature, notSelf] = {
    "Generator": ["Satisfaction", "Frustration"], "Manifesting Generator": ["Satisfaction", "Frustration"],
    "Manifestor": ["Peace", "Anger"], "Projector": ["Success", "Bitterness"], "Reflector": ["Surprise", "Disappointment"],
  }[type];

  let authority;
  if (type === "Reflector") authority = "Lunar";
  else if (defined.has("Solar Plexus")) authority = "Emotional (Solar Plexus)";
  else if (defined.has("Sacral")) authority = "Sacral";
  else if (defined.has("Spleen")) authority = "Splenic";
  else if (defined.has("Heart")) authority = adj["Heart"].has("Throat") ? "Ego Manifested" : "Ego Projected";
  else if (defined.has("G") && adj["G"].has("Throat")) authority = "Self-Projected";
  else authority = "Mental (no inner authority; sounding board and environment)";

  const pLine = pers["Sun"][1], dLine = des["Sun"][1];
  const profile = `${pLine}/${dLine}`;
  const angle = profile === "4/1" ? "Juxtaposition" : (pLine === 5 || pLine === 6) ? "Left Angle" : "Right Angle";
  const inChannel = new Set(channels.flat());
  const hanging = [...active].filter((g) => !inChannel.has(g)).sort((a, b) => a - b);

  return {
    type, strategy, authority, signature, notSelf, profile, definition, groups: comps,
    defined: CENTRES.filter((c) => defined.has(c)), open: CENTRES.filter((c) => !defined.has(c)),
    channels, hanging, cross: [angle, pers["Sun"][0], pers["Earth"][0], des["Sun"][0], des["Earth"][0]],
  };
}

// ------------------------------------------------------------ aspects

const ASPECTS = [["conjunction", 0, 8], ["opposition", 180, 8], ["trine", 120, 7],
  ["square", 90, 7], ["sextile", 60, 5], ["quincunx", 150, 3]];
const SMALL = new Set(["Ascendant", "Midheaven", "North Node", "Lilith", "Part of Fortune", "Vertex"]);
function aspects(points) {
  const names = Object.keys(points);
  const found = [];
  for (let i = 0; i < names.length; i++) {
    for (const b of names.slice(i + 1)) {
      const a = names[i];
      if (SMALL.has(a) && SMALL.has(b)) continue;
      const sep = Math.abs(pmod(points[a] - points[b] + 180, 360) - 180);
      for (const [asp, ang, orb] of ASPECTS) {
        let o = orb;
        if ([a, b].includes("Sun") || [a, b].includes("Moon")) o += 1;
        if (SMALL.has(a) || SMALL.has(b)) o = Math.min(o, (ang === 0 || ang === 180) ? 5 : 3);
        if (Math.abs(sep - ang) <= o) found.push([a, asp, b, Math.abs(sep - ang)]);
      }
    }
  }
  return found;
}
const tightness = (orb) => orb < 1 ? "exact" : orb < 3 ? "tight" : orb < 5 ? "moderate" : "wide";

// ------------------------------------------------------------ time zones

function zoneOffsetMs(ms, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(ms));
  const g = (t) => +parts.find((p) => p.type === t).value;
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - ms;
}
// Local wall-clock time in an IANA zone -> UTC milliseconds, daylight saving history included.
export function localToUtcMs(y, mo, d, h, mi, tz) {
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let utc = wall - zoneOffsetMs(wall, tz);
  utc = wall - zoneOffsetMs(utc, tz);
  return utc;
}
function offsetLabel(ms) {
  const mins = Math.round(ms / 60000), sign = mins < 0 ? "-" : "+", a = Math.abs(mins);
  return `UTC${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}

// ------------------------------------------------------------ the report

export function computeChart(E, { name, date, time, place = "", lat, lon, tz }) {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const utcMs = localToUtcMs(y, mo, d, h, mi, tz);
  const offMs = Date.UTC(y, mo - 1, d, h, mi) - utcMs;
  const jd = juldayFromMs(utcMs);
  const u = new Date(utcMs);

  const pos = {};
  for (const b of [...TABLE_BODIES, ...EXTRA_BODIES]) pos[b] = E.lon(jd, b);
  const retro = {};
  for (const b of [...PLANETS.slice(2), ...EXTRA_BODIES]) retro[b] = E.speed(jd, b) < 0;
  const eps = E.obliquity(jd);
  const ramc = armc(E, jd, lon);
  const asc = ascendant(ramc, eps, lat), mc = midheaven(ramc, eps), vx = vertex(ramc, eps, lat);
  const day = sunAltitude(E, jd, lat, lon, pos["Sun"]) > 0;
  const pof = pmod(day ? asc + pos["Moon"] - pos["Sun"] : asc + pos["Sun"] - pos["Moon"], 360);
  const ascSign = signIdx(asc);
  const house = (x) => mod(signIdx(x) - ascSign, 12) + 1;

  const P = [];
  const say = (s) => P.push(s);
  const two = (n) => String(n).padStart(2, "0");
  say(`# CHART DATA: ${name}`);
  say("");
  say(`Born ${two(d)} ${MONTHS[mo - 1]} ${y}, ${two(h)}:${two(mi)} local time (${offsetLabel(offMs)}), ` +
    `${place || `${lat}, ${lon}`}. Universal Time ${u.getUTCFullYear()}-${two(u.getUTCMonth() + 1)}-${two(u.getUTCDate())} ${two(u.getUTCHours())}:${two(u.getUTCMinutes())}.`);
  say(`Coordinates ${Math.abs(lat).toFixed(4)}${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(4)}${lon >= 0 ? "E" : "W"}. ` +
    `Tropical zodiac, Whole Sign houses. ${day ? "Day" : "Night"} chart.`);
  say("");

  say("## Angles");
  const toEdge = Math.min(pmod(asc, 30), 30 - pmod(asc, 30));
  say(`- Ascendant: ${fmt(asc)}`);
  say(`- Midheaven: ${fmt(mc)} (falls in whole sign house ${house(mc)})`);
  say(`- Vertex: ${fmt(vx)} (house ${house(vx)})`);
  say(`- Part of Fortune: ${fmt(pof)} (house ${house(pof)}, ${day ? "day" : "night"} formula)`);
  let shift = null;
  outer: for (let minutes = 1; minutes < 31; minutes++) {
    for (const sgn of [-1, 1]) {
      const j2 = jd + sgn * minutes / 1440;
      if (signIdx(ascendant(armc(E, j2, lon), E.obliquity(j2), lat)) !== ascSign) {
        shift = [minutes, sgn < 0 ? "earlier" : "later"];
        break outer;
      }
    }
  }
  if (shift && shift[0] > 5) {
    say(`- Birth time margin: the rising sign holds for at least ${shift[0]} minutes either way. No warning needed.`);
  } else if (shift) {
    say(`- BIRTH TIME WARNING: the Ascendant is ${pyRound(toEdge * 60).toFixed(0)} arc-minutes from a sign boundary. ` +
      `A birth time ${shift[0]} minute(s) ${shift[1]} changes the rising sign and moves every house. ` +
      `Say this plainly in Chapter 1.`);
  }
  say("");

  say("## Planets (sign, whole sign house)");
  for (const b of TABLE_BODIES) say(`- ${b}: ${fmt(pos[b])}${retro[b] ? " retrograde" : ""}, house ${house(pos[b])}`);
  const sn = pmod(pos["North Node"] + 180, 360);
  say(`- South Node: ${fmt(sn)}, house ${house(sn)}`);
  say(`- Chiron: ${fmt(pos["Chiron"])}${retro["Chiron"] ? " retrograde" : ""}, house ${house(pos["Chiron"])}`);
  say("(North Node is the true node. Lilith is the mean Black Moon.)");
  say("");

  say("## Houses, residents and rulers");
  const residents = {}, landing = {};
  for (let hh = 1; hh <= 12; hh++) residents[hh] = [...PLANETS, "North Node"].filter((b) => house(pos[b]) === hh);
  for (let hh = 1; hh <= 12; hh++) {
    const s = (ascSign + hh - 1) % 12;
    const trad = RULER_TRAD[s];
    const rh = house(pos[trad]);
    landing[hh] = rh;
    let line = `- House ${hh} (${SIGNS[s]}): residents ${residents[hh].join(", ") || "none"}. ` +
      `Ruler ${trad} sits in ${SIGNS[signIdx(pos[trad])]}, house ${rh}`;
    const notes = [];
    if (signIdx(pos[trad]) === s) notes.push("ruler in its own sign");
    if (rh === hh) notes.push("ruler in its own house");
    if (s in RULER_MODERN) {
      const m = RULER_MODERN[s];
      line += `; modern ruler ${m} in ${SIGNS[signIdx(pos[m])]}, house ${house(pos[m])}`;
    }
    line += ".";
    if (notes.length) line += ` NOTE: ${notes.join(", ")}.`;
    say(line);
  }
  say(`- Chart ruler (ruler of the Ascendant sign): ${RULER_TRAD[ascSign]}, in house ${landing[1]}` +
    (ascSign in RULER_MODERN ? `; modern co-ruler ${RULER_MODERN[ascSign]}, house ${house(pos[RULER_MODERN[ascSign]])}` : ""));
  const byTarget = new Map();
  for (let hh = 1; hh <= 12; hh++) {
    const t = landing[hh];
    if (!byTarget.has(t)) byTarget.set(t, []);
    byTarget.get(t).push(hh);
  }
  // Python: sorted(by_target.items(), key=-len), stable, over dict insertion order
  const groups = [...byTarget.entries()].sort((a, b) => b[1].length - a[1].length)
    .map(([t, hs]) => `house ${t} receives the rulers of houses ${hs.join(", ")}`).join("; ");
  say(`- Where the rulers gather: ${groups}.`);
  const stell = [];
  for (let hh = 1; hh <= 12; hh++) {
    if (residents[hh].filter((x) => PLANETS.includes(x)).length >= 3) stell.push(`house ${hh} (${residents[hh].join(", ")})`);
  }
  say(`- Houses holding three or more planets: ${stell.length ? stell.join("; ") : "none"}.`);
  say("");

  say("## Element and modality balance (Sun to Pluto, plus Ascendant)");
  const pts = [...PLANETS.map((b) => pos[b]), asc];
  for (const [label, table, keys] of [["Elements", ELEMENT, ["Fire", "Earth", "Air", "Water"]],
    ["Modalities", MODALITY, ["Cardinal", "Fixed", "Mutable"]]]) {
    const counts = {};
    for (const x of pts) counts[table[signIdx(x)]] = (counts[table[signIdx(x)]] || 0) + 1;
    const missing = keys.filter((k) => !counts[k]);
    say(`- ${label}: ` + keys.map((k) => `${k} ${counts[k] || 0}`).join(", ") + (missing.length ? `. Missing: ${missing.join(", ")}` : ""));
  }
  say("");

  say("## Aspects (every major aspect, with tightness; orb in degrees is for your thinking only)");
  const apts = {};
  for (const b of [...PLANETS, "North Node"]) apts[b] = pos[b];
  Object.assign(apts, { "Ascendant": asc, "Midheaven": mc, "Part of Fortune": pof });
  const found = aspects(apts);
  for (const b of [...PLANETS, "North Node", "Ascendant", "Midheaven", "Part of Fortune"]) {
    const mine = found.filter(([x, , yy]) => x === b || yy === b)
      .map(([x, asp, yy, orb]) => [yy === b ? x : yy, asp, orb])
      .sort((p, q) => p[2] - q[2]);
    if (mine.length) say(`- ${b} (${mine.length}): ` + mine.map(([o, asp, orb]) => `${asp} ${o} (${tightness(orb)}, ${fix1(orb)})`).join("; "));
    else say(`- ${b} (0): no major aspects`);
  }
  say("");

  say("## Money asteroids (sign, whole sign house, contacts within a few degrees)");
  const targets = {};
  for (const b of [...PLANETS, "North Node"]) targets[b] = pos[b];
  Object.assign(targets, { "Ascendant": asc, "Midheaven": mc, "Vertex": vx, "Part of Fortune": pof });
  for (const aName of MONEY_ASTEROIDS) {
    const contacts = [];
    for (const [tName, tLon] of Object.entries(targets)) {
      const sep = Math.abs(pmod(pos[aName] - tLon + 180, 360) - 180);
      for (const [asp, ang, orb] of [["conjunction", 0, 5], ["opposition", 180, 5], ["square", 90, 3],
        ["trine", 120, 3], ["sextile", 60, 2]]) {
        const o = Math.abs(sep - ang);
        if (o <= orb) contacts.push([o, `${asp} ${tName} (${tightness(o)}, ${fix1(o)})`]);
      }
    }
    // Python sorts the (orb, text) tuples: by orb, then by text
    contacts.sort((p, q) => p[0] - q[0] || (p[1] < q[1] ? -1 : p[1] > q[1] ? 1 : 0));
    say(`- ${aName}: ${fmt(pos[aName])}${retro[aName] ? " retrograde" : ""}, house ${house(pos[aName])}. ` +
      (contacts.length ? "Contacts: " + contacts.map((c) => c[1]).join("; ") : "No close contacts."));
  }
  say("(Fortuna is the asteroid, not the Part of Fortune.)");
  say("");

  const jdD = designJd(E, jd);
  const pers = hdPositions(E, jd), des = hdPositions(E, jdD);
  const hd = humanDesign(pers, des);
  say("## Human Design");
  say(`- Type: ${hd.type}`);
  say(`- Strategy: ${hd.strategy}`);
  say(`- Inner authority: ${hd.authority}`);
  say(`- Decision timing for this authority: ${AUTHORITY_TIMING[hd.authority]}`);
  say(`- Signature: ${hd.signature}. Not-self theme: ${hd.notSelf}`);
  say(`- Profile: ${hd.profile}`);
  say(`- Definition: ${hd.definition}` + (hd.groups.length > 1
    ? " (" + hd.groups.map((g) => [...g].sort().join(" + ")).join(" | ") + ")" : ""));
  say(`- Defined centres: ${hd.defined.join(", ") || "none"}`);
  say(`- Undefined (open) centres: ${hd.open.join(", ") || "none"}`);
  say("- Channels: " + (hd.channels.map(([x, yy]) => `${x}-${yy} (${GATE_CENTRE[x]} to ${GATE_CENTRE[yy]})`).join("; ") || "none"));
  say("- Hanging gates (active, not part of a full channel): " + hd.hanging.map((g) => `${g} (${GATE_CENTRE[g]})`).join(", "));
  const [ang, ps, pe, ds, de] = hd.cross;
  say(`- Incarnation Cross: ${ang} Cross, gates ${ps}/${pe} | ${ds}/${de} ` +
    `(Personality Sun/Earth | Design Sun/Earth). Name the cross only if you know it with certainty ` +
    `from these four gates; otherwise describe it by its gates.`);
  const dd = new Date(msFromJulday(jdD));
  say(`- Design moment (Sun 88 degrees earlier): ${dd.getUTCFullYear()}-${two(dd.getUTCMonth() + 1)}-${two(dd.getUTCDate())} ${two(dd.getUTCHours())}:${two(dd.getUTCMinutes())} UT`);
  say("- Activations, gate.line, Personality (conscious, black) | Design (unconscious, red):");
  for (const b of HD_BODIES) say(`  - ${b}: ${pers[b][0]}.${pers[b][1]} | ${des[b][0]}.${des[b][1]}`);
  say("");

  const gl = (t) => `${t[0]}.${t[1]}`;
  say("## Gene Keys (same gates as Human Design, read as keys; key.line)");
  say(`- Activation Sequence: Life's Work ${gl(pers["Sun"])}, Evolution ${gl(pers["Earth"])}, ` +
    `Radiance ${gl(des["Sun"])}, Purpose ${gl(des["Earth"])}`);
  say(`- Venus Sequence: Attraction ${gl(des["Moon"])}, IQ ${gl(pers["Venus"])}, EQ ${gl(pers["Mars"])}, ` +
    `SQ ${gl(des["Venus"])}, Core ${gl(des["Mars"])}`);
  say(`- Pearl Sequence: Vocation ${gl(des["Mars"])}, Culture ${gl(des["Jupiter"])}, ` +
    `Brand ${gl(pers["Sun"])}, Pearl ${gl(pers["Jupiter"])}`);
  say("");

  return {
    text: P.join("\n"),
    summary: {
      rising: SIGNS[ascSign], sun: SIGNS[signIdx(pos["Sun"])], moon: SIGNS[signIdx(pos["Moon"])],
      type: hd.type, profile: hd.profile, authority: hd.authority, lifesWork: gl(pers["Sun"]),
      warning: !!(shift && shift[0] <= 5),
    },
  };
}
