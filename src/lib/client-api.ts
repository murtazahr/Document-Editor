"use client";

import type { ProjectMeta, FileEntry } from "./storage";
import type { CompileResult } from "./latex-compile";
import type { StoredDetection } from "./pangram/types";

export type { ProjectMeta, FileEntry, CompileResult, StoredDetection };

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const ct = res.headers.get("content-type") ?? "";
  const data = ct.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(typeof data === "object" && data && "error" in data ? String((data as { error: string }).error) : res.statusText, res.status);
  return data as T;
}

export type ProjectDetail = ProjectMeta & { files: FileEntry[] };
export type FileContent = { path: string; content: string; baseline: string | null };
export type SettingsInfo = {
  pangram: { hasKey: boolean; source: "env" | "settings" | "none"; mock: boolean; model: string; keyHint: string | null };
  latex: { engines: Record<"latexmk" | "tectonic" | "pdflatex", boolean>; selected: string | null; preference: string; envOverride: boolean };
};

export const encPath = (p: string) => p.split("/").map(encodeURIComponent).join("/");
