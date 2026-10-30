import { lazy } from 'react';
import { AudioLines, Bot, Globe2, LayoutDashboard, NotebookPen, SlidersHorizontal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export const moduleIds = ['overview', 'media', 'editor', 'copilot', 'workspace', 'browser'] as const;
export type ModuleId = (typeof moduleIds)[number];

export interface ModuleDefinition {
  id: ModuleId;
  title: string;
  subtitle: string;
  description: string;
  icon: LucideIcon;
  shortcut: string;
  status: 'shell' | 'preview' | 'planned';
  capabilities: readonly string[];
  component: ReturnType<typeof lazy>;
}

/** Trusted, build-time registration only. Entries drive the sidebar and dashboard. */
export const modules: readonly ModuleDefinition[] = [
  {
    id: 'overview', title: 'Overview', subtitle: 'A quieter place to do more.',
    description: 'Your tools, together. Your data, with you.',
    icon: LayoutDashboard, shortcut: '1', status: 'shell', capabilities: [],
    component: lazy(() => import('./Overview')),
  },
  {
    id: 'media', title: 'Media library', subtitle: 'Keep the things worth replaying.',
    description: 'A home for your offline music, videos, and collections.',
    icon: AudioLines, shortcut: '2', status: 'preview',
    capabilities: ['Local downloads & metadata', 'Offline audio & video', 'Library & collections'],
    component: lazy(() => import('./media/MediaScreen')),
  },
  {
    id: 'editor', title: 'Studio', subtitle: 'Small edits. Less overhead.',
    description: 'Trim plans and a small toolkit for local image processing.',
    icon: SlidersHorizontal, shortcut: '3', status: 'preview',
    capabilities: ['Batch image processing', 'Video trim & conversion', 'On-demand processing jobs'],
    component: lazy(() => import('./MediaEditor/MediaEditor')),
  },
  {
    id: 'copilot', title: 'AI copilot', subtitle: 'A thinking partner on your terms.',
    description: 'Connect to a local model when you need another perspective.',
    icon: Bot, shortcut: '4', status: 'preview',
    capabilities: ['Local runner connection', 'Streaming conversations', 'Explicit context sharing'],
    component: lazy(() => import('./AICopilot/AICopilot')),
  },
  {
    id: 'workspace', title: 'Workspace', subtitle: 'Make room for your ideas.',
    description: 'Write notes, organize thoughts, and work with small spreadsheets.',
    icon: NotebookPen, shortcut: '5', status: 'preview',
    capabilities: ['Markdown & rich-text notes', 'Lightweight spreadsheet grid', 'Local files & export'],
    component: lazy(() => import('./Workspace/Workspace')),
  },
  {
    id: 'browser', title: 'Private browser', subtitle: 'A separate space for the web.',
    description: 'An isolated webview, with a deliberately limited connection to your desktop.',
    icon: Globe2, shortcut: '6', status: 'preview',
    capabilities: ['Unprivileged webview', 'Tracker-blocking rules', 'Platform-specific session protection'],
    component: lazy(() => import('./InternalBrowser/InternalBrowser')),
  },
];

export function resolveModule(id: string): ModuleDefinition {
  return modules.find((module) => module.id === id) ?? modules[0];
}
