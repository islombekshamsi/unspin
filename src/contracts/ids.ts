export type IdPrefix =
  | "src"
  | "sel"
  | "ds"
  | "ver"
  | "col"
  | "row"
  | "cell"
  | "prov"
  | "op"
  | "job"
  | "fnd"
  | "exp"
  | "shr"
  | "chart"
  | "req"
  | "view"
  | "fact"
  | "anl"
  | "cns";

/** Opaque, unguessable identifier. Works in Node and browsers (Web Crypto). */
export function newId(prefix: IdPrefix): string {
  return `${prefix}_${globalThis.crypto.randomUUID().replace(/-/g, "")}`;
}
