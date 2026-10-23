// Cable sizing engine — ported 1:1 from "Electrical.xlsx"
// (sheets: "Cables Sizes", "DC Cable Sizes", "SANS Data").
// VERIFY all reference values against your official SANS 10142-1 / IEC 60364-5-52 /
// SANS 10142-1-2 / IEC 62548 / EN 50618 copies and manufacturer data.

// ───────────────────────── AC reference data ─────────────────────────
export const AC_FACTORS = {
  xlpe: 1.28,        // XLPE CCC factor (x PVC 70°C)
  al: 0.78,          // Aluminium CCC factor (x Cu)
  alMv: 1.64,        // Aluminium mV/A/m factor (x Cu)
  derate: 1,         // Default derating Ca x Cg
  vdLimit: 0.03,     // Voltage drop limit (3%)
  maxRuns: 4,        // Max cables in parallel
  maxSize: 300,      // Max cable size per run (mm²)
  rubber: 0.87,      // Rubber 60°C CCC factor (x PVC 70°C)
}

export const AC_SIZES = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300]
export const AC_CCC_KEYS = ['B|2', 'B|3', 'C|2', 'C|3', 'E|2', 'E|3', 'D|2', 'D|3']
// PVC insulated, copper, multicore (A) — columns follow AC_CCC_KEYS
export const AC_CCC_PVC = [
  [16.5, 15, 19.5, 17.5, 22, 18.5, 22, 18],
  [23, 20, 27, 24, 30, 25, 29, 24],
  [30, 27, 36, 32, 40, 34, 38, 31],
  [38, 34, 46, 41, 51, 43, 47, 39],
  [52, 46, 63, 57, 70, 60, 63, 52],
  [69, 62, 85, 76, 94, 80, 81, 67],
  [90, 80, 112, 96, 119, 101, 104, 86],
  [111, 99, 138, 119, 148, 126, 125, 103],
  [133, 118, 168, 144, 180, 153, 148, 122],
  [168, 149, 213, 184, 232, 196, 183, 151],
  [201, 179, 258, 223, 282, 238, 216, 179],
  [232, 206, 299, 259, 328, 276, 246, 203],
  [266, 236, 344, 299, 379, 319, 278, 230],
  [303, 268, 392, 341, 434, 364, 312, 258],
  [356, 315, 461, 403, 514, 430, 361, 297],
  [409, 361, 530, 464, 593, 497, 408, 336],
]
// Rubber 60°C table = PVC x rubber factor, rounded to 1 decimal (as in the spreadsheet)
export const AC_CCC_RUBBER = AC_CCC_PVC.map(r => r.map(v => Math.round(v * AC_FACTORS.rubber * 10) / 10))
// 1ph mV/A/m; 3ph = 1ph x √3/2
export const AC_MV_1PH = [29, 18, 11, 7.3, 4.4, 2.8, 1.75, 1.25, 0.94, 0.63, 0.47, 0.38, 0.3, 0.25, 0.195, 0.16]
export const AC_MV_3PH = AC_MV_1PH.map(v => v * Math.sqrt(3) / 2)
export const AC_BREAKERS = [6, 10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600]

export const AC_INSTALL_METHODS = {
  'Free Air': 'E', 'On Tray/Ladder': 'E', 'Clipped Direct': 'C', 'Surface': 'C',
  'In Conduit': 'B', 'In Trunking': 'B', 'Buried': 'D', 'In Ground Duct': 'D',
}
export const AC_CORES = { Two: 2, Three: 3, Four: 3 }
export const AC_PROTECTION = ['Armoured', 'Unarmoured']
export const AC_INSULATION = ['PVC', 'XLPE', 'Rubber']
export const AC_CONDUCTOR = ['Copper', 'Aluminium']

// ───────────────────────── DC reference data ─────────────────────────
export const DC_FACTORS = {
  derate: 1,          // Default DC derating
  condTemp: 90,       // Conductor temp for VD resistance (°C)
  cuAlpha: 0.00393,   // Copper resistance temp coefficient (/°C)
  maxRuns: 4,         // Max DC cables in parallel
  maxV: 1500,         // Max DC system voltage (V)
}
export const DC_TYPES = {
  'PV String':  { ibMult: 1.25, minProt: 1.5,  vdLimit: 0.01, maxSize: 10,  maxRuns: 1, basis: 'Input = string Isc(STC). IEC 62548: Iz ≥ 1.25 Isc; string fuse ≥ 1.5 Isc' },
  'PV Array':   { ibMult: 1.25, minProt: 1.25, vdLimit: 0.01, maxSize: 10,  maxRuns: 1, basis: 'Input = string Isc x strings. Iz ≥ 1.25 Isc array' },
  'Battery':    { ibMult: 1,    minProt: 1,    vdLimit: 0.01, maxSize: 240, maxRuns: DC_FACTORS.maxRuns, basis: 'Input = max battery charge/discharge current' },
  'General DC': { ibMult: 1,    minProt: 1,    vdLimit: 0.03, maxSize: 240, maxRuns: DC_FACTORS.maxRuns, basis: 'Input = design current Ib' },
}
export const DC_METHODS = ['Free Air (single)', 'On Surface (single)', 'On Surface (2 adjacent)']
export const DC_SIZES = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240]
// Solar PV cable CCC (A) — single-core tinned Cu, 120°C conductor, 60°C ambient (EN 50618 Table A.3)
export const DC_CCC = [
  [30, 29, 24], [41, 39, 33], [55, 52, 44], [70, 67, 57], [98, 93, 79],
  [132, 125, 107], [176, 167, 142], [218, 207, 176], [276, 262, 221], [347, 330, 278],
  [416, 395, 333], [488, 464, 390], [566, 538, 453], [644, 612, 515], [775, 736, 620],
]
// DC resistance at 20°C (ohm/km), IEC 60228 class 5
export const DC_R20 = [13.7, 8.21, 5.09, 3.39, 1.95, 1.24, 0.795, 0.565, 0.393, 0.277, 0.21, 0.164, 0.132, 0.108, 0.0817]
export const DC_PROT = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 16, 20, 25, 30, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600]

// ───────────────────────── helpers ─────────────────────────
const num = v => (v === '' || v === null || v === undefined ? NaN : Number(v))
const isNum = v => typeof v === 'number' && Number.isFinite(v)
// Excel MINIFS/MAXIFS return 0 when nothing matches
const minOr0 = arr => (arr.length ? Math.min(...arr) : 0)
const maxOr0 = arr => (arr.length ? Math.max(...arr) : 0)

// ───────────────────────── AC calculation ─────────────────────────
// input: { ib, method, distance, voltage, protection, insulation, conductor, cores, derating }
export function calcAC(input) {
  const Ib = num(input.ib), L = num(input.distance), V = num(input.voltage)
  const derIn = input.derating === '' || input.derating == null ? null : num(input.derating)
  if (input.ib === '' || input.ib == null) return { empty: true }

  const valid = isNum(Ib) && Ib > 0 && isNum(L) && L > 0 && isNum(V) && V > 0
    && input.method in AC_INSTALL_METHODS && input.cores in AC_CORES
    && AC_INSULATION.includes(input.insulation) && AC_CONDUCTOR.includes(input.conductor)
    && (derIn === null || (isNum(derIn) && derIn > 0 && derIn <= 1.5))
  if (!valid) return { valid: false, status: 'FAIL – check inputs', size: null }

  const F = AC_FACTORS
  const ref = AC_INSTALL_METHODS[input.method]
  const loaded = AC_CORES[input.cores]
  const col = AC_CCC_KEYS.indexOf(`${ref}|${loaded}`)
  const insulFac = input.insulation === 'XLPE' ? F.xlpe : 1
  const alFac = input.conductor === 'Aluminium' ? F.al : 1
  const derate = derIn === null ? F.derate : derIn
  const breaker = minOr0(AC_BREAKERS.filter(b => b > Ib))
  const reqBase = breaker / (derate * insulFac * alFac)
  const mvTable = loaded === 2 ? AC_MV_1PH : AC_MV_3PH
  const alMv = input.conductor === 'Aluminium' ? F.alMv : 1
  const maxBaseMv = F.vdLimit * V * 1000 / (Ib * L * alMv)
  const ccc = input.insulation === 'Rubber' ? AC_CCC_RUBBER : AC_CCC_PVC
  const idxOk = AC_SIZES.map((s, i) => i).filter(i => AC_SIZES[i] <= F.maxSize)

  const maxCCC = maxOr0(idxOk.map(i => ccc[i][col]))
  const minMv = minOr0(idxOk.map(i => mvTable[i]))
  const runs = Math.max(1, Math.floor(reqBase / maxCCC) + 1, Math.ceil(minMv / maxBaseMv))
  const sizeCCC = minOr0(idxOk.filter(i => ccc[i][col] > reqBase / runs).map(i => AC_SIZES[i]))
  const sizeVD = minOr0(idxOk.filter(i => mvTable[i] <= maxBaseMv * runs).map(i => AC_SIZES[i]))

  const base = { valid: true, refMethod: ref, loaded, breaker: breaker || null, derate, runs }
  if (breaker === 0 || runs > F.maxRuns || sizeCCC === 0 || sizeVD === 0) {
    return { ...base, size: null, runs: null, status: 'FAIL – exceeds range' }
  }
  const size = Math.max(sizeCCC, sizeVD)
  const si = AC_SIZES.indexOf(size)
  const cccTotal = ccc[si][col] * insulFac * alFac * derate * runs
  const vdPct = mvTable[si] * alMv * (Ib / runs) * L / 1000 / V
  const vdV = vdPct * V
  const earth = size <= 16 ? size : size <= 35 ? 16 : minOr0(AC_SIZES.filter(s => s >= size / 2))

  let status = 'OK'
  if (vdPct > F.vdLimit) status = 'FAIL – volt drop'
  else if (breaker <= Ib) status = 'FAIL – breaker not > Ib'
  else if (cccTotal <= breaker) status = 'FAIL – CCC not > breaker'
  else if (loaded === 2 && V > 250) status = 'CHECK – 1ph: use 230 V'
  else if (loaded === 3 && V < 300) status = 'CHECK – 3ph: use 400 V'

  return { ...base, size, sizeCCC, sizeVD, cccTotal, vdV, vdPct, earth, status }
}

// ───────────────────────── DC calculation ─────────────────────────
// input: { type, current, strings, method, distance, modules, vmp, systemV, derating }
export function dcSystemVoltage(input) {
  const G = num(input.modules), H = num(input.vmp)
  if (isNum(G) && isNum(H)) return G * H
  const I = num(input.systemV)
  return isNum(I) ? I : NaN
}

export function calcDC(input) {
  if (input.current === '' || input.current == null) return { empty: true }
  const C = num(input.current), F_ = num(input.distance)
  const D = input.strings === '' || input.strings == null ? null : num(input.strings)
  const G = input.modules === '' || input.modules == null ? null : num(input.modules)
  const H = input.vmp === '' || input.vmp == null ? null : num(input.vmp)
  const J = input.derating === '' || input.derating == null ? null : num(input.derating)
  const K = dcSystemVoltage(input)
  const t = DC_TYPES[input.type]

  const valid = !!t && isNum(C) && C > 0
    && (D === null || (isNum(D) && D >= 1 && Number.isInteger(D)))
    && DC_METHODS.includes(input.method) && isNum(F_) && F_ > 0
    && (G === null || (isNum(G) && G >= 1 && Number.isInteger(G)))
    && (H === null || (isNum(H) && H > 0))
    && isNum(K) && K > 0
    && (J === null || (isNum(J) && J > 0 && J <= 1.5))
  if (!valid) return { valid: false, systemV: isNum(K) ? K : null, status: 'FAIL – check inputs', size: null }

  const strings = D === null ? 1 : D
  const col = DC_METHODS.indexOf(input.method)
  const derate = J === null ? DC_FACTORS.derate : J
  const Ib = C * strings * t.ibMult
  const Ivd = C * strings
  const minIn = C * strings * t.minProt
  const prot = minOr0(DC_PROT.filter(p => p > Ib && p >= minIn))
  const reqCCC = prot / derate
  const rFac = 1 + DC_FACTORS.cuAlpha * (DC_FACTORS.condTemp - 20)
  const maxR = t.vdLimit * K * 1000 / (2 * F_ * Ivd * rFac)
  const idxOk = DC_SIZES.map((s, i) => i).filter(i => DC_SIZES[i] <= t.maxSize)
  const maxCCC = maxOr0(idxOk.map(i => DC_CCC[i][col]))
  const minR = minOr0(idxOk.map(i => DC_R20[i]))
  const runs = Math.min(t.maxRuns, Math.max(1, Math.floor(reqCCC / maxCCC) + 1, Math.ceil(minR / maxR)))
  const sizeCCC = minOr0(idxOk.filter(i => DC_CCC[i][col] > reqCCC / runs).map(i => DC_SIZES[i]))
  const sizeVD = minOr0(idxOk.filter(i => DC_R20[i] <= maxR * runs).map(i => DC_SIZES[i]))

  const base = { valid: true, systemV: K, ib: Ib, prot: prot || null, derate, vdLimit: t.vdLimit }
  if (prot === 0 || sizeCCC === 0) {
    return { ...base, size: null, runs: null, status: K > DC_FACTORS.maxV ? 'FAIL – voltage > max DC' : 'FAIL – exceeds range' }
  }
  const size = Math.max(sizeCCC, sizeVD === 0 ? t.maxSize : sizeVD)
  const si = DC_SIZES.indexOf(size)
  const cccTotal = DC_CCC[si][col] * derate * runs
  const vdV = 2 * F_ * (Ivd / runs) * DC_R20[si] * rFac / 1000
  const vdPct = vdV / K

  let status = 'OK'
  if (K > DC_FACTORS.maxV) status = 'FAIL – voltage > max DC'
  else if (vdPct > t.vdLimit) status = 'FAIL – volt drop'
  else if (prot <= Ib) status = 'FAIL – protection not > Ib'
  else if (cccTotal <= prot) status = 'FAIL – CCC not > protection'

  return { ...base, runs, size, sizeCCC, sizeVD, cccTotal, vdV, vdPct, status }
}

export const AC_NOTES = [
  "Ratings from SANS 10142-1 / IEC 60364-5-52 reference tables (multicore). Rubber (60°C) uses a table derived from PVC × 0.87 – replace with official values. VERIFY all values.",
  'Recommended size = smallest standard size whose derated CCC > breaker rating (In) AND that meets the voltage-drop limit (3%), so Ib < In < Iz (SANS 10142-1).',
  "Phase from cores: 2-core = single-phase (use 230 V); 3/4-core = three-phase (use 400 V). Status shows CHECK if the voltage doesn't suit the cores.",
  'Derating (Ca × Cg) can be set per circuit; blank uses the default (1.0). Include grouping derating for parallel runs.',
  'Parallel cables are used when no single cable up to 300 mm² meets CCC or volt drop (max 4 runs). Size and earth are per run; CCC is for the total set.',
  'Earth conductor per IEC 60364-5-54 Table 54.2 (same material): S ≤ 16 → S; 16–35 → 16; > 35 → S/2 rounded up. Armour may serve as earth if verified.',
  'Breaker = smallest standard rating > Ib. Status: FAIL = invalid inputs, out of range, volt drop over limit, breaker not > Ib, or CCC not > breaker.',
]

export const DC_NOTES = [
  'PV cable ratings: single-core tinned Cu, 120°C conductor at 60°C ambient (EN 50618 Table A.3). VERIFY against manufacturer data and SANS 10142-1-2 / IEC 62548.',
  'Ib = current input × strings × multiplier (PV: 1.25 × Isc; Battery/General: 1.0).',
  "Protection = smallest standard DC rating > Ib and ≥ minimum (PV string ≥ 1.5 × Isc). Check it does not exceed the module's max series fuse rating.",
  'Recommended size = smallest size whose derated CCC > protection rating AND meets the VD limit, so Ib < In < Iz.',
  'Volt drop = 2 × one-way length × current × R, with R corrected to 90°C. VD current = input × strings (no 1.25 factor). VD % uses Total System Voltage.',
  'Ratings are for one cable per circuit pole. Use the Derating column for conduit, grouping, buried runs or parallel cables.',
  'Battery / General DC: parallel cables are used automatically when no single size meets CCC or volt drop (max 4 runs).',
  'Total System Voltage = Modules per String × Module Vmp when both are entered; otherwise the manual System Voltage. FAIL if above 1500 V DC (check Voc at min. temperature separately).',
  "PV String / PV Array: single cable only, max 10 mm² (manufacturer limit). If 10 mm² can't meet the VD limit, Status shows FAIL – volt drop (shorten route or re-string).",
]
