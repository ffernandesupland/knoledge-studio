"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import styles from "./StudioShell.module.css";

const knowledgeStudioItems = [
  { href: "/knowledge-studio/create", label: "Knowledge Studio Create", icon: "auto_stories", description: "Create and manage knowledge" },
  { href: "/ground-truth-management", label: "Ground Truth Management", icon: "library_books", description: "Manage reusable reference context" },
  { href: "/solution-standards-management", label: "Solution Standards Management", icon: "rule", description: "Manage content standards" },
  { href: "/snippets-management", label: "Snippets Management", icon: "code_blocks", description: "Manage reusable content structures" },
  { href: "/knowledge-studio-evals", label: "Knowledge Studio Evals", icon: "analytics", description: "Compare internal draft evaluations" },
];
const sections = [
  { href: "/ai-solution-view", label: "AI Solution View", icon: "article", description: "Review and improve solutions" },
  { href: "/ai-workspace", label: "AI Workspace", icon: "forum", description: "Ask, prepare, and act in the KB" },
  { href: "/rightanswers-connections", label: "RightAnswers", icon: "hub", description: "Manage customer connections" },
];

export default function StudioShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [knowledgeStudioOpen, setKnowledgeStudioOpen] = useState(true);
  const knowledgeStudioActive = pathname === "/" || knowledgeStudioItems.some(item => item.href === pathname);
  if (!knowledgeStudioActive && !sections.some(section => section.href === pathname)) return children;

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar} aria-label="Workspace sidebar">
        <Link href="/" className={styles.brand}>
          <span className={"ms " + styles.brandIcon} aria-hidden="true">auto_stories</span>
          <span>Knowledge<span className={styles.brandSubtitle}>Studio</span></span>
        </Link>
        <div className={styles.sectionLabel}>WORKSPACE</div>
        <nav className={styles.navigation} aria-label="Workspace navigation">
          <section className={styles.navGroup}>
            <button type="button" className={styles.navGroupButton} aria-expanded={knowledgeStudioOpen} aria-controls="knowledge-studio-navigation" onClick={() => setKnowledgeStudioOpen(open => !open)}>
              <span className="ms" aria-hidden="true">auto_stories</span>
              <span><strong>Knowledge Studio</strong><small>Create and manage knowledge</small></span>
              <span className={"ms " + styles.navGroupChevron} aria-hidden="true">{knowledgeStudioOpen ? "expand_less" : "expand_more"}</span>
            </button>
            {knowledgeStudioOpen && <div id="knowledge-studio-navigation" className={styles.navChildren}>
              {knowledgeStudioItems.map(item => {
                const active = pathname === item.href || (pathname === "/" && item.href === "/knowledge-studio/create");
                return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={styles.navLink}>
                  <span className="ms" aria-hidden="true">{item.icon}</span>
                  <span><strong>{item.label}</strong><small>{item.description}</small></span>
                </Link>;
              })}
            </div>}
          </section>
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
