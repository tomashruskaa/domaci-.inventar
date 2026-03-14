/**
 * Vercel serverless: parse receipt image with Gemini, return items with storage classification.
 * POST body: { imageBase64: string, mimeType?: string }
 * Returns: { items: [{ name, amount?, unit?, location: "Lednice"|"Mrazák"|"Spíž" }] }
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY
const LOCATIONS = ['Lednice', 'Mrazák', 'Spíž']

async function parseReceiptWithGemini(imageBase64, mimeType = 'image/jpeg') {
  const prompt = `Analyzuj tento obrázek ÚČTENKY z obchodu. Rozpoznej všechny položky (produkty) na účtence.
Pro každou položku vrať: name (název v češtině), amount (číslo nebo desetinné, pokud je na účtence), unit (jedna z: ks, g, kg, ml, l - jinak "ks"), location.
location musí být přesně jedna z: Lednice, Mrazák, Spíž.
- Lednice = chlazené, rychle se kazící (mléko, maso, sýr, jogurt, zelenina k chlazení, ...)
- Mrazák = mražené (zmrzlina, mražená zelenina, ...)
- Spíž = trvanlivé, nepotřebují chlazení (konzervy, těstoviny, rýže, olej, ...)

Vrať POUZE validní JSON pole objektů bez markdown.
Příklad: [{"name":"Mléko","amount":1,"unit":"l","location":"Lednice"},{"name":"Těstoviny","amount":500,"unit":"g","location":"Spíž"}]`

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mimeType, data: imageBase64 } }
        ]
      }]
    })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || `Gemini HTTP ${res.status}`)
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!raw) return []
  const match = raw.match(/\[[\s\S]*\]/)
  let parsed = match ? JSON.parse(match[0]) : []
  if (!Array.isArray(parsed)) parsed = []
  return parsed.map((it) => ({
    name: it.name || 'Položka',
    amount: typeof it.amount === 'number' ? it.amount : parseFloat(String(it.amount || 1).replace(',', '.')) || 1,
    unit: ['ks', 'g', 'kg', 'ml', 'l'].includes(it.unit) ? it.unit : 'ks',
    location: LOCATIONS.includes(it.location) ? it.location : 'Spíž'
  }))
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  try {
    const { imageBase64, mimeType } = req.body || {}
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return res.status(400).json({ error: 'Chybí obrázek účtenky.' })
    }
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Není nastaven GEMINI_API_KEY na serveru.' })
    }
    const items = await parseReceiptWithGemini(imageBase64, mimeType || 'image/jpeg')
    return res.status(200).json({ items })
  } catch (e) {
    const msg = e?.message || 'Neznámá chyba'
    return res.status(500).json({ error: `Rozpoznání účtenky selhalo: ${msg}` })
  }
}
