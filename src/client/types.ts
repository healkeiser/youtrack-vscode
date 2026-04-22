export interface User {
  id: string;
  login: string;
  fullName: string;
  avatarUrl: string;
}

export interface CustomField {
  name: string;
  type: CustomFieldType;
  value: CustomFieldValue;
}

export type CustomFieldType =
  | 'enum'
  | 'user'
  | 'state'
  | 'string'
  | 'date'
  | 'datetime'
  | 'period'
  | 'int'
  | 'float'
  | 'bool'
  | 'version'
  | 'unknown';

export type EnumColor = { background?: string; foreground?: string };

export type CustomFieldValue =
  | { kind: 'enum'; id: string; name: string; color?: EnumColor }
  | { kind: 'user'; login: string; fullName: string; avatarUrl: string }
  | { kind: 'state'; id: string; name: string; color?: EnumColor }
  | { kind: 'string'; text: string }
  | { kind: 'date'; iso: string }
  | { kind: 'period'; seconds: number }
  | { kind: 'number'; value: number }
  | { kind: 'bool'; value: boolean }
  | { kind: 'version'; name: string }
  | { kind: 'unknown'; raw: string }
  | { kind: 'empty' };

export interface Tag {
  id: string;
  name: string;
  color: { id?: string; background?: string; foreground?: string } | null;
}

export interface IssueLink {
  direction: string;               // e.g. 'OUTWARD', 'INWARD', 'BOTH'
  name: string;                    // human label (e.g. 'relates to', 'is blocked by')
  issues: Array<{ idReadable: string; summary: string; resolved: number | null }>;
}

export interface Issue {
  id: string;
  idReadable: string;
  summary: string;
  description: string;
  project: { id: string; shortName: string };
  reporter: User | null;
  assignee: User | null;
  created: number;
  updated: number;
  resolved: number | null;
  customFields: CustomField[];
  tags: Tag[];
  links: IssueLink[];
}

export interface CommentReaction {
  id: string;
  reaction: string;
  author: User;
}

export interface Comment {
  id: string;
  text: string;
  author: User;
  created: number;
  attachments: Attachment[];
  reactions: CommentReaction[];
  /** True when YouTrack has a LimitedVisibility on this comment. */
  restricted: boolean;
  /** Human label of the visibility constraint ("Developers", "Admin, QA", …). */
  visibilityLabel: string;
}

export interface Attachment {
  id: string;
  name: string;
  url: string;
  size: number;
  mimeType: string;
}

export interface WorkItem {
  id: string;
  author: User;
  duration: number; // seconds
  date: number; // epoch ms
  type: { id: string; name: string } | null;
  text: string;
}

export interface SavedQuery {
  id: string;
  name: string;
  query: string;
}

export interface AgileBoard {
  id: string;
  name: string;
  projects: { shortName: string }[];
  /** False for boards with the "Disable sprints" admin option on. */
  sprintsEnabled: boolean;
}

export interface Sprint {
  id: string;
  name: string;
  current: boolean;
}

export interface BoardColumn {
  id: string;
  name: string;
  states: string[];
}

export interface BoardView {
  columns: BoardColumn[];
  issuesByColumn: Record<string, Issue[]>;
}
