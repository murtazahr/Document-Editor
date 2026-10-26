import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { authorizeUrl, oauthConfigured } from "@/lib/github";
import { json } from "@/lib/api";

export async function GET(req: Request) {
  if (!oauthConfigured()) return json({ error: "GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET are not set. Paste a personal access token instead, or register an OAuth app (see README)." }, 400);
  const origin = new URL(req.url).origin;
  const state = crypto.randomBytes(16).toString("hex");
  const res = NextResponse.redirect(authorizeUrl(`${origin}/api/github/callback`, state));
  res.cookies.set("gh_oauth_state", state, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
  return res;
}
