import * as vscode from 'vscode';

export type GroupMode = 'none' | 'project';
export type SortMode = 'default' | 'updated' | 'created' | 'id';

export class SidebarState {
  private _emitter = new vscode.EventEmitter<void>();
  onDidChange = this._emitter.event;

  filterText = '';
  stateFilter = new Set<string>();
  tagFilter = new Set<string>();
  groupMode: GroupMode = 'project';
  // Default to id-descending so the newest (highest-numbered) issue is
  // always on top — matches what users expect from a ticket list and
  // doesn't depend on whatever order the YouTrack saved search returns.
  sortMode: SortMode = 'id';
  sortDir: 'asc' | 'desc' = 'desc';
  unresolvedOnly = false;

  setFilterText(v: string): void { this.filterText = v.trim().toLowerCase(); this._emitter.fire(); }
  setStateFilter(v: string[]): void { this.stateFilter = new Set(v); this._emitter.fire(); }
  setTagFilter(v: string[]): void   { this.tagFilter = new Set(v); this._emitter.fire(); }
  setGroupMode(v: GroupMode): void  { this.groupMode = v; this._emitter.fire(); }
  setSortMode(v: SortMode): void    { this.sortMode = v; this._emitter.fire(); }
  setSortDir(v: 'asc' | 'desc'): void { this.sortDir = v; this._emitter.fire(); }
  setUnresolvedOnly(v: boolean): void { this.unresolvedOnly = v; this._emitter.fire(); }

  anyFilterActive(): boolean {
    return !!this.filterText || this.stateFilter.size > 0 || this.tagFilter.size > 0 || this.unresolvedOnly;
  }
}
