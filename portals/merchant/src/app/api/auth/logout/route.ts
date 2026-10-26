import { NextResponse, type NextRequest } from "next/server";

import { checkCsrf } from "@/lib/server/http";
import { clearSessionCookies, readSession, revokeSession } from "@/lib/server/session";

export async function POST(req: NextRequest) {
  const csrf = checkCsrf(req);
  if (csrf) return csrf;
  const { refreshToken } = readSession(req);
  if (refreshToken) await revokeSession(refreshToken);
  const res = NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  clearSessionCookies(res);
  return res;
}
