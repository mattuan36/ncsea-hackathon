import type { LucideIcon } from 'lucide-react';

export default function PlaceholderPage({ title, icon: Icon }: { title: string; icon: LucideIcon }) {
  return (
    <div className="page">
      <header className="page-header">
        <h1>{title}</h1>
      </header>
      <div className="placeholder">
        <Icon size={40} strokeWidth={1.25} />
        <p className="placeholder-title">{title} is ready for data</p>
        <p className="muted">Content for this section will be added once the data is provided.</p>
      </div>
    </div>
  );
}
