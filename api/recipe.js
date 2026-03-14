/**
 * Vercel serverless: fetch recipe URL, extract ingredients via Gemini.
 * POST body: { url: string }
 * Returns: { items: [{ name, amount, unit, category }] }
 * Keeps GEMINI_API_KEY server-side only.
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DomaciInventar/1.0)' },
    signal: AbortSignal.timeout(10000)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

async function extractIngredientsWithGemini(htmlSnippet) {
  const text = htmlSnippet.slice(0, 50000)
  const prompt = `Z následujícího HTML/textu receptu vyber suroviny a převeď je na nákupní seznam.
Vrať POUZE validní JSON pole objektů bez markdown. Každý objekt: name (název v češtině), amount (číslo, může být desetinné např. 1.5), unit (jedna z: ks, g, kg, ml, l - pokud nelze určit použij "ks"), category (přesně jedna z: Chlazené, Pečivo, Zelenina & Ovoce, Maso, Ostatní).
Příklad: [{"name":"Mléko","amount":0.5,"unit":"l","category":"Chlazené"},{"name":"Cibule","amount":2,"unit":"ks","category":"Zelenina & Ovoce"}]
Pokud žádné suroviny nenajdeš, vrať prázdné pole [].

Text:
${text}`

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || `Gemini HTTP ${res.status}`)
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!raw) return []
  const match = raw.match(/\[[\s\S]*\]/)
  const parsed = match ? JSON.parse(match[0]) : []
  return Array.isArray(parsed) ? parsed : []
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  try {
    const { url } = req.body || {}
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Chybí URL receptu.' })
    }
    let parsed
    try {
      parsed = new URL(url)
    } catch {
      return res.status(400).json({ error: 'Neplatná URL.' })
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).json({ error: 'Povoleny jsou pouze HTTP/HTTPS URL.' })
    }
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Není nastaven GEMINI_API_KEY na serveru.' })
    }
    const html = await fetchPage(url)
    const items = await extractIngredientsWithGemini(html)
    return res.status(200).json({ items })
  } catch (e) {
    const msg = e?.message || 'Neznámá chyba'
    if (msg.includes('fetch') || msg.includes('HTTP') || msg.includes('timeout')) {
      return res.status(502).json({ error: 'Nepodařilo se načíst stránku. Zkontrolujte URL a zkuste to znovu.' })
    }
    return res.status(500).json({ error: `Extrakce receptu selhala: ${msg}` })
  }
}
