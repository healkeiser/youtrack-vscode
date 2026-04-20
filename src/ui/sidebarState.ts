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
  sortMode: SortMode = 'default';

  setFilterText(v: string): void { this.filterText = v.trim().toLowerCase(); this._emitter.fire(); }
  setStateFilter(v: string[]): void { this.stateFilter = new Set(v); this._emitter.fire(); }
  setTagFilter(v: string[]): void   { this.tagFilter = new Set(v); this._emitter.fire(); }
  setGroupMode(v: GroupMode): void  { this.groupMode = v; this._emitter.fire(); }
  setSortMode(v: SortMode): void    { this.sortMode = v; this._emitter.fire(); }

  anyFilterActive(): boolean {
    return !!this.filterText || this.stateFilter.size > 0 || this.tagFilter.size > 0;
  }
}
