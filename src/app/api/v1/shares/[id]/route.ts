import { AppError } from "@/contracts";
import { handle } from "@/server/orchestration/http";

export async function DELETE() {
  return handle("DELETE /shares/:id", async () => {
    throw new AppError("not_configured", "Read-only sharing is not available on this server yet.");
  });
}
