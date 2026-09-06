import type { SessionSummary } from '@/camera/useDeskSession';

/**
 * Hands a finished session from the session route to the summary route.
 *
 * expo-router params are URL query strings, and a SessionSummary carries an
 * array of readings — serialising that through the URL would be lossy, ugly in
 * the address bar on web, and would silently break the moment a session runs
 * long enough to exceed a sane URL length. A single in-memory slot is the
 * honest way to pass an object between two screens in the same navigation.
 *
 * It is deliberately consumed on read: navigating to /summary directly (a deep
 * link, a refresh on web) yields null rather than a stale session from an hour
 * ago, and the summary screen handles that.
 */
let pending: SessionSummary | null = null;

export function stageSessionSummary(summary: SessionSummary): void {
  pending = summary;
}

export function takeSessionSummary(): SessionSummary | null {
  const summary = pending;
  pending = null;
  return summary;
}
