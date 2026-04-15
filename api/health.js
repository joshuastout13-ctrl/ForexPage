export default function handler(_req, res) {
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ ok: true, ts: new Date().toISOString() }));
}
