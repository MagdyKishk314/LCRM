'use client';

import {
  BarChart3,
  Blocks,
  Building2,
  Calendar,
  CalendarClock,
  CheckSquare,
  ChevronRight,
  Circle,
  Copy,
  CreditCard,
  History,
  FileInput,
  FileText,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  ListFilter,
  ListPlus,
  Mail,
  MessageSquare,
  Palette,
  Phone,
  ScrollText,
  Send,
  Settings,
  ShieldCheck,
  Signal,
  Sliders,
  Target,
  Upload,
  Users,
  Workflow,
  type LucideProps,
} from 'lucide-react';

/**
 * Resolve a lucide icon by the string name a module manifest carries.
 *
 * Manifests are plain data shared with the API, so they cannot hold component
 * references — the indirection lives here instead. The map is explicit rather than a
 * namespace import so the bundler only ships the icons actually referenced; a
 * `import * as Icons` here pulls the entire library into the client bundle.
 *
 * Adding an icon to a manifest means adding it to this map too, or it renders as a dot.
 */
const ICONS: Record<string, React.ComponentType<LucideProps>> = {
  BarChart3,
  Blocks,
  Building2,
  Calendar,
  CalendarClock,
  CheckSquare,
  ChevronRight,
  Copy,
  CreditCard,
  FileInput,
  History,
  FileText,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  ListFilter,
  ListPlus,
  Mail,
  MessageSquare,
  Palette,
  Phone,
  ScrollText,
  Send,
  Settings,
  ShieldCheck,
  Signal,
  Sliders,
  Target,
  Upload,
  Users,
  Workflow,
};

export function Icon({ name, ...props }: { name: string } & LucideProps) {
  const Resolved = ICONS[name] ?? Circle;
  return <Resolved {...props} />;
}
