"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import styles from "./StudioShell.module.css";

const sections = [
  { href: "/", label: "Knowledge Studio", icon: "auto_stories", description: "Create and manage knowledge" },
  { href: "/ai-solution-view", label: "AI Solution View", icon: "article", description: "Review and improve solutions" },
];

export default function StudioShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (!sections.some(section => section.href === pathname)) return children;

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar} aria-label="Workspace sidebar">
        <Link href="/" className={styles.brand}>
          <span className={"ms " + styles.brandIcon} aria-hidden="true">auto_stories</span>
          <span>Knowledge<span className={styles.brandSubtitle}>Studio</span></span>
        </Link>
        <div className={styles.sectionLabel}>WORKSPACE</div>
        <nav className={styles.navigation} aria-label="Workspace navigation">
          {sections.map(section => (
            <Link key={section.href} href={section.href} aria-current={pathname === section.href ? "page" : undefined} className={styles.navLink}>
              <span className="ms" aria-hidden="true">{section.icon}</span>
              <span><strong>{section.label}</strong><small>{section.description}</small></span>
            </Link>
          ))}
        </nav>
        <div className={styles.sidebarFooter}><span className="ms" aria-hidden="true">auto_awesome</span><span>A workspace for better answers</span></div>
      </aside>
      <div className={styles.content}>{children}</div>
    </div>
  );
}
