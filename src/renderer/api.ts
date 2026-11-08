import type { RankTrackerApi } from '../shared/types';

export const api: RankTrackerApi = window.rankTracker;

/** The message of an error from the main process, without Electron's "Error invoking remote method" prefix. */
export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
