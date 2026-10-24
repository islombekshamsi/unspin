import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { Owner } from "@/contracts";
import { isProduction } from "@/server/config/env";

/**
 * Guest identity: an unguessable capability token in an HttpOnly cookie.
 * The owner id is a hash of the token, so the token itself is never stored.
 * ownerId is never accepted from request bodies.
 */
export const GUEST_COOKIE = "unspin_guest";
const GUEST_MAX_AGE_S = 60 * 60 * 24 * 30;

function ownerIdForToken(token: string): string {
  return `guest_${createHash("sha256").update(token).digest("hex").slice(0, 48)}`;
}

function isValidToken(t: string | undefined): t is string {
  return typeof t === "string" && /^[A-Za-z0-9_-]{43}$/.test(t);
}

function guestOwner(token: string): Owner {
  return { ownerId: ownerIdForToken(token), kind: "guest", actor: { kind: "guest", label: "Guest session" } };
}

/** Resolves the caller's identity, creating a guest capability when none exists. Route handlers only. */
export async function resolveOwner(): Promise<Owner> {
  const jar = await cookies();
  const existing = jar.get(GUEST_COOKIE)?.value;
  if (isValidToken(existing)) return guestOwner(existing);
  const token = randomBytes(32).toString("base64url");
  jar.set(GUEST_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction(),
    path: "/",
    maxAge: GUEST_MAX_AGE_S,
  });
  return guestOwner(token);
}

/** Resolves identity without creating one (read-only endpoints). Returns null when absent. */
export async function currentOwner(): Promise<Owner | null> {
  const jar = await cookies();
  const existing = jar.get(GUEST_COOKIE)?.value;
  return isValidToken(existing) ? guestOwner(existing) : null;
}
