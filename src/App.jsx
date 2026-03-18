import { useEffect, useMemo, useRef, useState } from 'react'
import { initializeApp } from 'firebase/app'
import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch
} from 'firebase/firestore'
import { getAuth, onAuthStateChanged, signInAnonymously } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import {
  AlertTriangle,
  Camera,
  ChefHat,
  Check,
  ChevronRight,
  Image,
  Loader2,
  Pencil,
  PieChart,
  Plus,
  Receipt,
  ShoppingBag,
  ShoppingCart,
  Trash2,
  Warehouse,
  X
} from 'lucide-react'

// -----------------------------
// Konfigurace aplikace
// -----------------------------
const APP_ID = 'domaci-inventar-v1'

const CATEGORIES = ['Chlazené', 'Pečivo', 'Ovoce & Zelenina', 'Maso', 'Drogerie', 'Ostatní']
const LOCATIONS = ['Lednice', 'Mrazák', 'Spíž']
const UNITS = ['ks', 'g', 'kg', 'ml', 'l']

const FIREBASE_CONFIG = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
}

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY
const GEMINI_MODEL = 'gemini-2.0-flash'

// -----------------------------
// Firebase init
// -----------------------------
const firebaseApp = initializeApp(FIREBASE_CONFIG)
const db = getFirestore(firebaseApp)
const auth = getAuth(firebaseApp)

// -----------------------------
// Utility
// -----------------------------
function cx(...classes) {
  return classes.filter(Boolean).join(' ')
}

function isValidUnit(u) {
  return UNITS.includes(u)
}

function isValidCategory(c) {
  return CATEGORIES.includes(c)
}

function isValidLocation(l) {
  return LOCATIONS.includes(l)
}

function toDateMaybe(ts) {
  if (!ts) return null
  if (ts instanceof Date) return ts
  if (typeof ts?.toDate === 'function') return ts.toDate()
  return null
}

function daysBetween(a, b) {
  const ms = b.getTime() - a.getTime()
  return Math.ceil(ms / (1000 * 60 * 60 * 24))
}

function formatCzk(value) {
  const n = Number(value) || 0
  return new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK', maximumFractionDigits: 0 }).format(n)
}

function clampNumber(value, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

function sanitizeEmoji(s) {
  if (!s || typeof s !== 'string') return ''
  // Vezmeme první "uživatelsky viditelný znak" (grapheme cluster) jednoduše přes Array.from
  return Array.from(s.trim())[0] || ''
}

function guessEmojiFallback(name, category) {
  const n = (name || '').toLowerCase()
  const c = category || ''
  if (n.includes('mléko')) return '🥛'
  if (n.includes('chléb') || n.includes('rohl')) return '🥖'
  if (n.includes('sýr')) return '🧀'
  if (n.includes('jabl')) return '🍎'
  if (n.includes('ban')) return '🍌'
  if (n.includes('rajč') || n.includes('okurk')) return '🥬'
  if (n.includes('mas')) return '🥩'
  if (n.includes('kuř')) return '🍗'
  if (n.includes('pivo')) return '🍺'
  if (n.includes('víno')) return '🍷'
  if (n.includes('šampon') || n.includes('mýdlo') || n.includes('prášek')) return '🧴'
  if (c === 'Chlazené') return '🧊'
  if (c === 'Pečivo') return '🥐'
  if (c === 'Ovoce & Zelenina') return '🥦'
  if (c === 'Maso') return '🥩'
  if (c === 'Drogerie') return '🧼'
  return '🧺'
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const res = reader.result
      const s = typeof res === 'string' ? res : ''
      const base64 = s.includes(',') ? s.split(',')[1] : s
      if (!base64) reject(new Error('Nepodařilo se načíst obrázek.'))
      else resolve(base64)
    }
    reader.onerror = () => reject(new Error('Nepodařilo se načíst soubor.'))
    reader.readAsDataURL(file)
  })
}

function geminiUrl() {
  return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`
}

function extractJsonArray(text) {
  if (!text || typeof text !== 'string') return []
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) return []
  try {
    const parsed = JSON.parse(match[0])
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function geminiGenerate({ prompt, imageBase64, mimeType }) {
  if (!GEMINI_API_KEY) {
    throw new Error('Chybí VITE_GEMINI_API_KEY (API klíč pro Gemini).')
  }

  const parts = [{ text: prompt }]
  if (imageBase64) {
    parts.push({ inline_data: { mime_type: mimeType || 'image/jpeg', data: imageBase64 } })
  }

  const payload = {
    contents: [{ parts }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 1024
    }
  }

  const res = await fetch(geminiUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`
    throw new Error(msg)
  }

  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p?.text).filter(Boolean).join('\n') || ''
  if (!text) throw new Error('Prázdná odpověď od AI.')
  return text
}

async function geminiEmojiForItem({ name, category }) {
  const fallback = guessEmojiFallback(name, category)
  try {
    const prompt = `Vyber JEDNO emoji pro položku domácího inventáře.
Vrať pouze emoji znak, bez dalších slov.
Položka: ${name || 'Položka'}
Kategorie: ${category || 'Ostatní'}`
    const text = await geminiGenerate({ prompt })
    const emoji = sanitizeEmoji(text)
    return emoji || fallback
  } catch {
    return fallback
  }
}

async function geminiAnalyzeImageToItems({ imageBase64, mimeType, mode }) {
  const modeText = mode === 'receipt'
    ? 'Jde o fotku účtenky. Zaměř se na názvy produktů. Ceny mohou pomoci s rozpoznáním řádků, ale do výsledku je NEVYPISUJ.'
    : 'Jde o fotku lednice / zásob. Odhadni množství (ks/gramy/ml) podle toho, co vidíš.'

  const prompt = `Jsi asistent pro "Domácí Inventář".
${modeText}

Vrať POUZE validní JSON pole bez markdown a bez dalšího textu.
Formát je přesně:
[
  {"name": "...", "amount": 1, "unit": "ks", "category": "Ostatní", "emoji": "🍎", "expiryEstimateDays": 7}
]

Pravidla:
- name: česky, krátce (např. "Mléko", "Chléb", "Kuřecí prsa")
- amount: číslo (odhad)
- unit: jedna z ${UNITS.join(', ')}
- category: jedna z ${CATEGORIES.join(', ')}
- emoji: jedno emoji (nejvýstižnější)
- expiryEstimateDays: celé číslo 0 až 60 (odhad do spotřeby)

Pokud si nejsi jistý, použij category "Ostatní", unit "ks" a amount 1.`

  const text = await geminiGenerate({ prompt, imageBase64, mimeType })
  const arr = extractJsonArray(text)
  return arr
    .map((x) => ({
      name: (x?.name || '').toString().trim(),
      amount: clampNumber(x?.amount ?? 1, 0, 9999),
      unit: isValidUnit(x?.unit) ? x.unit : 'ks',
      category: isValidCategory(x?.category) ? x.category : 'Ostatní',
      emoji: sanitizeEmoji(x?.emoji) || '',
      expiryEstimateDays: Math.round(clampNumber(x?.expiryEstimateDays ?? 0, 0, 60))
    }))
    .filter((x) => x.name)
}

async function geminiSuggestRecipes({ items }) {
  const names = items.map((i) => i.name).filter(Boolean).slice(0, 60)
  const prompt = `Navrhni 3 jednoduché recepty na základě těchto surovin doma (v češtině).
Suroviny: ${names.join(', ') || 'žádné'}

Vrať POUZE validní JSON pole bez markdown a bez dalšího textu:
[
  {
    "title": "Název receptu",
    "why": "Proč se hodí k surovinám",
    "ingredientsUsed": ["...","..."],
    "steps": ["...","...","..."]
  }
]`
  const text = await geminiGenerate({ prompt })
  const arr = extractJsonArray(text)
  return arr
    .map((r) => ({
      title: (r?.title || '').toString().trim(),
      why: (r?.why || '').toString().trim(),
      ingredientsUsed: Array.isArray(r?.ingredientsUsed) ? r.ingredientsUsed.map(String).slice(0, 12) : [],
      steps: Array.isArray(r?.steps) ? r.steps.map(String).slice(0, 8) : []
    }))
    .filter((r) => r.title)
    .slice(0, 3)
}

// -----------------------------
// UI primitives
// -----------------------------
function Card({ className, children }) {
  return (
    <div className={cx('rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur p-4 shadow-sm', className)}>
      {children}
    </div>
  )
}

function Button({ className, variant = 'primary', size = 'md', ...props }) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-2xl font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
  const sizes = {
    sm: 'px-3 py-2 text-sm',
    md: 'px-4 py-3 text-sm',
    lg: 'px-5 py-3.5 text-base'
  }
  const variants = {
    primary: 'bg-blue-600 text-white hover:bg-blue-500',
    secondary: 'bg-slate-800 text-slate-100 hover:bg-slate-700',
    ghost: 'bg-transparent text-slate-100 hover:bg-slate-800/60',
    danger: 'bg-red-600 text-white hover:bg-red-500'
  }
  return <button className={cx(base, sizes[size], variants[variant], className)} {...props} />
}

function Input({ className, ...props }) {
  return (
    <input
      className={cx(
        'w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500',
        className
      )}
      {...props}
    />
  )
}

function Select({ className, children, ...props }) {
  return (
    <select
      className={cx(
        'w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500',
        className
      )}
      {...props}
    >
      {children}
    </select>
  )
}

function Modal({ title, onClose, children, footer }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 p-4 flex items-end sm:items-center justify-center">
      <div className="w-full max-w-xl rounded-3xl border border-slate-800 bg-slate-950 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="text-slate-100 font-semibold">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-100 hover:bg-slate-800/60"
            aria-label="Zavřít"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-5 py-4 max-h-[70vh] overflow-y-auto">
          {children}
        </div>
        {footer ? (
          <div className="px-5 py-4 border-t border-slate-800 bg-slate-950/60">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  )
}

// -----------------------------
// App
// -----------------------------
export default function App() {
  const [user, setUser] = useState(null)
  const [tab, setTab] = useState('shopping') // shopping | home | overview

  const [items, setItems] = useState([])
  const [itemsLoading, setItemsLoading] = useState(true)

  const [expenses, setExpenses] = useState([])
  const [expensesLoading, setExpensesLoading] = useState(true)

  // AI flow
  const [aiOpen, setAiOpen] = useState(false)
  const [aiStatus, setAiStatus] = useState('Nahrávám fotku…')
  const [aiProgress, setAiProgress] = useState(10)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewLocation, setReviewLocation] = useState('Lednice')
  const [reviewItems, setReviewItems] = useState([])

  const [moveBoughtOpen, setMoveBoughtOpen] = useState(false)
  const [moveBoughtLocation, setMoveBoughtLocation] = useState('Spíž')

  const [recipesOpen, setRecipesOpen] = useState(false)
  const [recipesLoading, setRecipesLoading] = useState(false)
  const [recipes, setRecipes] = useState([])

  const [editOpen, setEditOpen] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [editName, setEditName] = useState('')
  const [editAmount, setEditAmount] = useState(0)
  const [editUnit, setEditUnit] = useState('ks')

  const inputReceiptRef = useRef(null)
  const inputFridgeRef = useRef(null)
  const inputGalleryRef = useRef(null)

  // Default dark mode
  useEffect(() => {
    document.documentElement.classList.add('dark')
  }, [])

  // Auth
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (u) setUser(u)
      else {
        try {
          await signInAnonymously(auth)
        } catch (e) {
          console.error(e)
          alert('Nepodařilo se přihlásit. Zkuste to prosím znovu.')
        }
      }
    })
    return () => unsub()
  }, [])

  // Items subscription - sdílená kolekce (bez filtru podle uživatele / appId)
  useEffect(() => {
    if (!user) return
    setItemsLoading(true)
    const q = query(
      collection(db, 'items'),
      orderBy('createdAt', 'desc')
    )
    const unsub = onSnapshot(
      q,
      (snap) => {
        setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
        setItemsLoading(false)
      },
      (e) => {
        console.error(e)
        setItemsLoading(false)
      }
    )
    return () => unsub()
  }, [user])

  // Expenses subscription (pro Přehled + ruční výdaje) – také sdílené
  useEffect(() => {
    if (!user) return
    setExpensesLoading(true)
    const q = query(
      collection(db, 'expenses'),
      orderBy('createdAt', 'desc')
    )
    const unsub = onSnapshot(
      q,
      (snap) => {
        setExpenses(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
        setExpensesLoading(false)
      },
      (e) => {
        console.error(e)
        setExpensesLoading(false)
      }
    )
    return () => unsub()
  }, [user])

  const shoppingItems = useMemo(
    () => items.filter((i) => i.status === 'shopping'),
    [items]
  )
  const homeItems = useMemo(
    () => items.filter((i) => i.status === 'home'),
    [items]
  )

  const shoppingByCategory = useMemo(() => {
    const notBought = shoppingItems.filter((i) => !i.isBought)
    return CATEGORIES.map((cat) => ({
      category: cat,
      items: notBought.filter((i) => (i.category || 'Ostatní') === cat)
    }))
  }, [shoppingItems])

  const boughtItems = useMemo(
    () => shoppingItems.filter((i) => !!i.isBought),
    [shoppingItems]
  )

  const homeByLocation = useMemo(() => {
    const map = new Map()
    for (const loc of LOCATIONS) map.set(loc, [])
    for (const it of homeItems) {
      const loc = isValidLocation(it.location) ? it.location : 'Spíž'
      map.get(loc).push(it)
    }
    for (const loc of LOCATIONS) {
      map.get(loc).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'cs'))
    }
    return map
  }, [homeItems])

  // -----------------------------
  // Firestore operations
  // -----------------------------
  async function addItem({ status, name, amount, unit, category, location, isBought, emoji, expiryDate }) {
    if (!user) return
    const safeCategory = isValidCategory(category) ? category : 'Ostatní'
    const safeUnit = isValidUnit(unit) ? unit : 'ks'
    const safeLocation = isValidLocation(location) ? location : 'Spíž'
    const safeEmoji = emoji || await geminiEmojiForItem({ name, category: safeCategory })

    return addDoc(collection(db, 'items'), {
      name: (name || 'Položka').toString().trim(),
      amount: clampNumber(amount ?? 1, 0, 9999),
      unit: safeUnit,
      category: safeCategory,
      status: status === 'home' ? 'home' : 'shopping',
      location: safeLocation,
      isBought: !!isBought,
      emoji: safeEmoji,
      expiryDate: expiryDate || null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    })
  }

  async function updateItem(id, updates) {
    await updateDoc(doc(db, 'items', id), { ...updates, updatedAt: serverTimestamp() })
  }

  async function deleteItem(id) {
    await deleteDoc(doc(db, 'items', id))
  }

  function startEdit(item) {
    if (!item) return
    setEditTarget(item)
    setEditName(item.name || '')
    setEditAmount(item.amount ?? 0)
    setEditUnit(isValidUnit(item.unit) ? item.unit : 'ks')
    setEditExpiry(item.expiryDate || '')
    setEditOpen(true)
  }

  const [editExpiry, setEditExpiry] = useState('');

  async function saveEdit() {
    if (!editTarget) return
    try {
      const name = editName.trim() || editTarget.name || 'Položka'
      const amount = clampNumber(editAmount ?? 0, 0, 9999)
      const unit = isValidUnit(editUnit) ? editUnit : 'ks'
      
      // Přidáme hodnotu ze state editExpiry
      const expiryDate = editExpiry || null 
  
      // Do updateItem pošleme i expiryDate
      await updateItem(editTarget.id, { 
        name, 
        amount, 
        unit, 
        expiryDate 
      })
  
      setEditOpen(false)
      setEditTarget(null)
    } catch (e) {
      console.error(e)
      alert('Nepodařilo se uložit změny položky.')
    }
  }

  // -----------------------------
  // Shopping actions
  // -----------------------------
  async function toggleBought(id, nextValue) {
    try {
      await updateItem(id, { isBought: !!nextValue })
    } catch (e) {
      console.error(e)
      alert('Nepodařilo se aktualizovat položku.')
    }
  }

  async function moveAllBoughtToHome(location) {
    if (!user) return
    const loc = isValidLocation(location) ? location : 'Spíž'
    try {
      const batch = writeBatch(db)
      for (const it of boughtItems) {
        batch.update(doc(db, 'items', it.id), {
          status: 'home',
          location: loc,
          isBought: false,
          updatedAt: serverTimestamp()
        })
      }
      await batch.commit()
      setMoveBoughtOpen(false)
    } catch (e) {
      console.error(e)
      alert('Nepodařilo se přesunout koupené položky.')
    }
  }

  // -----------------------------
  // AI: image flow + review
  // -----------------------------
  async function handleAnalyzeFile(file, mode) {
    if (!file) return
    const mimeType = file.type === 'image/png' ? 'image/png' : 'image/jpeg'

    setAiOpen(true)
    setAiStatus('Nahrávám fotku…')
    setAiProgress(12)
    try {
      const base64 = await fileToBase64(file)
      setAiProgress(30)
      setAiStatus('AI analyzuje…')
      setAiProgress(50)
      const list = await geminiAnalyzeImageToItems({ imageBase64: base64, mimeType, mode })
      const enriched = await Promise.all(list.map(async (x) => {
        const emoji = x.emoji || await geminiEmojiForItem({ name: x.name, category: x.category })
        return { ...x, emoji }
      }))
      setAiProgress(92)
      setAiStatus('Hotovo!')
      setReviewItems(enriched.length ? enriched : [{
        name: 'Neznámá položka',
        amount: 1,
        unit: 'ks',
        category: 'Ostatní',
        emoji: '🧺',
        expiryEstimateDays: 0
      }])
      setReviewOpen(true)
    } catch (e) {
      const msg = e?.message || 'Neznámá chyba'
      console.error(e)
      const isQuota = msg.includes('quota') || msg.includes('429') || msg.toLowerCase().includes('too many')
      alert(isQuota ? 'AI je teď přetížená nebo je vyčerpaná kvóta. Zkuste to za chvíli.' : `Analýza fotky selhala: ${msg}`)
    } finally {
      setAiProgress(100)
      // Necháme "Hotovo!" krátce viditelné, ale UI ovládá modal
      setTimeout(() => setAiOpen(false), 400)
      if (inputReceiptRef.current) inputReceiptRef.current.value = ''
      if (inputFridgeRef.current) inputFridgeRef.current.value = ''
      if (inputGalleryRef.current) inputGalleryRef.current.value = ''
    }
  }

  async function saveReviewedToHome() {
    if (!user) return
    const loc = isValidLocation(reviewLocation) ? reviewLocation : 'Lednice'
    try {
      for (const it of reviewItems) {
        const expiryDays = clampNumber(it.expiryEstimateDays ?? 0, 0, 60)
        const expiryDate = expiryDays
          ? Timestamp.fromDate(new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000))
          : null
        await addItem({
          status: 'home',
          name: it.name,
          amount: it.amount,
          unit: it.unit,
          category: it.category,
          location: loc,
          isBought: false,
          emoji: it.emoji,
          expiryDate
        })
      }
      setReviewOpen(false)
      setReviewItems([])
    } catch (e) {
      console.error(e)
      alert('Nepodařilo se uložit položky.')
    }
  }

  // -----------------------------
  // AI: recipes
  // -----------------------------
  async function handleSuggestRecipes() {
    setRecipesOpen(true)
    setRecipesLoading(true)
    setRecipes([])
    try {
      const list = await geminiSuggestRecipes({ items: homeItems })
      setRecipes(list)
    } catch (e) {
      console.error(e)
      setRecipes([])
    } finally {
      setRecipesLoading(false)
    }
  }

  // -----------------------------
  // UI loading state
  // -----------------------------
  const bootLoading = !user || itemsLoading || expensesLoading

  if (bootLoading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="flex items-center gap-3 text-slate-300">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Načítání…</span>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-5xl mx-auto px-4 pt-5 pb-24 md:pb-8">
        <Header
          tab={tab}
          onTabChange={setTab}
          onAddReceipt={() => inputReceiptRef.current?.click()}
          onAddFridge={() => inputFridgeRef.current?.click()}
          onAddGallery={() => inputGalleryRef.current?.click()}
        />

        {/* Hidden inputs (kamera / galerie) */}
        <input
          ref={inputReceiptRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => handleAnalyzeFile(e.target.files?.[0], 'receipt')}
        />
        <input
          ref={inputFridgeRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => handleAnalyzeFile(e.target.files?.[0], 'fridge')}
        />
        <input
          ref={inputGalleryRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handleAnalyzeFile(e.target.files?.[0], 'fridge')}
        />

        {tab === 'shopping' ? (
          <ShoppingTab
            categories={CATEGORIES}
            shoppingByCategory={shoppingByCategory}
            boughtItems={boughtItems}
            onAdd={async ({ name, amount, unit, category }) => {
              try {
                await addItem({
                  status: 'shopping',
                  name,
                  amount,
                  unit,
                  category,
                  location: 'Spíž',
                  isBought: false,
                  emoji: ''
                })
              } catch (e) {
                console.error(e)
                alert('Nepodařilo se přidat položku.')
              }
            }}
            onToggleBought={toggleBought}
            onDelete={(id) => deleteItem(id).catch(() => alert('Nepodařilo se smazat položku.'))}
            onMoveBought={() => setMoveBoughtOpen(true)}
            onEdit={startEdit}
          />
        ) : null}

        {tab === 'home' ? (
          <InventoryTab
            locations={LOCATIONS}
            homeByLocation={homeByLocation}
            onAddToCart={(item) => updateItem(item.id, { status: 'shopping', isBought: false }).catch(() => alert('Nepodařilo se přidat do nákupního seznamu.'))}
            onDelete={(id) => deleteItem(id).catch(() => alert('Nepodařilo se smazat položku.'))}
            onSuggestRecipes={handleSuggestRecipes}
            onEdit={startEdit}
          />
        ) : null}

        {tab === 'overview' ? (
          <OverviewTab
            expenses={expenses}
            onAddExpense={async ({ label, amountCzk }) => {
              const name = (label || '').toString().trim()
              const amount = clampNumber(amountCzk, 0, 1_000_000)
              if (!name || !amount) return
              try {
                await addDoc(collection(db, 'expenses'), {
                  label: name,
                  amountCzk: amount,
                  createdAt: serverTimestamp()
                })
              } catch (e) {
                console.error(e)
                alert('Nepodařilo se uložit výdaj.')
              }
            }}
          />
        ) : null}
      </div>

      {/* Mobilní tab bar */}
      <TabBar tab={tab} onTabChange={setTab} />

      {/* AI loading overlay */}
      {aiOpen ? (
        <AiOverlay status={aiStatus} progress={aiProgress} />
      ) : null}

      {/* Move bought modal */}
      {moveBoughtOpen ? (
        <Modal
          title="Přesunout koupené domů"
          onClose={() => setMoveBoughtOpen(false)}
          footer={(
            <div className="flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={() => setMoveBoughtOpen(false)}>
                Zrušit
              </Button>
              <Button className="flex-1" onClick={() => moveAllBoughtToHome(moveBoughtLocation)}>
                Přesunout
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        >
          <div className="space-y-3">
            <div className="text-sm text-slate-300">
              Vyber lokaci, kam se mají koupené položky uložit.
            </div>
            <Select value={moveBoughtLocation} onChange={(e) => setMoveBoughtLocation(e.target.value)}>
              {LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
            </Select>
            <div className="text-xs text-slate-500">
              Položky se přesunou z „Koupeno“ do inventáře a zruší se u nich stav „koupeno“.
            </div>
          </div>
        </Modal>
      ) : null}

      {/* Review modal */}
      {reviewOpen ? (
        <Modal
          title="Zkontrolujte položky"
          onClose={() => {
            setReviewOpen(false)
            setReviewItems([])
          }}
          footer={(
            <div className="flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={() => {
                setReviewOpen(false)
                setReviewItems([])
              }}>
                Zrušit
              </Button>
              <Button className="flex-1" onClick={saveReviewedToHome}>
                Uložit do inventáře
                <Check className="w-4 h-4" />
              </Button>
            </div>
          )}
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-sm text-slate-300">Uložit do lokace</div>
              <Select value={reviewLocation} onChange={(e) => setReviewLocation(e.target.value)}>
                {LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
              </Select>
            </div>

            <div className="space-y-3">
              {reviewItems.map((it, idx) => (
                <Card key={idx} className="p-3">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-100">
                      <span aria-hidden="true" className="text-lg leading-none">{it.emoji || '🧺'}</span>
                      <span>Položka {idx + 1}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setReviewItems(reviewItems.filter((_, i) => i !== idx))}
                      className="p-2 rounded-xl text-slate-400 hover:text-slate-100 hover:bg-slate-800/60"
                      title="Smazat"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2">
                      <div className="text-xs text-slate-500 mb-1">Název</div>
                      <Input
                        value={it.name}
                        onChange={(e) => {
                          const next = [...reviewItems]
                          next[idx] = { ...next[idx], name: e.target.value }
                          setReviewItems(next)
                        }}
                        placeholder="Název položky"
                      />
                    </div>

                    <div>
                      <div className="text-xs text-slate-500 mb-1">Množství</div>
                      <Input
                        type="number"
                        min="0"
                        value={it.amount}
                        onChange={(e) => {
                          const next = [...reviewItems]
                          next[idx] = { ...next[idx], amount: Number(e.target.value) || 0 }
                          setReviewItems(next)
                        }}
                      />
                    </div>
                    <div>
                      <div className="text-xs text-slate-500 mb-1">Jednotka</div>
                      <Select
                        value={it.unit}
                        onChange={(e) => {
                          const next = [...reviewItems]
                          next[idx] = { ...next[idx], unit: e.target.value }
                          setReviewItems(next)
                        }}
                      >
                        {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                      </Select>
                    </div>

                    <div className="sm:col-span-2">
                      <div className="text-xs text-slate-500 mb-1">Kategorie</div>
                      <Select
                        value={it.category}
                        onChange={(e) => {
                          const next = [...reviewItems]
                          next[idx] = { ...next[idx], category: e.target.value }
                          setReviewItems(next)
                        }}
                      >
                        {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </Select>
                    </div>

                    <div>
                      <div className="text-xs text-slate-500 mb-1">Emoji</div>
                      <Input
                        value={it.emoji}
                        onChange={(e) => {
                          const next = [...reviewItems]
                          next[idx] = { ...next[idx], emoji: sanitizeEmoji(e.target.value) }
                          setReviewItems(next)
                        }}
                        placeholder="🍎"
                      />
                    </div>
                    <div>
                      <div className="text-xs text-slate-500 mb-1">Spotřebovat za (dní)</div>
                      <Input
                        type="number"
                        min="0"
                        max="60"
                        value={it.expiryEstimateDays}
                        onChange={(e) => {
                          const next = [...reviewItems]
                          next[idx] = { ...next[idx], expiryEstimateDays: Number(e.target.value) || 0 }
                          setReviewItems(next)
                        }}
                      />
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            {reviewItems.length === 0 ? (
              <div className="text-center text-slate-400 py-8">
                Žádné položky k uložení.
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}

     {/* Edit modal */}
{editOpen ? (
  <Modal
    title="Upravit položku"
    onClose={() => {
      setEditOpen(false)
      setEditTarget(null)
    }}
    footer={(
      <div className="flex gap-3">
        <Button
          variant="secondary"
          className="flex-1"
          onClick={() => {
            setEditOpen(false)
            setEditTarget(null)
          }}
        >
          Zrušit
        </Button>
        <Button className="flex-1" onClick={saveEdit}>
          Uložit změny
        </Button>
      </div>
    )}
  >
    <div className="space-y-3">
      <div>
        <div className="text-xs text-slate-500 mb-1">Název</div>
        <Input
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          placeholder="Název položky"
        />
      </div>
      
      {/* --- PŘIDÁNO: DATUM EXPIRACE --- */}
      <div>
        <div className="text-xs text-slate-500 mb-1">Datum expirace</div>
        <Input
          type="date"
          value={editExpiry}
          onChange={(e) => setEditExpiry(e.target.value)}
        />
      </div>
      {/* ------------------------------- */}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-xs text-slate-500 mb-1">Množství</div>
          <Input
            type="number"
            min="0"
            value={editAmount}
            onChange={(e) => setEditAmount(Number(e.target.value) || 0)}
          />
        </div>
        <div>
          <div className="text-xs text-slate-500 mb-1">Jednotka</div>
          <Select
            value={editUnit}
            onChange={(e) => setEditUnit(e.target.value)}
          >
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </Select>
        </div>
      </div>
    </div>
  </Modal>
) : null}

      {/* Recepty */}
      {recipesOpen ? (
        <Modal
          title="Co dnes uvařit?"
          onClose={() => setRecipesOpen(false)}
          footer={(
            <div className="flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={() => setRecipesOpen(false)}>
                Zavřít
              </Button>
              <Button className="flex-1" onClick={handleSuggestRecipes} disabled={recipesLoading}>
                <ChefHat className="w-4 h-4" />
                Zkusit znovu
              </Button>
            </div>
          )}
        >
          {recipesLoading ? (
            <div className="flex items-center gap-3 text-slate-300">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>AI vymýšlí recepty…</span>
            </div>
          ) : recipes.length ? (
            <div className="space-y-3">
              {recipes.map((r, idx) => (
                <Card key={idx}>
                  <div className="font-semibold text-slate-100">{r.title}</div>
                  {r.why ? <div className="text-sm text-slate-300 mt-1">{r.why}</div> : null}
                  {r.ingredientsUsed?.length ? (
                    <div className="mt-3 text-sm">
                      <div className="text-slate-400 mb-1">Využité suroviny</div>
                      <div className="flex flex-wrap gap-2">
                        {r.ingredientsUsed.map((x, i) => (
                          <span key={i} className="px-2 py-1 rounded-xl bg-slate-800 text-slate-200 text-xs">
                            {x}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {r.steps?.length ? (
                    <ol className="mt-3 space-y-1 text-sm text-slate-200 list-decimal list-inside">
                      {r.steps.map((s, i) => <li key={i}>{s}</li>)}
                    </ol>
                  ) : null}
                </Card>
              ))}
            </div>
          ) : (
            <div className="text-slate-400">
              Nepodařilo se získat návrhy receptů. Zkuste to prosím znovu.
            </div>
          )}
        </Modal>
      ) : null}
    </div>
  )
}

function Header({ tab, onTabChange, onAddReceipt, onAddFridge, onAddGallery }) {
  return (
    <div className="mb-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs text-slate-400">Domácí Inventář</div>
          <div className="text-xl font-bold text-slate-100">
            {tab === 'shopping' ? '🛒 Nákupní seznam' : null}
            {tab === 'home' ? '🏠 Co mám doma' : null}
            {tab === 'overview' ? '📊 Přehled' : null}
          </div>
        </div>

        {tab === 'home' ? (
          <div className="hidden sm:flex items-center gap-2">
            <Button variant="secondary" onClick={onAddReceipt} className="rounded-2xl">
              <Receipt className="w-4 h-4" />
              Účtenka
            </Button>
            <Button variant="secondary" onClick={onAddFridge} className="rounded-2xl">
              <Camera className="w-4 h-4" />
              Lednice
            </Button>
            <Button variant="secondary" onClick={onAddGallery} className="rounded-2xl">
              <Image className="w-4 h-4" />
              Galerie
            </Button>
          </div>
        ) : null}
      </div>

      {/* Desktop tab switch (pro velké obrazovky) */}
      <div className="hidden md:flex items-center gap-2 mt-4">
        <Segment value={tab} onChange={onTabChange} />
      </div>

      {/* Mobilní "Přidat zásoby" */}
      {tab === 'home' ? (
        <div className="sm:hidden mt-4">
          <Card className="p-3">
            <div className="text-sm font-medium text-slate-100 mb-2">Přidat zásoby</div>
            <div className="grid grid-cols-1 gap-2">
              <Button variant="secondary" onClick={onAddReceipt} className="justify-between">
                <span className="flex items-center gap-2">
                  <Receipt className="w-4 h-4" />
                  Vyfotit účtenku
                </span>
                <ChevronRight className="w-4 h-4" />
              </Button>
              <Button variant="secondary" onClick={onAddFridge} className="justify-between">
                <span className="flex items-center gap-2">
                  <Camera className="w-4 h-4" />
                  Vyfotit lednici
                </span>
                <ChevronRight className="w-4 h-4" />
              </Button>
              <Button variant="secondary" onClick={onAddGallery} className="justify-between">
                <span className="flex items-center gap-2">
                  <Image className="w-4 h-4" />
                  Nahrát z galerie
                </span>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  )
}

function Segment({ value, onChange }) {
  const opts = [
    { id: 'shopping', label: '🛒 Nákupní seznam' },
    { id: 'home', label: '🏠 Inventář' },
    { id: 'overview', label: '📊 Přehled' }
  ]
  return (
    <div className="inline-flex rounded-2xl border border-slate-800 bg-slate-900/60 p-1">
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={cx(
            'px-4 py-2 rounded-xl text-sm font-medium transition-colors',
            value === o.id ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-100'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function TabBar({ tab, onTabChange }) {
  const tabs = [
    { id: 'shopping', label: 'Seznam', Icon: ShoppingBag, emoji: '🛒' },
    { id: 'home', label: 'Doma2', Icon: Warehouse, emoji: '🏠' },
    { id: 'overview', label: 'Přehled', Icon: PieChart, emoji: '📊' }
  ]
  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-slate-800 bg-slate-950/95 backdrop-blur">
      <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-around">
        {tabs.map(({ id, label, Icon, emoji }) => (
          <button
            key={id}
            type="button"
            onClick={() => onTabChange(id)}
            className={cx(
              'flex flex-col items-center justify-center gap-0.5 px-3 py-2 rounded-2xl transition-colors',
              tab === id ? 'bg-slate-800/60 text-slate-100' : 'text-slate-400 hover:text-slate-100'
            )}
          >
            <div className="flex items-center gap-1">
              <span aria-hidden="true" className="text-sm">{emoji}</span>
              <Icon className="w-5 h-5" />
            </div>
            <span className="text-[11px] font-medium">{label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function AiOverlay({ status, progress }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-3xl border border-slate-800 bg-slate-950 p-5 shadow-2xl">
        <div className="flex items-center gap-3 text-slate-200">
          <Loader2 className="w-5 h-5 animate-spin" />
          <div className="font-medium">{status}</div>
        </div>
        <div className="mt-4 h-2 rounded-full bg-slate-800 overflow-hidden">
          <div className="h-full bg-blue-600" style={{ width: `${clampNumber(progress, 0, 100)}%` }} />
        </div>
        <div className="mt-2 text-xs text-slate-500">
          Tip: u lednice zkuste fotit z větší dálky, aby byly vidět celé police.
        </div>
      </div>
    </div>
  )
}

function ShoppingTab({ categories, shoppingByCategory, boughtItems, onAdd, onToggleBought, onDelete, onMoveBought, onEdit }) {
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [amount, setAmount] = useState(1)
  const [unit, setUnit] = useState('ks')
  const [category, setCategory] = useState('Ostatní')

  const empty = shoppingByCategory.every((x) => x.items.length === 0) && boughtItems.length === 0

  return (
    <div className="space-y-5">
      <Card>
        {!showForm ? (
          <Button className="w-full" onClick={() => setShowForm(true)}>
            <Plus className="w-5 h-5" />
            Přidat položku
          </Button>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const n = name.trim()
              if (!n) return
              onAdd({ name: n, amount, unit, category })
              setName('')
              setAmount(1)
              setUnit('ks')
              setCategory('Ostatní')
              setShowForm(false)
            }}
            className="space-y-3"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <div className="text-xs text-slate-500 mb-1">Název</div>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Např. Mléko" autoFocus />
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Množství</div>
                <Input type="number" min="0" value={amount} onChange={(e) => setAmount(Number(e.target.value) || 0)} />
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Jednotka</div>
                <Select value={unit} onChange={(e) => setUnit(e.target.value)}>
                  {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </Select>
              </div>
              <div className="sm:col-span-2">
                <div className="text-xs text-slate-500 mb-1">Kategorie</div>
                <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </div>
            </div>

            <div className="flex gap-2">
              <Button type="button" variant="secondary" className="flex-1" onClick={() => setShowForm(false)}>
                Zrušit
              </Button>
              <Button type="submit" className="flex-1">
                Přidat
              </Button>
            </div>
          </form>
        )}
      </Card>

      {shoppingByCategory.map(({ category: cat, items }) => (
        items.length ? (
          <Card key={cat}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold text-slate-100">{cat}</div>
              <div className="text-xs text-slate-500">{items.length}×</div>
            </div>
            <ul className="space-y-2">
              {items.map((it) => (
                <li key={it.id} className="flex items-center gap-3 py-2 border-b border-slate-800 last:border-0">
                  <input
                    type="checkbox"
                    checked={false}
                    onChange={() => onToggleBought(it.id, true)}
                    className="w-5 h-5 accent-blue-600"
                    aria-label="Označit jako koupené"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span aria-hidden="true" className="text-lg leading-none shrink-0">{it.emoji || guessEmojiFallback(it.name, it.category)}</span>
                      <span className="font-medium text-slate-100 truncate">{it.name}</span>
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {it.amount} {it.unit}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onEdit?.(it)}
                    className="p-2 rounded-xl text-slate-400 hover:text-slate-100 hover:bg-slate-800/60"
                    title="Upravit"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(it.id)}
                    className="p-2 rounded-xl text-slate-400 hover:text-red-300 hover:bg-red-500/10"
                    title="Smazat"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        ) : null
      ))}

      {boughtItems.length ? (
        <Card className="border-slate-700 bg-slate-900/40">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="text-sm font-semibold text-slate-100">Koupeno</div>
            <Button variant="secondary" size="sm" onClick={onMoveBought}>
              Přesunout domů
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
          <ul className="space-y-2">
            {boughtItems.map((it) => (
              <li key={it.id} className="flex items-center gap-3 py-2 border-b border-slate-800 last:border-0 opacity-90">
                <input
                  type="checkbox"
                  checked
                  onChange={() => onToggleBought(it.id, false)}
                  className="w-5 h-5 accent-blue-600"
                  aria-label="Zrušit koupeno"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span aria-hidden="true" className="text-lg leading-none shrink-0">{it.emoji || guessEmojiFallback(it.name, it.category)}</span>
                    <span className="font-medium text-slate-300 line-through truncate">{it.name}</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {it.amount} {it.unit}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onEdit?.(it)}
                  className="p-2 rounded-xl text-slate-500 hover:text-slate-100 hover:bg-slate-800/60"
                  title="Upravit"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(it.id)}
                  className="p-2 rounded-xl text-slate-500 hover:text-red-300 hover:bg-red-500/10"
                  title="Smazat"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {empty ? (
        <div className="text-center text-slate-400 py-10">
          🛒 Nákupní seznam je prázdný.
        </div>
      ) : null}
    </div>
  )
}

function InventoryTab({ locations, homeByLocation, onAddToCart, onDelete, onSuggestRecipes, onEdit }) {
  const [loc, setLoc] = useState('Lednice')
  const list = homeByLocation.get(loc) || []

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-2 overflow-x-auto">
          {locations.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLoc(l)}
              className={cx(
                'px-4 py-2 rounded-2xl text-sm font-medium whitespace-nowrap border transition-colors',
                loc === l
                  ? 'bg-blue-600 text-white border-blue-500'
                  : 'bg-slate-900/40 text-slate-200 border-slate-800 hover:bg-slate-800/60'
              )}
            >
              {l}
            </button>
          ))}
        </div>

        <Button variant="secondary" onClick={onSuggestRecipes}>
          <ChefHat className="w-4 h-4" />
          Co dnes uvařit?
        </Button>
      </div>

      <Card>
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-slate-100">{loc}</div>
          <div className="text-xs text-slate-500">{list.length}×</div>
        </div>

        {list.length ? (
          <ul className="space-y-2">
            {list.map((it) => (
              <InventoryRow key={it.id} item={it} onAddToCart={onAddToCart} onDelete={onDelete} onEdit={onEdit} />
            ))}
          </ul>
        ) : (
          <div className="text-slate-400 py-6 text-center">
            Žádné položky.
          </div>
        )}
      </Card>
    </div>
  )
}

function InventoryRow({ item, onAddToCart, onDelete, onEdit }) {
  const expiry = toDateMaybe(item.expiryDate)
  const now = new Date()
  const daysLeft = expiry ? daysBetween(now, expiry) : null
  const nearExpiry = typeof daysLeft === 'number' && daysLeft >= 0 && daysLeft <= 2

  return (
    <li className="flex items-center gap-3 py-2 border-b border-slate-800 last:border-0">
      <span aria-hidden="true" className="text-lg leading-none shrink-0">
        {item.emoji || guessEmojiFallback(item.name, item.category)}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium text-slate-100 truncate">{item.name}</span>
          {nearExpiry ? (
            <span className="inline-flex items-center gap-1 text-xs text-amber-300 shrink-0" title="Brzy expiruje">
              <AlertTriangle className="w-4 h-4" />
              ⚠️
            </span>
          ) : null}
        </div>
        <div className="text-xs text-slate-400 mt-0.5">
  {item.amount} {item.unit}
  {item.expiryDate && (
    <span className="text-slate-500">
      {' · '} do {new Date(item.expiryDate).toLocaleDateString('cs-CZ')}
    </span>
  )}
</div>
      </div>

      <button
        type="button"
        onClick={() => onEdit?.(item)}
        className="p-2 rounded-xl text-slate-400 hover:text-slate-100 hover:bg-slate-800/60"
        title="Upravit"
      >
        <Pencil className="w-4 h-4" />
      </button>

      <button
        type="button"
        onClick={() => onAddToCart(item)}
        className="p-2 rounded-xl text-emerald-300 hover:bg-emerald-500/10"
        title="Přidat do nákupního seznamu"
      >
        <ShoppingCart className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={() => onDelete(item.id)}
        className="p-2 rounded-xl text-slate-400 hover:text-red-300 hover:bg-red-500/10"
        title="Smazat"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </li>
  )
}

function OverviewTab({ expenses, onAddExpense }) {
  const [label, setLabel] = useState('Restaurace')
  const [amountCzk, setAmountCzk] = useState(200)

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthExpenses = expenses.filter((e) => {
    const d = toDateMaybe(e.createdAt)
    return d ? d >= monthStart : false
  })

  const totalMonth = monthExpenses.reduce((s, e) => s + (Number(e.amountCzk) || 0), 0)

  const byLabel = useMemo(() => {
    const m = new Map()
    for (const e of monthExpenses) {
      const k = (e.label || 'Ostatní').toString()
      m.set(k, (m.get(k) || 0) + (Number(e.amountCzk) || 0))
    }
    return Array.from(m.entries()).map(([k, v]) => ({ label: k, value: v })).sort((a, b) => b.value - a.value).slice(0, 7)
  }, [monthExpenses])

  const weekly = useMemo(() => {
    // 7 dní včetně dneška
    const days = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(now.getDate() - i)
      d.setHours(0, 0, 0, 0)
      days.push(d)
    }
    const values = days.map((d) => {
      const next = new Date(d)
      next.setDate(d.getDate() + 1)
      const sum = expenses.reduce((s, e) => {
        const t = toDateMaybe(e.createdAt)
        if (!t) return s
        return t >= d && t < next ? s + (Number(e.amountCzk) || 0) : s
      }, 0)
      return { day: d, value: sum }
    })
    return values
  }, [expenses])

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-sm text-slate-400">Odhadovaná útrata tento měsíc</div>
            <div className="text-2xl font-bold text-slate-100">{formatCzk(totalMonth || 0)}</div>
          </div>
          <div className="text-xs text-slate-500 text-right">
            Ruční výdaje jsou zatím „v1“ (jednoduché).
          </div>
        </div>
      </Card>

      <Card>
        <div className="text-sm font-semibold text-slate-100 mb-3">Výdaje podle kategorií</div>
        <Pie data={byLabel} />
      </Card>

      <Card>
        <div className="text-sm font-semibold text-slate-100 mb-3">Týdenní trend</div>
        <Bars data={weekly} />
      </Card>

      <Card>
        <div className="text-sm font-semibold text-slate-100 mb-3">Přidat výdaj navíc</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <div className="text-xs text-slate-500 mb-1">Kategorie</div>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Např. Restaurace" />
            <div className="flex flex-wrap gap-2 mt-2">
              {['Restaurace', 'Sladkosti', 'Káva', 'Doprava'].map((x) => (
                <button
                  key={x}
                  type="button"
                  onClick={() => setLabel(x)}
                  className="px-2 py-1 rounded-xl bg-slate-800 text-slate-200 text-xs hover:bg-slate-700"
                >
                  {x}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Částka (Kč)</div>
            <Input type="number" min="0" value={amountCzk} onChange={(e) => setAmountCzk(Number(e.target.value) || 0)} />
          </div>
        </div>

        <div className="mt-3">
          <Button
            onClick={() => {
              onAddExpense({ label, amountCzk })
              setAmountCzk(200)
            }}
          >
            <Plus className="w-5 h-5" />
            Uložit výdaj
          </Button>
        </div>
      </Card>
    </div>
  )
}

function Pie({ data }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1
  const colors = ['#60a5fa', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#22d3ee', '#fb7185']
  let cum = 0
  const stops = data.map((d, idx) => {
    const p = (d.value / total) * 100
    const start = cum
    cum += p
    return { color: colors[idx % colors.length], start, end: cum, ...d }
  })
  const gradient = stops.map((s) => `${s.color} ${s.start}% ${s.end}%`).join(', ')

  return (
    <div className="flex flex-col sm:flex-row items-center gap-5">
      <div className="w-40 h-40 rounded-full border border-slate-800 shadow-inner" style={{ background: `conic-gradient(${gradient})` }} />
      <div className="flex-1 w-full space-y-2">
        {stops.map((s, i) => (
          <div key={i} className="flex items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
              <span className="text-slate-200 truncate">{s.label}</span>
            </div>
            <span className="text-slate-100 font-medium">{formatCzk(s.value)}</span>
          </div>
        ))}
        {!data.length ? <div className="text-slate-400 text-sm">Zatím žádné výdaje.</div> : null}
      </div>
    </div>
  )
}

function Bars({ data }) {
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <div className="grid grid-cols-7 gap-2 items-end">
      {data.map((d, idx) => {
        const h = Math.round((d.value / max) * 100)
        const label = d.day.toLocaleDateString('cs-CZ', { weekday: 'short' })
        return (
          <div key={idx} className="flex flex-col items-center gap-2">
            <div className="w-full h-24 bg-slate-900/40 rounded-xl border border-slate-800 overflow-hidden flex items-end">
              <div className="w-full bg-blue-600/80" style={{ height: `${h}%` }} />
            </div>
            <div className="text-[11px] text-slate-400">{label}</div>
          </div>
        )
      })}
    </div>
  )
}
