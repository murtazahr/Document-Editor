import { NextResponse } from "next/server";
import { exchangeCode } from "@/lib/github";
import { refreshGithubIdentity } from "@/lib/git-sync";
import { writeSettings } from "@/lib/storage";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookie = req.headers.get("cookie") ?? "";
  const expected = cookie.match(/(?:^|;\s*)gh_oauth_state=([^;]+)/)?.[1];
  const back = (q: string) => NextResponse.redirect(`${url.origin}/?${q}`);
  if (!code || !state || !expected || state !== expected) return back("github=error&reason=state");
  try {
    const token = await exchangeCode(code, `${url.origin}/api/github/callback`);
    const me = await refreshGithubIdentity(token);
    await writeSettings({ githubToken: token, githubLogin: me.login, githubUserId: me.id, githubAvatarUrl: me.avatar });
    const res = back("github=connected");
    res.cookies.set("gh_oauth_state", "", { path: "/", maxAge: 0 });
    return res;
  } catch (e) {
    return back(`github=error&reason=${encodeURIComponent(e instanceof Error ? e.message : "exchange")}`);
  }
}
