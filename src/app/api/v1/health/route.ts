import { connection } from "next/server";
import { getHealth } from "@/server/orchestration/health";
import { handle, jsonOk } from "@/server/orchestration/http";

export async function GET() {
  return handle("GET /health", async (requestId) => {
    await connection();
    return jsonOk(requestId, { health: await getHealth() });
  });
}
