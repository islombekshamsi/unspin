import { randomBytes } from "node:crypto";
import type { Owner } from "@/contracts";

/** Server-derived identity stand-in for tests that run outside a request scope. */
export function makeOwner(label = "test"): Owner {
  return {
    ownerId: `guest_${label}_${randomBytes(12).toString("hex")}`,
    kind: "guest",
    actor: { kind: "guest", label: "Guest session" },
  };
}
