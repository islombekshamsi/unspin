import { AppError } from "@/contracts";
import { handle } from "@/server/orchestration/http";

/** Sharing is not available until a durable share repository and access checks are implemented. */
export async function POST() {
  return handle("POST /datasets/:id/shares", async () => {
    throw new AppError("not_configured", "Read-only sharing is not available on this server yet.");
  });
}
