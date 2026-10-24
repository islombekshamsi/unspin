import { describe, expect, it } from "vitest";
import { accountOwnerFromClaims, guestOwner, guestOwnerIdForToken, isValidGuestToken, newGuestToken } from "./owners";

describe("guest capability tokens", () => {
  it("are 256-bit base64url tokens that validate and never repeat", () => {
    const tokens = new Set(Array.from({ length: 200 }, newGuestToken));
    expect(tokens.size).toBe(200);
    for (const t of tokens) expect(isValidGuestToken(t)).toBe(true);
  });

  it("rejects malformed tokens", () => {
    for (const t of [undefined, null, "", "short", "a".repeat(42), "a".repeat(44), `${"a".repeat(42)}=`, `${"a".repeat(42)}/`]) {
      expect(isValidGuestToken(t)).toBe(false);
    }
  });

  it("derives a stable owner id that does not contain the token", () => {
    const t = newGuestToken();
    const id = guestOwnerIdForToken(t);
    expect(id).toMatch(/^guest_[a-f0-9]{48}$/);
    expect(id).toBe(guestOwnerIdForToken(t));
    expect(id).not.toContain(t);
    expect(guestOwnerIdForToken(newGuestToken())).not.toBe(id);
    expect(guestOwner(t)).toEqual({ ownerId: id, kind: "guest", actor: { kind: "guest", label: "Guest session" } });
  });
});

describe("account owners", () => {
  it("derive from issuer and subject, separate from guest ids", () => {
    const a = accountOwnerFromClaims({ issuer: "https://tenant.example/", subject: "auth0|123", displayName: " Ada " });
    expect(a.ownerId).toMatch(/^acct_[a-f0-9]{48}$/);
    expect(a.actor).toEqual({ kind: "account", label: "Ada" });
    expect(accountOwnerFromClaims({ issuer: "https://other.example/", subject: "auth0|123", displayName: null }).ownerId).not.toBe(a.ownerId);
    expect(accountOwnerFromClaims({ issuer: "https://tenant.example/", subject: "auth0|123", displayName: null }).actor.label).toBe("Signed-in account");
  });
});
