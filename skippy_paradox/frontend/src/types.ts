// Shared type definitions for the editor-only app.

export interface FileNode {
  id: string;
  name: string;
  content: string;
  language: string;
}

export type Theme = 'dark' | 'light';
