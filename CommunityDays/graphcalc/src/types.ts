export interface Expression {
  id: string;
  raw: string;
  color: string;
  visible: boolean;
  error?: string;
  folderId?: string;
  note?: string;
}

export interface Folder {
  id: string;
  name: string;
  collapsed: boolean;
}
