"use client";

import Link from "next/link";
import { useState } from "react";
import styles from "./SolutionView.module.css";
import { GroundContextCard, GroundContextEvidence, GroundContextPicker } from "./GroundContext";
import { emptyGroundContext, type GroundContextSelection } from "@/lib/ks/ground-context-demo";

const initial = {
  title: "Connect to the corporate VPN",
  summary: "Learn how to connect to the corporate network securely when working remotely, and resolve common VPN connection issues.",
  keywords: "VPN, remote access, network, connection",
  fields: [
    { name: "Overview", value: "Use the corporate VPN to access internal applications and shared resources while working outside the office." },
    { name: "Before you begin", value: "An active employee account, the approved VPN client, and your multi-factor authentication device are required." },
    { name: "Resolution", value: "1. Open the corporate VPN client.\n2. Select the Corporate network profile.\n3. Enter your employee credentials.\n4. Approve the multi-factor authentication request.\n5. Wait for the Connected status before opening internal applications." },
    { name: "Troubleshooting", value: "If the connection fails, check your internet connection and try again. Contact the IT service desk if the issue persists." },
  ],
};

const suggestions = {
  title: { label: "Title", value: "How to connect to the corporate VPN", reason: "Use a task-oriented title that matches the question a reader would search for." },
  summary: { label: "Summary", value: "Connect to the corporate VPN to access internal applications remotely. Follow the setup steps, verify your connection, and troubleshoot common connection issues.", reason: "Describe the task, expected outcome, and troubleshooting coverage in two short sentences." },
  keywords: { label: "Keywords", value: "VPN, remote access, corporate network, multi-factor authentication, VPN troubleshooting", reason: "Include terminology from the article to help readers find this solution." },
  fields: { label: "Fields", value: "If the connection fails:\n1. Confirm that your internet connection is working.\n2. Retry the VPN connection and complete the authentication request.\n3. If the issue persists, contact the IT service desk.", reason: "Turn the troubleshooting paragraph into a clear sequence of actions." },
};

const reviewFindings = [
  {
    id: "gap",
    icon: "find_in_page",
    title: "Knowledge gaps",
    badge: "1 missing answer",
    description: "The solution does not explain what to do when the multi-factor authentication request never arrives.",
    action: "Fix knowledge gap",
    proposal: "Add a troubleshooting section",
    detail: "Cover missing authentication requests, retry steps, and when to contact the service desk. Ask the identity team to verify the recovery procedure before publishing.",
    destination: "SOL-1042 · Troubleshooting",
  },
  {
    id: "duplicate",
    icon: "difference",
    title: "Duplications",
    badge: "1 potential duplicate",
    description: "SOL-0987, “Remote access with VPN,” covers the same connection steps as this solution.",
    action: "Fix duplications",
    proposal: "Merge overlapping solutions",
    detail: "Keep SOL-1042 as the primary solution, bring over any unique troubleshooting guidance from SOL-0987, and review the combined article before retiring the duplicate.",
    destination: "SOL-0987 → SOL-1042",
  },
];

type Suggestion = keyof typeof suggestions;
type Panel = "assist" | "review" | "create";
function Icon({ name }: { name: string }) {
  return <span className="ms" aria-hidden="true">{name}</span>;
}

export default function SolutionView() {
  const [article, setArticle] = useState(initial);
  const [panel, setPanel] = useState<Panel>("assist");
  const [activeSuggestion, setActiveSuggestion] = useState<Suggestion>("title");
  const [applied, setApplied] = useState<Suggestion[]>([]);
  const [preview, setPreview] = useState(false);
  const [notice, setNotice] = useState("");
  const [format, setFormat] = useState("FAQ");
  const [generated, setGenerated] = useState(false);
  const [reviewPlan, setReviewPlan] = useState<string[]>([]);
  const [groundContext, setGroundContext] = useState<GroundContextSelection>(emptyGroundContext);
  const [groundPickerOpen, setGroundPickerOpen] = useState(false);
  function changeGroundContext(value: GroundContextSelection) {
    setGroundContext(value);
    setGenerated(false);
  }
  const suggestion = suggestions[activeSuggestion];

  function applySuggestion() {
    if (activeSuggestion === "fields") {
      setArticle(current => ({ ...current, fields: current.fields.map(field => field.name === "Troubleshooting" ? { ...field, value: suggestion.value } : field) }));
    } else {
      setArticle(current => ({ ...current, [activeSuggestion]: suggestion.value }));
    }
    setApplied(current => [...new Set([...current, activeSuggestion])]);
    setNotice(suggestion.label + " suggestion applied to this preview.");
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.sectionTitle}>AI Solution View</span>
        <span className={styles.prototype}>Interactive mockup</span>
        <span className={styles.avatar} aria-label="Demo author">JD</span>
      </header>
      <main className={styles.main}>
        <nav aria-label="Breadcrumb" className={styles.breadcrumb}><Link href="/">Knowledge Studio</Link><Icon name="chevron_right" /><span>AI Solution View</span></nav>
        <div className={styles.heading}>
          <div><div className={styles.eyebrow}>SOLUTION WORKSPACE</div><h1>AI Solution View</h1><p>Shape better answers with AI, one solution at a time.</p></div>
          <div className={styles.actions}>
            <button type="button" className={styles.secondary} onClick={() => setGroundPickerOpen(true)} aria-haspopup="dialog"><Icon name="library_books" />Ground Context{groundContext.enabled && groundContext.referenceIds.length > 0 ? " (" + groundContext.referenceIds.length + ")" : ""}</button>
            <button type="button" className={styles.secondary} aria-pressed={panel === "review"} onClick={() => setPanel("review")}><Icon name="fact_check" />AI Solution Review</button>
            <button type="button" className={styles.primary} aria-pressed={panel === "create"} onClick={() => setPanel("create")}><Icon name="auto_awesome" />AI Knowledge Creation</button>
          </div>
        </div>
        <GroundContextCard value={groundContext} onChange={changeGroundContext} onOpen={() => setGroundPickerOpen(true)} />
        <div className={styles.layout}>
          <section className={styles.article} aria-label="Solution editor">
            <div className={styles.articleHeader}>
              <div className={styles.identity}><span className={styles.documentIcon}><Icon name="description" /></span><div><strong>Solution details</strong><div className={styles.meta}>SOL-1042 <span>·</span> How-to article <span>·</span> English</div></div><span className={styles.draft}>Draft</span></div>
              <div className={styles.switcher} aria-label="Article display"><button type="button" aria-pressed={!preview} onClick={() => setPreview(false)}>Edit</button><button type="button" aria-pressed={preview} onClick={() => setPreview(true)}>Preview</button></div>
            </div>
            <div className={styles.content}>
              <div className={styles.field}>
                <div className={styles.labelRow}><label htmlFor="solution-title">Title</label><button type="button" className={styles.aiLink} onClick={() => { setPanel("assist"); setActiveSuggestion("title"); }}><Icon name="auto_awesome" />Improve title</button></div>
                {preview ? <h2 className={styles.previewTitle}>{article.title}</h2> : <input id="solution-title" value={article.title} onChange={event => setArticle({ ...article, title: event.target.value })} />}
              </div>
              <div className={styles.field}>
                <div className={styles.labelRow}><label htmlFor="solution-summary">Summary</label><button type="button" className={styles.aiLink} onClick={() => { setPanel("assist"); setActiveSuggestion("summary"); }}><Icon name="auto_awesome" />Refine summary</button></div>
                {preview ? <p>{article.summary}</p> : <textarea id="solution-summary" rows={3} value={article.summary} onChange={event => setArticle({ ...article, summary: event.target.value })} />}
              </div>
              <div className={styles.field}>
                <div className={styles.labelRow}><label htmlFor="solution-keywords">Keywords</label><button type="button" className={styles.aiLink} onClick={() => { setPanel("assist"); setActiveSuggestion("keywords"); }}><Icon name="auto_awesome" />Suggest keywords</button></div>
                {preview ? <div className={styles.chips}>{article.keywords.split(",").filter(word => word.trim()).map((word, index) => <span key={index}>{word.trim()}</span>)}</div> : <><input id="solution-keywords" value={article.keywords} onChange={event => setArticle({ ...article, keywords: event.target.value })} /><small>Separate keywords with commas.</small></>}
              </div>
              <div className={styles.fieldsHeading}><div><h2>Fields</h2><p>Give your solution a clear, useful structure.</p></div><span className={styles.template}><Icon name="view_quilt" />How-to template</span></div>
              {article.fields.map((field, index) => <div className={styles.field} key={field.name}>
                <div className={styles.labelRow}><label htmlFor={"solution-field-" + index}><span className={styles.number}>{String(index + 1).padStart(2, "0")}</span>{field.name}</label>{field.name === "Troubleshooting" && <button type="button" className={styles.aiLink} onClick={() => { setPanel("assist"); setActiveSuggestion("fields"); }}><Icon name="auto_awesome" />Improve field</button>}</div>
                {preview ? <p className={styles.fieldPreview}>{field.value}</p> : <textarea id={"solution-field-" + index} rows={index === 2 ? 6 : 3} value={field.value} onChange={event => setArticle({ ...article, fields: article.fields.map((item, i) => i === index ? { ...item, value: event.target.value } : item) })} />}
              </div>)}
            </div>
            <footer className={styles.articleFooter}><Icon name="info" /><span>Demo content · Changes are kept only while this page is open.</span><button type="button" className={styles.reset} onClick={() => { setArticle(initial); setApplied([]); setGenerated(false); setReviewPlan([]); setGroundContext(emptyGroundContext); setNotice("Demo content restored."); }}>Reset demo</button></footer>
          </section>
          <aside className={styles.sidebar} aria-label="AI assistance">
            <section className={styles.assistant}>
              <div className={styles.assistantHeading}><span className={styles.spark}><Icon name="auto_awesome" /></span><div><h2>Your AI copilot</h2><p>A little help. A better solution.</p></div><span className={styles.demo}>DEMO</span></div>
              <div className={styles.tabs} aria-label="AI tools">{(["assist", "review", "create"] as const).map(tab => <button type="button" key={tab} aria-pressed={panel === tab} onClick={() => setPanel(tab)}>{tab === "assist" ? "Assist" : tab === "review" ? "Review" : "Create"}</button>)}</div>
              <div className={styles.panel}>
                <GroundContextEvidence key={JSON.stringify([groundContext, panel])} value={groundContext} mode={panel} />
                {panel === "assist" && <>
                  <h3>Make every word work harder</h3><p>Explore suggestions to make this solution easier to find and follow.</p>
                  <div className={styles.tools}>{(Object.keys(suggestions) as Suggestion[]).map(key => <button type="button" key={key} aria-pressed={activeSuggestion === key} onClick={() => setActiveSuggestion(key)}><Icon name={key === "title" ? "title" : key === "summary" ? "short_text" : key === "keywords" ? "sell" : "article"} />{suggestions[key].label}{applied.includes(key) && <Icon name="check" />}</button>)}</div>
                  <div className={styles.suggestion}><span className={styles.eyebrow}>SUGGESTED {suggestion.label.toUpperCase()}</span><p className={styles.suggestionText}>{suggestion.value}</p><p>{suggestion.reason}</p><button type="button" className={styles.primary} onClick={applySuggestion}><Icon name="check" />Apply suggestion</button></div>
                  <div className={styles.note}><Icon name="lightbulb" /><p>You stay in control. Review each suggestion before adding it to your solution.</p></div>
                </>}
                {panel === "review" && <>
                  <h3>AI Solution Review</h3>
                  <p>Find missing knowledge and overlapping solutions, then review a proposed fix for each issue.</p>
                  <div className={styles.reviewSummary}><Icon name="rule" /><div><strong>2 opportunities to improve this solution</strong><p>Sample findings across your knowledge base.</p></div></div>
                  <div className={styles.reviewFindings}>
                    {reviewFindings.map(finding => (
                      <section className={styles.reviewCard} key={finding.id} aria-label={finding.title}>
                        <div className={styles.findingHeading}><Icon name={finding.icon} /><h4>{finding.title}</h4></div>
                        <span className={styles.findingBadge}>{finding.badge}</span>
                        <p>{finding.description}</p>
                        <details className={styles.fixDetails}>
                          <summary>{finding.action}<Icon name="expand_more" /></summary>
                          <div className={styles.fixProposal}>
                            <span className={styles.eyebrow}>PROPOSED FIX</span>
                            <h4>{finding.proposal}</h4>
                            <p>{finding.detail}</p>
                            <div className={styles.fixDestination}><Icon name="description" />{finding.destination}</div>
                            <button type="button" className={styles.primary} disabled={reviewPlan.includes(finding.id)} onClick={() => {
                              setReviewPlan(current => [...new Set([...current, finding.id])]);
                              setNotice("Fix added to the demo review plan.");
                            }}><Icon name={reviewPlan.includes(finding.id) ? "check" : "add"} />{reviewPlan.includes(finding.id) ? "Added to review plan" : "Add fix to review plan"}</button>
                          </div>
                        </details>
                      </section>
                    ))}
                  </div>
                  <div className={styles.reviewPlan} role="status"><Icon name="checklist" /><span>{reviewPlan.length} of 2 fixes in your review plan</span></div>
                  <div className={styles.note}><Icon name="info" /><p>Demo findings and proposed fixes. Adding a fix previews the plan; it does not update or merge knowledge articles.</p></div>
                </>}
                {panel === "create" && <>
                  <h3>AI Knowledge Creation</h3><p>Turn this solution into another useful piece of knowledge.</p>
                  <label className={styles.selectLabel} htmlFor="creation-format">What would you like to create?</label>
                  <select id="creation-format" value={format} onChange={event => { setFormat(event.target.value); setGenerated(false); }}><option>FAQ</option><option>Quick reference</option><option>Troubleshooting guide</option></select>
                  <div className={styles.source}><Icon name="description" /><div><small>SOURCE SOLUTION</small><strong>{article.title}</strong></div></div>
                  <button type="button" className={styles.primary} onClick={() => setGenerated(true)}><Icon name="auto_awesome" />Preview {format}</button>
                  {generated && <div className={styles.suggestion} aria-live="polite"><span className={styles.eyebrow}>EXAMPLE {format.toUpperCase()}</span><h3>{format === "FAQ" ? "How do I access work applications remotely?" : format === "Quick reference" ? "VPN connection checklist" : "Unable to connect to the VPN"}</h3><p>{format === "FAQ" ? "Open the corporate VPN client, select your network profile, sign in, and approve the authentication request. Wait for the Connected status before accessing internal applications." : format === "Quick reference" ? "Open VPN client → Select Corporate network → Sign in → Approve authentication → Confirm Connected." : "Check your internet connection, retry the VPN connection, and complete authentication. Contact the IT service desk if the problem continues."}</p><small>Example output for the demo source.</small></div>}
                </>}
              </div>
              <div className={styles.panelFooter}><Icon name="auto_awesome" />Illustrative AI suggestions</div>
            </section>
            <section className={styles.details}><h3>Solution information</h3><dl><div><dt>Collection</dt><dd>IT Support</dd></div><div><dt>Owner</dt><dd>Jamie Davis</dd></div><div><dt>Audience</dt><dd>All employees</dd></div><div><dt>Status</dt><dd><span className={styles.draft}>Draft</span></dd></div></dl></section>
          </aside>
        </div>
      </main>
      {groundPickerOpen && <GroundContextPicker value={groundContext} onCancel={() => setGroundPickerOpen(false)} onSave={value => { changeGroundContext(value); setGroundPickerOpen(false); setNotice(value.referenceIds.length ? "Ground Context references updated for this demo." : "Ground Context references cleared."); }} />}
      {notice && <div className={styles.toast} role="status"><Icon name="check_circle" />{notice}<button type="button" aria-label="Dismiss notification" onClick={() => setNotice("")}><Icon name="close" /></button></div>}
    </div>
  );
}
