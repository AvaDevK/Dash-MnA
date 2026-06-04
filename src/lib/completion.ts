/**
 * Completion rollup logic for the M&A onboarding dashboard.
 *
 * Hierarchy considered (lowest -> highest):
 *   linked issue / sub-task / story / task / epic  ->  RI (roadmap item)  ->  Initiative
 *
 * Status classification is intentionally exact-match (case-insensitive) so
 * statuses like "Production" (which means "in production-readiness work",
 * not actually shipped) are correctly treated as INCOMPLETE.
 */

export type Row = Record<string, string | undefined>;

const COMPLETE_STATUSES: ReadonlySet<string> = new Set([
  "done",
  "closed",
  "resolved",
  "cancelled",
  "canceled",
]);

const ACTIVE_STATUSES: ReadonlySet<string> = new Set([
  "new",
  "backlog",
  "open",
  "todo",
  "to do",
  "in progress",
  "elaboration",
  "waiting for elaboration",
  "waiting for production",
  "production",
  "ready to estimate",
  "in defining",
  "waiting",
]);

const NO_LINKS_MARKER = "no links";

const normalize = (s: string | undefined | null): string =>
  (s || "").toLowerCase().trim();

export function isCompleteStatus(status: string | undefined | null): boolean {
  return COMPLETE_STATUSES.has(normalize(status));
}

export function isActiveStatus(status: string | undefined | null): boolean {
  return ACTIVE_STATUSES.has(normalize(status));
}

export function getIssueScore(status: string | undefined | null): number {
  return isCompleteStatus(status) ? 100 : 0;
}

export function calculatePendingPercent(completion: number): number {
  const c = Number.isFinite(completion) ? completion : 0;
  return Math.max(0, Math.min(100, 100 - c));
}

const pick = (row: Row, keys: string[]): string => {
  for (const k of keys) {
    const v = row[k];
    if (v && String(v).trim()) return String(v).trim();
  }
  return "";
};

export const roadmapKeyOf = (r: Row): string =>
  pick(r, ["roadmap_key", "parent_key", "ri_key", "roadmap_item_key"]);

export const roadmapStatusOf = (r: Row): string =>
  pick(r, [
    "roadmap_status",
    "parent_status",
    "ri_status",
    "roadmap_item_status",
  ]);

export const initiativeKeyOf = (r: Row): string =>
  pick(r, ["initiative_key", "mna_key"]) ||
  pick(r, ["initiative_title", "initiative_name", "mna", "mna_name"]);

/**
 * Returns the set of distinct issue keys (with their statuses) attached
 * to a roadmap item. Honours:
 *   - dedup of repeated keys
 *   - skip linked rows where link_type === "NO LINKS"
 *   - optional sharedSeen set for initiative-level dedup across RIs
 */
function collectItemsForRoadmap(
  rows: Row[],
  roadmapKey: string,
  sharedSeen?: Set<string>,
): Map<string, string> {
  const local = new Map<string, string>();
  const seen = sharedSeen ?? new Set<string>();

  for (const r of rows) {
    if (roadmapKeyOf(r) !== roadmapKey) continue;

    const add = (k: string | undefined, s: string | undefined) => {
      const key = (k || "").trim();
      if (!key) return;
      if (seen.has(key) || local.has(key)) return;
      local.set(key, s || "");
      seen.add(key);
    };

    add(r.epic_key, r.epic_status);
    add(r.story_key, r.story_status || r.issue_status);
    add(r.subtask_key, r.subtask_status);
    add(r.source_issue_key, r.source_issue_status);

    const linkType = normalize(r.link_type);
    if (r.linked_key && linkType !== NO_LINKS_MARKER) {
      add(r.linked_key, r.linked_status);
    }
  }

  return local;
}

/**
 * Completion percentage (0-100) for a single Roadmap Item (RI).
 *  - If the RI has any child / linked records: avg of getIssueScore over them.
 *  - Otherwise falls back to the RI's own status.
 *
 * `sharedSeen` lets callers (initiative-level rollup) prevent a linked issue
 * from being counted in more than one RI of the same Initiative.
 */
export function calculateRICompletion(
  rows: Row[],
  roadmapKey: string,
  sharedSeen?: Set<string>,
): number {
  const items = collectItemsForRoadmap(rows, roadmapKey, sharedSeen);
  if (items.size > 0) {
    const scores = Array.from(items.values()).map(getIssueScore);
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  }
  for (const r of rows) {
    if (roadmapKeyOf(r) === roadmapKey) {
      return getIssueScore(roadmapStatusOf(r));
    }
  }
  return 0;
}

/**
 * Completion percentage (0-100) for an Initiative.
 * Equals the average of per-RI completion across that Initiative's RIs.
 * Dedupes linked / child issue keys across RIs so a shared dependency
 * is not double-counted.
 */
export function calculateInitiativeCompletion(
  rows: Row[],
  initiativeKey: string,
): number {
  if (!initiativeKey) return 0;
  const riKeys = new Set<string>();
  for (const r of rows) {
    if (initiativeKeyOf(r) !== initiativeKey) continue;
    const rk = roadmapKeyOf(r);
    if (rk) riKeys.add(rk);
  }
  if (riKeys.size === 0) return 0;
  const sharedSeen = new Set<string>();
  const scores: number[] = [];
  for (const rk of riKeys) {
    scores.push(calculateRICompletion(rows, rk, sharedSeen));
  }
  if (!scores.length) return 0;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

/**
 * Console-safe sanity check. Not wired into any UI; call from a dev
 * console (or paste into a one-off test) if you want to verify the
 * status-classification + rollup behavior on a known fixture.
 */
export function __sanityCheck(): {
  ok: boolean;
  details: Array<{ name: string; expected: unknown; got: unknown; ok: boolean }>;
} {
  const cases: Array<{ name: string; expected: unknown; got: unknown }> = [
    { name: "Done is complete", expected: true, got: isCompleteStatus("Done") },
    { name: "DONE (upper) is complete", expected: true, got: isCompleteStatus("DONE") },
    { name: "Production is NOT complete", expected: false, got: isCompleteStatus("Production") },
    { name: "In Progress is NOT complete", expected: false, got: isCompleteStatus("In Progress") },
    { name: "Cancelled is complete", expected: true, got: isCompleteStatus("Cancelled") },
    { name: "score(Done)=100", expected: 100, got: getIssueScore("Done") },
    { name: "score(In Progress)=0", expected: 0, got: getIssueScore("In Progress") },
    { name: "pending(72)=28", expected: 28, got: calculatePendingPercent(72) },
    { name: "pending(0)=100", expected: 100, got: calculatePendingPercent(0) },
    { name: "pending(100)=0", expected: 0, got: calculatePendingPercent(100) },
  ];
  const details = cases.map((c) => ({ ...c, ok: c.expected === c.got }));
  return { ok: details.every((d) => d.ok), details };
}
