import { NextResponse } from "next/server";
import { StorageError } from "./storage";
import { PangramError } from "./pangram/client";
import { GitError } from "./git";
import { GitHubError } from "./github";
import { GrammarError } from "./grammar/claude";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function handle<T extends unknown[]>(fn: (...args: T) => Promise<Response>) {
  return async (...args: T): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof StorageError || e instanceof PangramError || e instanceof GitError || e instanceof GitHubError || e instanceof GrammarError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: e instanceof Error ? e.message : "Internal error" }, 500);
    }
  };
}

export type Params<K extends string> = { params: Promise<Record<K, string>> };
