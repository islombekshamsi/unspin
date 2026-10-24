import { isAppError } from "@/contracts";

/**
 * Detects the coordinator's placeholder seams by calling them. A placeholder
 * throws AppError "not_configured" or "unsupported_operation … not implemented yet".
 * Any other outcome (success or a different error) means a real implementation
 * is present, so the gated tests run and must pass on their own merits.
 */
export async function isPlaceholder(call: () => unknown): Promise<boolean> {
  try {
    await call();
    return false;
  } catch (e) {
    if (!isAppError(e)) return false;
    if (e.code === "not_configured") return true;
    return e.code === "unsupported_operation" && /not implemented yet/i.test(e.message);
  }
}

export const PLACEHOLDER_REASON = (module: string) =>
  `${module} is still the foundation placeholder (throws not_configured/unsupported_operation); runs once the specialist implementation is merged`;
