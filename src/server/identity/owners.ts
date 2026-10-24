import { createHash, randomBytes } from "node:crypto";
import type { Owner } from "@/contracts";

/**
 * Pure identity derivations (no request access), shared by the cookie layer and tests.
 * Owner ids are one-way hashes, so neither a guest token nor an account subject can be
 * recovered from stored data, and the two kinds can never collide (distinct prefixes).
 */

/** 32 random bytes, base64url without padding: 43 characters, 256 bits. */
export function newGuestToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isValidGuestToken(t: string | undefined | null): t is string {
  return typeof t === "string" && /^[A-Za-z0-9_-]{43}$/.test(t);
}

export function guestOwnerIdForToken(token: string): string {
  return `guest_${createHash("sha256").update(token).digest("hex").slice(0, 48)}`;
}

export function guestOwner(token: string): Owner {
  return { ownerId: guestOwnerIdForToken(token), kind: "guest", actor: { kind: "guest", label: "Guest session" } };
}

/**
 * Account owner from a validated identity-provider session (issuer + subject). The label is
 * display-only and must come from the validated session, never from request input.
 */
export function accountOwnerFromClaims(claims: { issuer: string; subject: string; displayName: string | null }): Owner {
  const id = createHash("sha256").update(`${claims.issuer}\n${claims.subject}`).digest("hex").slice(0, 48);
  const label = (claims.displayName ?? "").trim().slice(0, 200) || "Signed-in account";
  return { ownerId: `acct_${id}`, kind: "account", actor: { kind: "account", label } };
}
