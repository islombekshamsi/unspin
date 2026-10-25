import styles from "./landing.module.css";

/**
 * Class names for the landing stylesheet.
 * This repo's Turbopack CSS rule emits `*.module.css` without hashing, so the
 * literal name has to be present. If hashing starts working, the hashed export
 * is included as well.
 */
export function lc(...names: string[]): string {
  const map = styles as Record<string, string>;
  return names
    .flatMap((name) => {
      const hashed = map[name];
      return hashed && hashed !== name ? [name, hashed] : [name];
    })
    .join(" ");
}
