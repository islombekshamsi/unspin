import { connection } from "next/server";
import { getHealth } from "@/server/orchestration/health";
import { handle, jsonOk } from "@/server/orchestration/http";

export async function GET() {
  await connection();
  return handle("GET /health", async (requestId) => jsonOk(requestId, { health: await getHealth() }));
}
