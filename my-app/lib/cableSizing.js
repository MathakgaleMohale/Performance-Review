// Cable sizing engine — ported 1:1 from "Electrical.xlsx"
// (sheets: "Cables Sizes", "DC Cable Sizes", "SANS Data", "Cable Data").
// VERIFY all reference values against your official SANS 10142-1 / IEC 60364-5-52 /
// SANS 10142-1-2 / IEC 62548 / EN 50618 copies and manufacturer data.

// ───────────────────────── AC reference data ─────────────────────────
export const AC_PROTECTION = ['Armoured', 'Unarmoured']
export const AC_INSULATION = ['PVC', 'XLPE', 'Rubber']
export const AC_CONDUCTOR = ['Copper', 'Aluminium']
export const AC_FACTORS = {
  xlpe: 1.28,      // XLPE CCC factor (x PVC 70°C)
  al: 0.78,        // Aluminium CCC factor (x Cu)
  alMv: 1.64,      // Aluminium mV/A/m factor (x Cu)
  derate: 1,       // Default other derating Ca (ambient/soil/other circuits)
  vdLimit: 0.03,   // Voltage drop limit (3%)
  maxRuns: 6,      // Max cables in parallel (≤ 6 = IEC grouping table limit)
  maxSize: 630,    // Max cable size per run (mm²)
  brkSF: 1.25,     // Breaker safety factor: In and Ir ≥ Ib × SF
}
export const AC_SIZES = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400, 500, 630]
// key = ref method | loaded conductors (F = single-core in air / on surface)
export const AC_CCC_KEYS = ["B|2", "B|3", "C|2", "C|3", "E|2", "E|3", "D|2", "D|3", "F|2", "F|3"]
// It (A): PVC 70°C copper – multicore per SANS 10142-1 / IEC 60364-5-52, single-core (F) per B.52.10 ("Cable Data" B:K). XLPE / Al via factors.
export const AC_CCC_PVC = [
  [16.5, 15, 19.5, 17.5, 22, 18.5, 22, 18, null, null],
  [23, 20, 27, 24, 30, 25, 29, 24, null, null],
  [30, 27, 36, 32, 40, 34, 38, 31, null, null],
  [38, 34, 46, 41, 51, 43, 47, 39, null, null],
  [52, 46, 63, 57, 70, 60, 63, 52, null, null],
  [69, 62, 85, 76, 94, 80, 81, 67, null, null],
  [90, 80, 112, 96, 119, 101, 104, 86, 131, 110],
  [111, 99, 138, 119, 148, 126, 125, 103, 162, 137],
  [133, 118, 168, 144, 180, 153, 148, 122, 196, 167],
  [168, 149, 213, 184, 232, 196, 183, 151, 251, 216],
  [201, 179, 258, 223, 282, 238, 216, 179, 304, 264],
  [232, 206, 299, 259, 328, 276, 246, 203, 352, 308],
  [266, 236, 344, 299, 379, 319, 278, 230, 406, 356],
  [303, 268, 392, 341, 434, 364, 312, 258, 463, 409],
  [356, 315, 461, 403, 514, 430, 361, 297, 546, 485],
  [409, 361, 530, 464, 593, 497, 408, 336, 629, 561],
  [null, null, null, null, null, null, null, null, 754, 656],
  [null, null, null, null, null, null, null, null, 868, 749],
  [null, null, null, null, null, null, null, null, 1005, 855],
]
// It (A): Rubber 60°C H07RN-F copper (EN 50525-2-21 manufacturer data, "Cable Data" L:U). F|3 = F|2 × 0.85 trefoil factor (derived – verify).
export const AC_CCC_RUBBER = [
  [null, null, 16, 16, 16, 16, null, null, null, null],
  [null, null, 25, 20, 25, 20, null, null, null, null],
  [null, null, 30, 26, 30, 26, null, null, null, null],
  [null, null, 39, 34, 39, 34, null, null, null, null],
  [null, null, 51, 47, 51, 47, null, null, null, null],
  [null, null, 73, 63, 73, 63, null, null, null, null],
  [null, null, 97, 83, 97, 83, null, null, null, null],
  [null, null, null, 102, null, 102, null, null, 140, 119],
  [null, null, null, 124, null, 124, null, null, 175, 149],
  [null, null, null, 158, null, 158, null, null, 216, 184],
  [null, null, null, 192, null, 192, null, null, 258, 219],
  [null, null, null, 222, null, 222, null, null, 302, 257],
  [null, null, null, 255, null, 255, null, null, 347, 295],
  [null, null, null, 291, null, 291, null, null, 394, 335],
  [null, null, null, 343, null, 343, null, null, 471, 400],
  [null, null, null, 394, null, 394, null, null, 541, 460],
  [null, null, null, null, null, null, null, null, 644, 547],
  [null, null, null, null, null, null, null, null, 738, 627],
  [null, null, null, null, null, null, null, null, 861, 732],
]
// mV/A/m ("Cable Data" W:AD) – columns:
// 0 PVC/XLPE multi 1ph, 1 multi 3ph, 2 1-core 1ph, 3 1-core 3ph, 4 Rubber multi 1ph, 5 multi 3ph, 6 1-core 1ph, 7 1-core 3ph
export const AC_MV = [
  [29, 25.11473670974872, null, null, 32, 27, null, null],
  [18, 15.588457268119894, null, null, 19, 16, null, null],
  [11, 9.526279441628825, null, null, 12, 10, null, null],
  [7.3, 6.3219854476264015, null, null, 7.8, 6.7, null, null],
  [4.4, 3.81051177665153, null, null, 4.6, 4, null, null],
  [2.8, 2.424871130596428, null, null, 2.9, 2.5, null, null],
  [1.75, 1.5155444566227676, 1.8, 1.5, 1.85, 1.55, null, null],
  [1.25, 1.0825317547305482, 1.3, 1.1, null, 1.15, 1.32, 1.143153532995459],
  [0.94, 0.8140638795573722, 0.95, 0.8, null, 0.84, 0.93, 0.8054036255195279],
  [0.63, 0.5455960043841963, 0.65, 0.55, null, 0.58, 0.67, 0.5802370205355739],
  [0.47, 0.4070319397786861, 0.49, 0.41, null, 0.44, 0.53, 0.45899346400575247],
  [0.38, 0.32908965343808666, 0.39, 0.33, null, 0.36, 0.43, 0.3723909236273086],
  [0.3, 0.25980762113533157, 0.33, 0.29, null, 0.3, 0.36, 0.31176914536239786],
  [0.25, 0.21650635094610965, 0.28, 0.25, null, 0.26, 0.32, 0.27712812921102037],
  [0.195, 0.16887495373796554, 0.24, 0.21, null, 0.21, 0.27, 0.23382685902179845],
  [0.16, 0.13856406460551018, 0.21, 0.185, null, 0.185, 0.24, 0.20784609690826525],
  [null, null, 0.195, 0.17, null, null, 0.21, 0.1818653347947321],
  [null, null, 0.18, 0.155, null, null, 0.2, 0.17320508075688773],
  [null, null, 0.17, 0.145, null, null, 0.185, 0.16021469970012114],
]
// [rating A, device type] – IEC 60898-1 (MCB) / IEC 60947-2 (MCCB, ACB)
export const AC_BREAKERS = [[6, "MCB"], [10, "MCB"], [16, "MCB"], [20, "MCB"], [25, "MCB"], [32, "MCB"], [40, "MCB"], [50, "MCB"], [63, "MCB"], [80, "MCCB"], [100, "MCCB"], [125, "MCCB"], [160, "MCCB"], [200, "MCCB"], [250, "MCCB"], [315, "MCCB"], [400, "MCCB"], [500, "MCCB"], [630, "MCCB"], [800, "MCCB"], [1000, "MCCB"], [1250, "MCCB"], [1600, "ACB"], [2000, "ACB"], [2500, "ACB"], [3200, "ACB"], [4000, "ACB"], [5000, "ACB"], [6300, "ACB"]]
// method: [ref method, grouping scheme]
export const AC_INSTALL_METHODS = {"Free Air": ["E", "AIR-LADDER"], "On Tray/Ladder": ["E", "AIR-TRAY"], "Clipped Direct": ["C", "AIR-WALL"], "Surface": ["C", "AIR-WALL"], "In Conduit": ["B", "AIR-BUNCH"], "In Trunking": ["B", "AIR-BUNCH"], "Buried": ["D", "GND-DIRECT"], "In Ground Duct": ["D", "GND-DUCT"]}
// cores: [loaded conductors, single-core 1/0]
export const AC_CORES = {"Two": [2, 0], "Three": [3, 0], "Four": [3, 0], "Single-core (1ph)": [2, 1], "Single-core (3ph trefoil)": [3, 1]}
export const AC_SPACING = ["Touching", "1 cable dia", "2 cable dia", "0.125 m", "0.25 m", "0.5 m", "1.0 m"]
// Grouping factor Cg for 1..6 parallel runs – IEC 60364-5-52 Tables B.52.17 (air), B.52.18 (direct in ground), B.52.19 (ducts)
export const AC_GROUPING = {
  "AIR-BUNCH|Touching": [1, 0.8, 0.7, 0.65, 0.6, 0.57],
  "AIR-WALL|Touching": [1, 0.85, 0.79, 0.75, 0.73, 0.72],
  "AIR-WALL|2 cable dia": [1, 1, 1, 1, 1, 1],
  "AIR-TRAY|Touching": [1, 0.88, 0.82, 0.77, 0.75, 0.73],
  "AIR-TRAY|2 cable dia": [1, 1, 1, 1, 1, 1],
  "AIR-LADDER|Touching": [1, 0.87, 0.82, 0.8, 0.8, 0.79],
  "AIR-LADDER|2 cable dia": [1, 1, 1, 1, 1, 1],
  "GND-DIRECT|Touching": [1, 0.75, 0.65, 0.6, 0.55, 0.5],
  "GND-DIRECT|1 cable dia": [1, 0.8, 0.7, 0.6, 0.55, 0.55],
  "GND-DIRECT|0.125 m": [1, 0.85, 0.75, 0.7, 0.65, 0.6],
  "GND-DIRECT|0.25 m": [1, 0.9, 0.8, 0.75, 0.7, 0.7],
  "GND-DIRECT|0.5 m": [1, 0.9, 0.85, 0.8, 0.8, 0.8],
  "GND-DUCT|Touching": [1, 0.85, 0.75, 0.7, 0.65, 0.6],
  "GND-DUCT|0.25 m": [1, 0.9, 0.85, 0.8, 0.8, 0.8],
  "GND-DUCT|0.5 m": [1, 0.95, 0.9, 0.85, 0.85, 0.8],
  "GND-DUCT|1.0 m": [1, 0.95, 0.95, 0.9, 0.9, 0.9],
}
// Short-circuit k factor (A·√s/mm²) – IEC 60364-4-43 Table 43A
export const AC_SC_K = {"Copper|PVC": 115, "Copper|XLPE": 143, "Copper|Rubber": 141, "Aluminium|PVC": 76, "Aluminium|XLPE": 94, "Aluminium|Rubber": 93}
// Default fault clearing time t (s) by device (when circuit value blank)
export const AC_DEVICE_T = {"MCB": 0.1, "MCCB": 0.1, "ACB": 0.4}
// Trip-unit setting range by device: [Ir min × In, Ir step × In]
export const AC_IR = {"MCB": [1, 1], "MCCB": [0.7, 0.05], "ACB": [0.4, 0.01]}

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
const isBlank = v => v === '' || v === null || v === undefined
// Excel CEILING(x, step) on a value pre-rounded to 6 dp, without float drift
const ceilStep = (x, step) => Math.round(Math.ceil(+(Math.round(x * 1e6) / 1e6 / step).toFixed(9)) * step * 1e9) / 1e9

// ───────────────────────── AC calculation ─────────────────────────
const brkType = In => (AC_BREAKERS.find(b => b[0] === In) || [])[1]

// Trip setting Ir = smallest setting ≥ Ib × SF within the device range (MCB fixed Ir = In)
function tripSetting(Ib, In) {
  const r = AC_IR[brkType(In)]
  if (!r) return In
  return Math.round(Math.min(1, Math.max(r[0], ceilStep(Ib * AC_FACTORS.brkSF / In, r[1]))) * In * 1e9) / 1e9
}

function acInputIssue(input) {
  const ref = (AC_INSTALL_METHODS[input.method] || [])[0]
  const single = (AC_CORES[input.cores] || [])[1] === 1
  const bd = ref === 'B' || ref === 'D'
  if (input.insulation === 'Rubber' && input.conductor === 'Aluminium') return 'H07RN-F is copper only'
  if (input.insulation === 'Rubber' && bd) return 'rubber flex not rated in conduit/buried'
  if (single && bd) return 'single-core: air/surface/tray only – use multicore'
  return 'check inputs (spacing valid for install?)'
}

// input: { ib, method, distance, voltage, protection, insulation, conductor, cores, derating, spacing, faultKA, faultT }
export function calcAC(input) {
  if (isBlank(input.ib)) return { empty: true }
  const F = AC_FACTORS
  const Ib = num(input.ib), L = num(input.distance), V = num(input.voltage)
  const Ca = isBlank(input.derating) ? null : num(input.derating)
  const Ik = isBlank(input.faultKA) ? null : num(input.faultKA)
  const tIn = isBlank(input.faultT) ? null : num(input.faultT)
  const spacing = isBlank(input.spacing) ? 'Touching' : input.spacing
  const inst = AC_INSTALL_METHODS[input.method]
  const coreDef = AC_CORES[input.cores]
  const single = !!coreDef && coreDef[1] === 1
  const grpKey = inst ? `${inst[1]}|${spacing}` : null
  const ccc = input.insulation === 'Rubber' ? AC_CCC_RUBBER : AC_CCC_PVC
  const cccKey = inst && coreDef ? `${single ? 'F' : inst[0]}|${coreDef[0]}` : null
  const col = cccKey ? AC_CCC_KEYS.indexOf(cccKey) : -1

  const valid = isNum(Ib) && Ib > 0 && isNum(L) && L > 0 && isNum(V) && V > 0
    && !!inst && !!coreDef
    && AC_INSULATION.includes(input.insulation) && AC_CONDUCTOR.includes(input.conductor)
    && (Ca === null || (isNum(Ca) && Ca > 0 && Ca <= 1.5))
    && grpKey in AC_GROUPING
    && (Ik === null || (isNum(Ik) && Ik > 0))
    && (tIn === null || (isNum(tIn) && tIn > 0 && tIn <= 5))
    && col >= 0 && ccc.some(r => isNum(r[col]))
    && !(input.insulation === 'Rubber' && input.conductor === 'Aluminium')
    && !((input.insulation === 'Rubber' || single) && (inst[0] === 'B' || inst[0] === 'D'))
  if (!valid) return { valid: false, size: null, status: `FAIL – ${acInputIssue(input)}` }

  const ref = single ? 'F' : inst[0]
  const loaded = coreDef[0]
  const insulFac = input.insulation === 'XLPE' ? F.xlpe : 1
  const alFac = input.conductor === 'Aluminium' ? F.al : 1
  const derate = Ca === null ? F.derate : Ca
  const breaker = minOr0(AC_BREAKERS.map(b => b[0]).filter(b => b >= Ib * F.brkSF))
  const reqBase = breaker === 0 ? 0 : tripSetting(Ib, breaker) / (derate * insulFac * alFac)
  const mvCol = (input.insulation === 'Rubber' ? 4 : 0) + (single ? 2 : 0) + (loaded === 2 ? 0 : 1)
  const alMv = input.conductor === 'Aluminium' ? F.alMv : 1
  const maxBaseMv = F.vdLimit * V * 1000 / (Ib * L * alMv)
  const idxOk = AC_SIZES.map((s, i) => i).filter(i => AC_SIZES[i] <= F.maxSize)
  const cccAt = i => ccc[i][col]
  const mvAt = i => AC_MV[i][mvCol]

  // parallel runs: grouping-derated capacity must cover the requirement, and volt drop must be met
  const cg = AC_GROUPING[grpKey]
  const maxCCC = maxOr0(idxOk.map(cccAt).filter(isNum))
  const needEff = reqBase / maxCCC
  const runsCCC = minOr0([1, 2, 3, 4, 5, 6].filter(n => n <= F.maxRuns && n * cg[n - 1] >= needEff))
  const minMv = minOr0(idxOk.map(mvAt).filter(isNum))
  const runsVD = Math.max(1, Math.ceil(minMv / maxBaseMv))
  const runs = runsCCC === 0 ? 0 : Math.max(runsCCC, runsVD)
  const Cg = runs === 0 || runs > F.maxRuns ? null : cg[runs - 1]

  const k = AC_SC_K[`${input.conductor}|${input.insulation}`]
  const tUsed = tIn === null ? (AC_DEVICE_T[brkType(breaker)] ?? 0.4) : tIn
  const minS = Ik === null ? null : Ik * 1000 * Math.sqrt(tUsed) / k
  let sizeSC = 0
  if (Ik !== null) {
    sizeSC = minOr0(idxOk.filter(i => AC_SIZES[i] >= minS && isNum(cccAt(i)) && cccAt(i) > 0).map(i => AC_SIZES[i]))
    if (sizeSC === 0) sizeSC = NaN
  }
  const sizeCCC = Cg === null ? 0 : minOr0(idxOk.filter(i => isNum(cccAt(i)) && cccAt(i) >= reqBase / (runs * Cg)).map(i => AC_SIZES[i]))
  const sizeVD = Cg === null ? 0 : minOr0(idxOk.filter(i => isNum(mvAt(i)) && mvAt(i) <= maxBaseMv * runs).map(i => AC_SIZES[i]))

  const base = {
    valid: true, refMethod: ref, loaded, single, derate,
    breaker: breaker || null, breakerType: breaker ? brkType(breaker) : null, ir: breaker ? tripSetting(Ib, breaker) : null,
    k, tUsed,
  }
  if (breaker === 0 || runs === 0 || runs > F.maxRuns || sizeCCC === 0 || sizeVD === 0 || Number.isNaN(sizeSC)) {
    return { ...base, size: null, runs: null, sizeLabel: 'Single-core / busbar', status: 'FAIL – exceeds range' }
  }
  const size = Math.max(sizeCCC, sizeVD, sizeSC)
  const si = AC_SIZES.indexOf(size)
  const cccTotal = cccAt(si) * insulFac * alFac * derate * Cg * runs
  const vdPct = (mvAt(si) || 0) * alMv * (Ib / runs) * L / 1000 / V
  const vdV = vdPct * V
  const earth = size <= 16 ? size : size <= 35 ? 16 : minOr0(AC_SIZES.filter(s => s >= size / 2))
  const scWithstand = Ik === null ? null : k * size / Math.sqrt(tUsed) / 1000
  const prot = base.ir ?? breaker

  let status = 'OK'
  if (vdPct > F.vdLimit) status = 'FAIL – volt drop'
  else if (prot < Ib * F.brkSF) status = 'FAIL – breaker < Ib × SF'
  else if (cccTotal < prot) status = 'FAIL – CCC < Ir setting'
  else if (scWithstand !== null && Ik > scWithstand) status = 'FAIL – short circuit'
  else if (loaded === 2 && V > 250) status = 'CHECK – 1ph: use 230 V'
  else if (loaded === 3 && V < 300) status = 'CHECK – 3ph: use 400 V'

  return { ...base, runs, Cg, size, sizeCCC, sizeVD, sizeSC, cccTotal, vdV, vdPct, earth, scWithstand, scChecked: Ik !== null, status }
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
  "Ratings: PVC multicore ≤ 300 mm² per SANS 10142-1 / IEC 60364-5-52 (XLPE and Al via factors); single-core in air (F) per B.52.10; Rubber = H07RN-F (EN 50525-2-21) manufacturer data, 60°C, 1.5–630 mm². VERIFY all values.",
  "Protection per IEC 60364-4-43 cl. 433.1 / SANS 10142-1: Ib × SF ≤ Ir ≤ In and Ir ≤ Iz. Safety factor SF = 1.25. Frame In = smallest standard rating ≥ Ib × SF (6–6300 A). Trip setting Ir = smallest setting ≥ Ib × SF (MCB fixed; MCCB 0.7–1.0 In; ACB 0.4–1.0 In); cable sized to Ir.",
  "Phase from cores: 2-core / single-core 1ph = single-phase (use 230 V); 3/4-core / trefoil = three-phase (use 400 V). Status shows CHECK if the voltage doesn't suit the cores.",
  "Derating: Iz = It × Ca × Cg. Cg for parallel runs is applied automatically (IEC 60364-5-52 B.52.17–B.52.19) from installation method + spacing. 'Other derating Ca' = other factors only (ambient/soil temperature, grouping with OTHER circuits).",
  "Parallel runs (IEC 60364-5-52 cl. 523.7): same conductor, size, length and route. Max 6 runs, max 630 mm² per run. Size, earth and SC withstand are per run; CCC is the total for the set.",
  "Earth conductor per IEC 60364-5-54 Table 54.2 (same material): S ≤ 16 → S; 16–35 → 16; > 35 → S/2. Per run. Armour may serve as earth if verified by adiabatic check.",
  "Status: FAIL = invalid inputs, out of range, volt drop over 3%, breaker < Ib × SF, CCC < Ir setting, or cable SC withstand < fault level.",
  "Short circuit (IEC 60364-4-43 cl. 434.5.2): S ≥ Ik·√t / k, full prospective Ik on each run (conservative). k from Table 43A. Default t: MCB/MCCB 0.1 s, ACB 0.4 s. For current-limiting devices the I²t let-through gives a smaller, more accurate result.",
  "Large currents (up to ~2500 A design, 3200 A breaker): select 'Single-core (3ph trefoil)' in free air, on tray/ladder, clipped or surface – PVC/XLPE or H07RN-F, up to 630 mm², max 6 per phase. Single-core is not offered in conduit or buried (use multicore or busbar trunking). H07RN-F 3ph ratings derived (× 0.85) – verify.",
  "Spacing options: in air – Touching or 2 cable dia (Cg = 1); buried direct – Touching / 1 cable dia / 0.125 / 0.25 / 0.5 m; in ducts – Touching / 0.25 / 0.5 / 1.0 m.",
  "Rubber flex (H07RN-F) is copper only and not rated in conduit or buried – Status shows the reason.",
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
