/**
 * Registered unit conversions (client-safe, no Node APIs).
 *
 * Only conversions whose factor is an exact power of ten or an exact integer are registered, so the
 * result is exact in decimal arithmetic. Affine conversions (temperature), currency conversions (need
 * dated exchange rates), and non-terminating divisions (seconds -> minutes) are deliberately absent.
 */
export interface UnitConversion {
  id: string;
  label: string;
  /** Column unit required before conversion (exact match). */
  from: string;
  to: string;
  quantity: "mass" | "length" | "time";
  /** Exact multiplier as a decimal string. */
  factor: string;
}

export const UNIT_CONVERSIONS: readonly UnitConversion[] = [
  { id: "mass_mg_to_g", label: "mg → g", from: "mg", to: "g", quantity: "mass", factor: "0.001" },
  { id: "mass_g_to_mg", label: "g → mg", from: "g", to: "mg", quantity: "mass", factor: "1000" },
  { id: "mass_g_to_kg", label: "g → kg", from: "g", to: "kg", quantity: "mass", factor: "0.001" },
  { id: "mass_kg_to_g", label: "kg → g", from: "kg", to: "g", quantity: "mass", factor: "1000" },
  { id: "length_mm_to_m", label: "mm → m", from: "mm", to: "m", quantity: "length", factor: "0.001" },
  { id: "length_cm_to_m", label: "cm → m", from: "cm", to: "m", quantity: "length", factor: "0.01" },
  { id: "length_m_to_cm", label: "m → cm", from: "m", to: "cm", quantity: "length", factor: "100" },
  { id: "length_m_to_mm", label: "m → mm", from: "m", to: "mm", quantity: "length", factor: "1000" },
  { id: "length_m_to_km", label: "m → km", from: "m", to: "km", quantity: "length", factor: "0.001" },
  { id: "length_km_to_m", label: "km → m", from: "km", to: "m", quantity: "length", factor: "1000" },
  { id: "time_ms_to_s", label: "ms → s", from: "ms", to: "s", quantity: "time", factor: "0.001" },
  { id: "time_s_to_ms", label: "s → ms", from: "s", to: "ms", quantity: "time", factor: "1000" },
  { id: "time_min_to_s", label: "min → s", from: "min", to: "s", quantity: "time", factor: "60" },
  { id: "time_h_to_min", label: "h → min", from: "h", to: "min", quantity: "time", factor: "60" },
  { id: "time_h_to_s", label: "h → s", from: "h", to: "s", quantity: "time", factor: "3600" },
];

export function findConversion(id: string): UnitConversion | null {
  return UNIT_CONVERSIONS.find((c) => c.id === id) ?? null;
}

export function conversionsFrom(unit: string | null): UnitConversion[] {
  return unit === null ? [] : UNIT_CONVERSIONS.filter((c) => c.from === unit);
}
