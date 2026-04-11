export default async function handler(req, res) {
  try {
    const url = "https://www.myfxbook.com/members/PCSplus/stone-company/11915183";

    const r = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; 4xtrack/1.0; +https://4xtrack.com)"
      }
    });

    if (!r.ok) {
      return res.status(502).json({ ok: false, error: `Upstream status ${r.status}` });
    }

    const html = await r.text();

    function extract(labelPattern) {
      const re = new RegExp(`${labelPattern}[\\s\\S]{0,400}?([-+]?\\d+(?:\\.\\d+)?)\\s*%`, "i");
      const m = html.match(re);
      return m ? Number(m[1]) : null;
    }

    const today = extract("Today");
    const week  = extract("This\\s*Week");
    const month = extract("This\\s*Month");
    const year  = extract("This\\s*Year");

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");

    return res.status(200).json({
      ok: true,
      source: url,
      today,
      week,
      month,
      year,
      fetched_at: new Date().toISOString()
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
