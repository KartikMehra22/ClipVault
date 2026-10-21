export default function HomePage() {
  return (
    <main className="container">
      <div className="card">
        <div className="badge">
          <span className="badge-dot" />
          <span>Desktop Shell</span>
        </div>
        <h1 className="title">ClipOrbit</h1>
        <p className="subtitle">Your clipboard workspace is getting ready.</p>
        <div className="status-box">
          <span className="status-indicator" />
          <span className="status-text">Desktop application shell connected.</span>
        </div>
      </div>
    </main>
  );
}
