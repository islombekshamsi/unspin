import { z } from "zod";
import { AppError, isAppError, newId, type ApiErrorBody } from "@/contracts";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

export function jsonOk<T extends object>(requestId: string, body: T, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(PRIVATE_HEADERS);
  if (extraHeaders) new Headers(extraHeaders).forEach((v, k) => headers.set(k, v));
  return Response.json({ ...body, requestId }, { status, headers });
}

export function jsonError(requestId: string, err: AppError): Response {
  const body: ApiErrorBody = {
    error: {
      code: err.code,
      message: err.message,
      retryable: err.retryable,
      ...(err.details ? { details: err.details } : {}),
    },
    requestId,
  };
  return Response.json(body, { status: err.status, headers: PRIVATE_HEADERS });
}

/**
 * Wraps a route body: assigns a requestId, converts AppError to the error envelope,
 * and hides unexpected failures behind a generic 500. Logs carry ids and error
 * categories only, never request bodies or source content.
 */
export async function handle(
  route: string,
  fn: (requestId: string) => Promise<Response>,
): Promise<Response> {
  const requestId = newId("req");
  const started = Date.now();
  try {
    const res = await fn(requestId);
    return res;
  } catch (e) {
    if (isAppError(e)) {
      if (e.status >= 500) {
        console.warn(`[api] ${route} ${requestId} ${e.code} ${Date.now() - started}ms`);
      }
      return jsonError(requestId, e);
    }
    console.error(`[api] ${route} ${requestId} internal ${errorName(e)} ${Date.now() - started}ms`);
    return jsonError(requestId, new AppError("internal", "Unexpected server error. Your saved work is unchanged.", { retryable: true }));
  }
}

function errorName(e: unknown): string {
  return e instanceof Error ? e.name : typeof e;
}

export async function parseJson<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AppError("bad_request", "Request body must be valid JSON.");
  }
  return parseWith(schema, raw);
}

export function parseWith<T extends z.ZodType>(schema: T, raw: unknown): z.infer<T> {
  const r = schema.safeParse(raw);
  if (!r.success) {
    throw new AppError("bad_request", "Request did not match the expected shape.", {
      details: { issues: r.error.issues.slice(0, 10).map((i) => ({ path: i.path.join("."), message: i.message })) },
    });
  }
  return r.data;
}

export function searchParamsObject(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  new URL(request.url).searchParams.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}
