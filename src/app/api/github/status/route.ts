import { handle, json } from "@/lib/api";
import { oauthConfigured } from "@/lib/github";
import { gitAvailable } from "@/lib/git";
import { readSettings } from "@/lib/storage";

export const GET = handle(async () => {
  const s = await readSettings();
  return json({
    oauthConfigured: oauthConfigured(),
    gitAvailable: await gitAvailable(),
    connected: !!s.githubToken,
    login: s.githubLogin ?? null,
    avatarUrl: s.githubAvatarUrl ?? null,
    autoCreate: s.githubAutoCreate ?? true,
    privateRepos: s.githubPrivate ?? true,
    autoSync: s.githubAutoSync ?? true,
  });
});
