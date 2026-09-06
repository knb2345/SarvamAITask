'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function Rail() {
  const path = usePathname();
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    fetch('/api/stats').then((r) => r.json()).then(setStats).catch(() => {});
  }, [path]);

  const items = [
    { href: '/', label: 'Hey Kivi', count: null as string | null },
    { href: '/dictate', label: 'Dictation', count: null },
    { href: '/memory', label: 'What Kivi knows', count: stats ? String(stats.memories.active) : null },
    { href: '/history', label: 'Dictation history', count: stats ? String(stats.dictations) : null },
    { href: '/inspect', label: 'Why', count: null },
  ];

  return (
    <aside className="rail">
      <div className="brand">
        <div className="brand-mark">
          kiv<span>i</span>
        </div>
        <div className="brand-sub">by sarvam</div>
      </div>

      <nav className="nav">
        {items.map((i) => (
          <Link key={i.href} href={i.href} className={path === i.href ? 'active' : ''}>
            <span>{i.label}</span>
            {i.count && <span className="count">{i.count}</span>}
          </Link>
        ))}
      </nav>

      <div className="rail-foot">
        Dictation works the way it always did — styles and nothing else. Everything on these
        pages reaches Hey&nbsp;Kivi only.
      </div>
    </aside>
  );
}
