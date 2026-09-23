export function ConfigurationManagementShell({ icon, title, description, nextStep }: { icon: string; title: string; description: string; nextStep: string }) {
  return <main style={{ padding: 34, maxWidth: 1120, margin: "0 auto" }}>
    <p style={{ color: "#2574db", fontWeight: 700, fontSize: 12, textTransform: "uppercase" }}>Knowledge Studio configuration</p>
    <h1 style={{ margin: "4px 0 8px" }}><span className="ms" aria-hidden="true" style={{ color: "#2574db", verticalAlign: "-4px", marginRight: 8 }}>{icon}</span>{title}</h1>
    <p style={{ color: "#6b7786", maxWidth: 760 }}>{description}</p>
    <section className="ks-card" style={{ padding: 22, marginTop: 24 }}>
      <h2 style={{ marginTop: 0 }}>Configuration workspace</h2>
      <p style={{ color: "#6b7786", marginBottom: 0 }}>{nextStep}</p>
    </section>
  </main>;
}
