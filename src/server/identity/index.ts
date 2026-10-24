import { cookies } from "next/headers";
import { AppError, type Owner } from "@/contracts";
import { auth0Configured, isProduction } from "@/server/config/env";
import { claimWorkspace, type ClaimResult } from "@/server/storage";
import { guestOwner, isValidGuestToken, newGuestToken } from "./owners";

/**
 * Guest identity: an unguessable capability token in an HttpOnly cookie.
 * The owner id is a hash of the token, so the token itself is never stored.
 * ownerId is never accepted from request bodies.
 */
export const GUEST_COOKIE = "unspin_guest";
const GUEST_MAX_AGE_S = 60 * 60 * 24 * 30;

export { accountOwnerFromClaims, guestOwner } from "./owners";

/**
 * Account identity from a validated Auth0 session. Returns null until the Auth0 SDK is
 * installed and wired (see the infrastructure report); never fabricates a signed-in user.
 * When wired, this reads the SDK session server-side and maps it with accountOwnerFromClaims.
 */
export async function accountOwner(): Promise<Owner | null> {
  if (!auth0Configured()) return null;
  // Configured, but without the SDK no session can be validated, so there is no account.
  return null;
}

/** Resolves the caller's identity, creating a guest capability when none exists. Route handlers only. */
export async function resolveOwner(): Promise<Owner> {
  const account = await accountOwner();
  if (account) return account;
  const jar = await cookies();
  const existing = jar.get(GUEST_COOKIE)?.value;
  if (isValidGuestToken(existing)) return guestOwner(existing);
  const token = newGuestToken();
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
  const account = await accountOwner();
  if (account) return account;
  const jar = await cookies();
  const existing = jar.get(GUEST_COOKIE)?.value;
  return isValidGuestToken(existing) ? guestOwner(existing) : null;
}

/** The guest identity carried by this request's cookie, if any (ignores any account session). */
export async function currentGuest(): Promise<Owner | null> {
  const jar = await cookies();
  const existing = jar.get(GUEST_COOKIE)?.value;
  return isValidGuestToken(existing) ? guestOwner(existing) : null;
}

/**
 * Explicit claim at login: moves the guest workspace to the account in one storage
 * transaction. Both identities must be server-derived (cookie and validated session).
 */
export async function claimGuestWorkspace(guest: Owner, account: Owner): Promise<ClaimResult> {
  if (guest.kind !== "guest" || account.kind !== "account" || !guest.ownerId.startsWith("guest_") || !account.ownerId.startsWith("acct_")) {
    throw new AppError("forbidden", "Only a guest workspace can be claimed by a signed-in account.");
  }
  return claimWorkspace(guest, account);
}

/** Drops the guest capability after a successful claim so the browser stops using the emptied workspace. */
export async function endGuestSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(GUEST_COOKIE);
}
