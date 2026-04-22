// Map a YouTrack state name to a codicon. The VS Code theme-color hint
// is used as a fallback when we don't have the YouTrack-configured hex;
// callers that do have the hex should prefer it for visual accuracy.
//
// The pattern ordering is significant — "in staging" must be caught
// before the generic "progress" bucket, "can't reproduce" before the
// "cancel" bucket, etc. Each pattern picks a distinct codicon so visually
// similar states (Done / Fixed / Verified) still render differently.
export function stateVisuals(state: string): { icon: string; color?: string } {
  const s = state.toLowerCase();
  if (!s) return { icon: 'circle-outline' };

  // Resolved / complete
  if (/(verified)/.test(s))           return { icon: 'verified-filled', color: 'testing.iconPassed' };
  if (/(done|complete)/.test(s))      return { icon: 'pass-filled', color: 'testing.iconPassed' };
  if (/(fixed)/.test(s))              return { icon: 'check', color: 'testing.iconPassed' };
  if (/(closed|resolved)/.test(s))    return { icon: 'check-all', color: 'testing.iconPassed' };
  if (/(released|shipped)/.test(s))   return { icon: 'rocket', color: 'testing.iconPassed' };

  // Work in flight
  if (/(staging|stag)/.test(s))       return { icon: 'beaker', color: 'charts.green' };
  if (/(progress|develop|working|wip|active|ongoing)/.test(s))
                                      return { icon: 'sync', color: 'charts.blue' };

  // Waiting / validation
  if (/(review)/.test(s))             return { icon: 'eye', color: 'charts.yellow' };
  if (/(qa|test)/.test(s))            return { icon: 'beaker', color: 'charts.yellow' };
  if (/(pending|waiting)/.test(s))    return { icon: 'clock', color: 'charts.yellow' };

  // Stopped
  if (/(block)/.test(s))              return { icon: 'debug-disconnect', color: 'charts.red' };
  if (/(hold|paused|pause)/.test(s))  return { icon: 'debug-pause', color: 'charts.orange' };

  // Invalidated
  if (/won.?t\s*fix/.test(s))         return { icon: 'close', color: 'charts.red' };
  if (/duplicate/.test(s))            return { icon: 'copy', color: 'charts.red' };
  if (/can.?t\s*reproduce/.test(s))   return { icon: 'question', color: 'charts.orange' };
  if (/invalid|obsolete/.test(s))     return { icon: 'circle-slash', color: 'charts.red' };
  if (/(cancel|reject)/.test(s))      return { icon: 'circle-slash', color: 'charts.red' };

  // Fresh
  if (/(open|submitted|new)/.test(s)) return { icon: 'issue-opened', color: 'descriptionForeground' };
  if (/(to.?do|backlog)/.test(s))     return { icon: 'circle-large-outline', color: 'descriptionForeground' };

  return { icon: 'circle-outline', color: 'descriptionForeground' };
}
