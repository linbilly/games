const GARAGE_KEY = "mathRacerGarage_v2";

export const CARS = [
  { id: "starter", name: "Starter Kart", req: { correctTotal: 0 }, dashTint: 0x101320 },
  { id: "neon",    name: "Neon Comet", req: { correctTotal: 80 }, dashTint: 0x14203a },
  { id: "forest",  name: "Forest Sprinter", req: { correctTotal: 180 }, dashTint: 0x143d2f },
  { id: "gold",    name: "Gold Runner", req: { correctTotal: 320 }, dashTint: 0x2a1a55 },
  { id: "crimson", name: "Crimson Blaze", req: { correctTotal: 520 }, dashTint: 0x451020 },
];

export function loadGarage() {
  try {
    const raw = localStorage.getItem(GARAGE_KEY);
    if (!raw) return { selected: "starter" };
    const g = JSON.parse(raw);
    return { selected: g.selected ?? "starter" };
  } catch {
    return { selected: "starter" };
  }
}

export function saveGarage(g) {
  localStorage.setItem(GARAGE_KEY, JSON.stringify(g));
}

export function isUnlocked(car, statsTotalCorrect) {
  return (statsTotalCorrect >= (car.req?.correctTotal ?? 0));
}

export function carById(id) {
  return CARS.find(c => c.id === id) ?? CARS[0];
}
