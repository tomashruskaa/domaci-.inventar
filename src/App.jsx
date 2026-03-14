import { useState, useEffect } from 'react'
import { initializeApp } from 'firebase/app'
import { getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, query, where, onSnapshot, serverTimestamp } from 'firebase/firestore'
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth'
import { ShoppingBag, Warehouse, PieChart, Camera, X, Plus, Pencil, ShoppingCart, ChevronRight, ChefHat, Trash2, Receipt, Image, Link2, GripVertical } from 'lucide-react'
import { parseDecimal, formatQuantity } from './utils/parsing'

// Firebase
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyCPPKsCnfKp-nxM3UNcsogwcpnSToSTJsA",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "domaci-inventar.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "domaci-inventar",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "domaci-inventar.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "336732681301",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:336732681301:web:23d56014aaf54e568890dc",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-VBLB4ER8XE"
}

const app = initializeApp(firebaseConfig)
const db = getFirestore(app)
const auth = getAuth(app)

const APP_ID = 'domaci-inventar-v1'
const CATEGORIES = ['Chlazené', 'Pečivo', 'Zelenina & Ovoce', 'Maso', 'Ostatní']
const LOCATIONS = ['Lednice', 'Mrazák', 'Spíž']
const UNITS = ['ks', 'g', 'kg', 'ml', 'l']

// Mapování klíčových slov v názvu položky na emoji (pořadí: specifičtější první)
const ITEM_EMOJI_MAP = [
  { keywords: ['mop', 'podlaha', 'úklid', 'uklid'], emoji: '🧹' },
  { keywords: ['stůl', 'stul', 'stol'], emoji: '🪑' },
  { keywords: ['hrnec', 'hrnce', 'hrnky'], emoji: '🍲' },
  { keywords: ['věšák', 'vesak', 'oblečení', 'obleceni'], emoji: '👔' },
  { keywords: ['koš na prádlo', 'kos na pradlo', 'prádlo', 'pradlo'], emoji: '🧺' },
  { keywords: ['mléko', 'mleko'], emoji: '🥛' },
  { keywords: ['chléb', 'chleb', 'pečivo', 'pecivo', 'rohlík', 'rohlik'], emoji: '🍞' },
  { keywords: ['maso', 'kuře', 'kure', 'vepř', 'vepr', 'hovězí', 'hovezi'], emoji: '🥩' },
  { keywords: ['sýr', 'syr', 'tvaroh'], emoji: '🧀' },
  { keywords: ['jablko', 'jablka', 'pomeranč', 'pomeranc', 'banán', 'banan', 'ovoce'], emoji: '🍎' },
  { keywords: ['zelenina', 'salát', 'salat', 'okurka', 'rajče', 'rajce'], emoji: '🥬' },
  { keywords: ['vejce', 'vajec'], emoji: '🥚' },
  { keywords: ['káva', 'kava', 'čaj', 'caj'], emoji: '☕' },
  { keywords: ['pivo', 'víno', 'vino'], emoji: '🍺' },
  { keywords: ['voda', 'minerál', 'mineral'], emoji: '💧' },
  { keywords: ['lednice', 'lednička', 'lednicka'], emoji: '🧊' },
  { keywords: ['mrazák', 'mrazak'], emoji: '❄️' },
]

function normalizeForEmoji(str) {
  if (!str || typeof str !== 'string') return ''
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
}

function getItemEmoji(name) {
  const n = normalizeForEmoji(name)
  for (const { keywords, emoji } of ITEM_EMOJI_MAP) {
    if (keywords.some((kw) => n.includes(kw))) return emoji
  }
  return '🛒'
}

function formatExpiry(item) {
  if (item.expiryDate) {
    return new Date(item.expiryDate).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' })
  }
  if (item.createdAt && item.consumeWithinDays != null) {
    const d = new Date(item.createdAt?.toMillis?.() ?? item.createdAt)
    d.setDate(d.getDate() + Number(item.consumeWithinDays))
    return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' })
  }
  return null
}

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || 'AIzaSyCYnLRNdA8C3Krr2F0QyuaqPo1H2tHvlRY'
// Modely s podporou obrázků; 2.0-flash má na free tier často vyčerpanou kvótu
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash']

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

function getGeminiUrl(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`
}

async function callGeminiForImage(imageBase64, mimeType = 'image/jpeg', retries = 2) {
  const prompt = `Analyzuj tuto fotku potravin nebo zásob (lednice, nákup). Vrať POUZE validní JSON pole objektů bez markdown a bez dalšího textu.
Každý objekt musí mít přesně: name (název v češtině), amount (číslo), unit (jedna z: ks, g, kg, ml, l), category (přesně jedna z: Chlazené, Pečivo, Zelenina & Ovoce, Maso, Ostatní).
Příklad: [{"name":"Mléko","amount":500,"unit":"ml","category":"Chlazené"},{"name":"Chléb","amount":1,"unit":"ks","category":"Pečivo"}]`

  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'your-gemini-api-key') {
    throw new Error('Není nastaven API klíč pro Gemini. Přidejte VITE_GEMINI_API_KEY do nastavení Vercel.')
  }

  const payload = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType || 'image/jpeg', data: imageBase64 } }
      ]
    }]
  }

  let lastError = null
  for (const model of GEMINI_MODELS) {
    for (let i = 0; i < retries; i++) {
      try {
        const url = getGeminiUrl(model)
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
        const data = await res.json()

        if (!res.ok) {
          const msg = data?.error?.message || `HTTP ${res.status}`
          throw new Error(msg)
        }

        if (data.error) {
          throw new Error(data.error.message || 'Chyba API')
        }

        const candidate = data.candidates?.[0]
        if (!candidate) {
          const blockReason = data.promptFeedback?.blockReason || 'Žádná odpověď'
          throw new Error(blockReason)
        }
        if (candidate.finishReason && candidate.finishReason !== 'STOP' && candidate.finishReason !== 'MAX_TOKENS') {
          throw new Error(candidate.finishReason)
        }

        const text = candidate.content?.parts?.[0]?.text
        if (!text || typeof text !== 'string') {
          throw new Error('Prázdná odpověď od modelu')
        }

        const match = text.match(/\[[\s\S]*\]/)
        const parsed = match ? JSON.parse(match[0]) : []
        return Array.isArray(parsed) ? parsed : []
      } catch (e) {
        lastError = e
        const msg = e?.message || ''
        const is429 = msg.includes('quota') || msg.includes('429') || msg.includes('Too Many')
        console.warn(`Gemini ${model} pokus ${i + 1}:`, msg)
        if (is429 && i < retries - 1) {
          const wait = 5000
          await delay(wait)
        } else if (i < retries - 1) {
          await delay(1000 * (i + 1))
        }
      }
    }
  }

  throw lastError || new Error('Analýza fotky selhala')
}

async function callGeminiForRecipes(itemNames, retries = 2) {
  const prompt = `Máš k dispozici tyto suroviny v lednici: ${itemNames.join(', ')}.
Vrať POUZE validní JSON pole 2 receptů. Každý recept: title (string, česky), description (string, krátký popis), ingredients (pole stringů - názvy surovin), steps (pole stringů - číslované kroky v češtině).
Příklad: [{"title":"Vaječná omeleta","description":"Rychlá snídaně.","ingredients":["Vejce","Sýr"],"steps":["Rozšlehejte vejce.","Smažte na pánvi."]}]`

  const payload = { contents: [{ parts: [{ text: prompt }] }] }
  for (const model of GEMINI_MODELS) {
    for (let i = 0; i < retries; i++) {
      try {
        const res = await fetch(getGeminiUrl(model), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.ok}`)
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text
        if (!text) throw new Error('Prázdná odpověď')
        const match = text.match(/\[[\s\S]*\]/)
        const parsed = match ? JSON.parse(match[0]) : []
        return Array.isArray(parsed) ? parsed : []
      } catch (e) {
        if (i === retries - 1 && model === GEMINI_MODELS[GEMINI_MODELS.length - 1]) throw e
        await delay(1000)
      }
    }
  }
  return []
}

export default function App() {
  const [user, setUser] = useState(null)
  const [activeSection, setActiveSection] = useState('shopping')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [aiLoading, setAiLoading] = useState(false)
  const [reviewItems, setReviewItems] = useState([])
  const [showReviewModal, setShowReviewModal] = useState(false)
  const [selectedLocation, setSelectedLocation] = useState('Lednice')
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [editAmount, setEditAmount] = useState(0)
  const [editUnit, setEditUnit] = useState('ks')
  const [editCategory, setEditCategory] = useState('Ostatní')
  const [editEmoji, setEditEmoji] = useState('🛒')
  const [editConsumeWithinDays, setEditConsumeWithinDays] = useState(7)
  const [editingShoppingId, setEditingShoppingId] = useState(null)
  const [showCookModal, setShowCookModal] = useState(false)
  const [cookLoading, setCookLoading] = useState(false)
  const [recipes, setRecipes] = useState([])
  const [showRecipeImportModal, setShowRecipeImportModal] = useState(false)
  const [recipeImportItems, setRecipeImportItems] = useState([])
  const [recipeImportLoading, setRecipeImportLoading] = useState(false)
  const [showReceiptModal, setShowReceiptModal] = useState(false)
  const [receiptItems, setReceiptItems] = useState([])

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (u) setUser(u)
      else try { await signInAnonymously(auth) } catch (e) { console.error(e) }
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    if (!user) return
    setLoading(true)
    const q = query(
      collection(db, 'items'),
      where('appId', '==', APP_ID)
    )
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      setItems(list)
      setLoading(false)
    }, (e) => {
      console.error(e)
      setLoading(false)
    })
    return () => unsub()
  }, [user])

  const shoppingItems = items.filter((i) => i.status === 'shopping')
  const homeItems = items.filter((i) => i.status === 'home')
  const shoppingByCategory = CATEGORIES.map((cat) => ({
    category: cat,
    items: shoppingItems.filter((i) => i.category === cat && !i.isBought)
  }))
  const boughtItems = shoppingItems.filter((i) => i.isBought)
  const homeByLocation = (loc) =>
    homeItems.filter((i) => i.location === loc).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'cs'))

  const addToShopping = async (name, amount, category, unit = 'ks') => {
    try {
      const u = ['ks', 'g', 'kg', 'ml', 'l'].includes(unit) ? unit : 'ks'
      await addDoc(collection(db, 'items'), {
        appId: APP_ID,
        name: name || 'Položka',
        amount: parseDecimal(amount) || 1,
        unit: u,
        category: category || 'Ostatní',
        status: 'shopping',
        isBought: false,
        emoji: getItemEmoji(name || '')
      })
    } catch (e) {
      console.error(e)
      alert('Nepodařilo se přidat položku.')
    }
  }

  const moveBoughtToHome = async () => {
    try {
      for (const item of boughtItems) {
        await updateDoc(doc(db, 'items', item.id), {
          status: 'home',
          location: 'Lednice',
          isBought: false
        })
      }
    } catch (e) {
      console.error(e)
    }
  }

  const setBought = async (id, value) => {
    try {
      await updateDoc(doc(db, 'items', id), { isBought: !!value })
    } catch (e) {
      console.error(e)
    }
  }

  const moveToShopping = async (item) => {
    try {
      await updateDoc(doc(db, 'items', item.id), {
        status: 'shopping',
        isBought: false,
        category: item.category || 'Ostatní'
      })
    } catch (e) {
      console.error(e)
    }
  }

  const updateItem = async (id, updates) => {
    try {
      await updateDoc(doc(db, 'items', id), updates)
      setEditingId(null)
    } catch (e) {
      console.error(e)
    }
  }

  const deleteItem = async (id) => {
    try {
      await deleteDoc(doc(db, 'items', id))
    } catch (e) {
      console.error(e)
    }
  }

  const handlePhoto = (e, isReceipt = false) => {
    const file = e.target.files?.[0]
    if (!file) return
    const mimeType = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
    setAiLoading(true)
    const reader = new FileReader()
    reader.onloadend = async () => {
      try {
        const dataUrl = reader.result
        const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl
        if (!base64) throw new Error('Nepodařilo se načíst obrázek')
        if (isReceipt) {
          const res = await fetch(`${window.location.origin}/api/receipt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageBase64: base64, mimeType })
          })
          const data = await res.json()
          if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
          const list = (data.items || []).map((it) => ({ ...it, included: true }))
          setReceiptItems(list.length ? list : [{ name: 'Neznámý', amount: 1, unit: 'ks', location: 'Spíž', included: true }])
          setShowReceiptModal(true)
        } else {
          const list = await callGeminiForImage(base64, mimeType)
          setReviewItems(list.length ? list : [{ name: 'Neznámý', amount: 1, unit: 'ks', category: 'Ostatní' }])
          setShowReviewModal(true)
        }
      } catch (err) {
        const message = err?.message || 'Neznámá chyba'
        console.error('AI analýza fotky:', message)
        const isQuota = message.includes('quota') || message.includes('429') || message.includes('Too Many')
        const userMsg = isQuota
          ? 'Kvóta Gemini API je vyčerpaná. Zkuste to za minutu nebo zkontrolujte kvótu na https://aistudio.google.com'
          : `Analýza fotky selhala. Zkuste to znovu.\n\nDetail: ${message}`
        alert(userMsg)
      } finally {
        setAiLoading(false)
      }
    }
    reader.onerror = () => {
      setAiLoading(false)
      alert('Nepodařilo se načíst soubor.')
    }
    reader.readAsDataURL(file)
  }

  const saveReceiptToHome = async () => {
    for (const it of receiptItems.filter((i) => i.included)) {
      await addDoc(collection(db, 'items'), {
        appId: APP_ID,
        name: it.name || 'Položka',
        amount: parseDecimal(it.amount) || 1,
        unit: ['ks', 'g', 'kg', 'ml', 'l'].includes(it.unit) ? it.unit : 'ks',
        category: CATEGORIES.includes(it.category) ? it.category : 'Ostatní',
        status: 'home',
        location: it.location || 'Spíž',
        consumeWithinDays: 7,
        emoji: getItemEmoji(it.name || ''),
        createdAt: serverTimestamp()
      })
    }
    setShowReceiptModal(false)
    setReceiptItems([])
  }

  const saveReviewToHome = async () => {
    const location = selectedLocation
    for (const it of reviewItems) {
      await addDoc(collection(db, 'items'), {
        appId: APP_ID,
        name: it.name || 'Položka',
        amount: parseDecimal(it.amount) || 1,
        unit: ['ks', 'g', 'kg', 'ml', 'l'].includes(it.unit) ? it.unit : 'ks',
        category: CATEGORIES.includes(it.category) ? it.category : 'Ostatní',
        status: 'home',
        location,
        consumeWithinDays: 7,
        emoji: getItemEmoji(it.name || ''),
        createdAt: serverTimestamp()
      })
    }
    setShowReviewModal(false)
    setReviewItems([])
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-transparent">
        <span className="text-slate-300">Načítání…</span>
      </div>
    )
  }

  const tabConfig = [
    { id: 'shopping', label: 'Seznam', Icon: ShoppingBag },
    { id: 'home', label: 'Doma', Icon: Warehouse },
    { id: 'stats', label: 'Přehled', Icon: PieChart }
  ]

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 p-4 md:p-6 pb-24 md:pb-8 max-w-2xl mx-auto w-full">
        <p className="text-sm text-slate-400 mb-2">Domácí Inventář</p>
        {activeSection === 'shopping' && (
          <ShoppingSection
            categories={CATEGORIES}
            shoppingByCategory={shoppingByCategory}
            boughtItems={boughtItems}
            addToShopping={addToShopping}
            setBought={setBought}
            deleteItem={deleteItem}
            moveBoughtToHome={moveBoughtToHome}
            editingShoppingId={editingShoppingId}
            setEditingShoppingId={setEditingShoppingId}
            updateItem={updateItem}
            getItemEmoji={getItemEmoji}
            onImportFromRecipe={async (url) => {
              setRecipeImportLoading(true)
              try {
                const res = await fetch(`${window.location.origin}/api/recipe`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ url })
                })
                const data = await res.json()
                if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
                setRecipeImportItems(data.items || [])
                setShowRecipeImportModal(true)
              } catch (err) {
                alert(err?.message || 'Import z receptu selhal.')
              } finally {
                setRecipeImportLoading(false)
              }
            }}
            recipeImportLoading={recipeImportLoading}
          />
        )}
        {activeSection === 'home' && (
          <HomeSection
            locations={LOCATIONS}
            selectedLocation={selectedLocation}
            setSelectedLocation={setSelectedLocation}
            homeByLocation={homeByLocation}
            onScan={(e) => handlePhoto(e, false)}
            onScanReceipt={(e) => handlePhoto(e, true)}
            aiLoading={aiLoading}
            editingId={editingId}
            setEditingId={setEditingId}
            editName={editName}
            editAmount={editAmount}
            editUnit={editUnit}
            editCategory={editCategory}
            editEmoji={editEmoji}
            editConsumeWithinDays={editConsumeWithinDays}
            setEditName={setEditName}
            setEditAmount={setEditAmount}
            setEditUnit={setEditUnit}
            setEditCategory={setEditCategory}
            setEditEmoji={setEditEmoji}
            setEditConsumeWithinDays={setEditConsumeWithinDays}
            updateItem={updateItem}
            moveToShopping={moveToShopping}
            deleteItem={deleteItem}
            onOpenCookModal={async () => {
              setShowCookModal(true)
              setCookLoading(true)
              setRecipes([])
              try {
                const names = homeItems.map((i) => i.name).filter(Boolean)
                const list = await callGeminiForRecipes(names.length ? names : ['mléko', 'chléb'])
                setRecipes(list)
              } catch (e) {
                console.error(e)
                setRecipes([{ title: 'Recept se nepodařilo načíst', description: '', ingredients: [], steps: [] }])
              } finally {
                setCookLoading(false)
              }
            }}
            formatExpiry={formatExpiry}
            getItemEmoji={getItemEmoji}
            CATEGORIES={CATEGORIES}
            UNITS={UNITS}
          />
        )}
        {activeSection === 'stats' && <StatsSection />}
      </main>

      {/* Spodní tab bar: Seznam / Doma / Přehled */}
      <div className="fixed bottom-0 left-0 right-0 h-20 bg-slate-800/95 border-t border-slate-700 flex justify-around items-center z-30 safe-area-pb">
        {tabConfig.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setActiveSection(id)}
            className={`flex flex-col items-center justify-center gap-1 py-2 px-4 rounded-2xl transition-colors min-w-[72px] ${
              activeSection === id ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-slate-300'
            }`}
          >
            <Icon className="w-6 h-6 shrink-0" />
            <span className="text-xs font-medium">{label}</span>
          </button>
        ))}
      </div>

      {/* AI analyzuje overlay */}
      {aiLoading && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-2xl px-8 py-6 shadow-xl text-center max-w-sm border border-slate-600">
            <div className="w-10 h-10 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-white font-medium">AI analyzuje…</p>
            <p className="text-sm text-slate-400 mt-2">Tip: u lednice zkuste fotit z větší dálky, aby byly vidět celé police.</p>
          </div>
        </div>
      )}

      {/* Review modal (lednice / galerie) */}
      {showReviewModal && (
        <ReviewModal
          items={reviewItems}
          categories={CATEGORIES}
          locations={LOCATIONS}
          selectedLocation={selectedLocation}
          setSelectedLocation={setSelectedLocation}
          onUpdate={(idx, field, value) => {
            const next = [...reviewItems]
            next[idx] = { ...next[idx], [field]: value }
            setReviewItems(next)
          }}
          onRemove={(idx) => setReviewItems(reviewItems.filter((_, i) => i !== idx))}
          onSave={saveReviewToHome}
          onClose={() => { setShowReviewModal(false); setReviewItems([]) }}
        />
      )}

      {/* Receipt review modal (účtenka – s lokací a zaškrtávátkem) */}
      {showReceiptModal && (
        <ReceiptReviewModal
          items={receiptItems}
          locations={LOCATIONS}
          onUpdate={(idx, field, value) => {
            const next = [...receiptItems]
            next[idx] = { ...next[idx], [field]: value }
            setReceiptItems(next)
          }}
          onToggleIncluded={(idx) => {
            const next = [...receiptItems]
            next[idx] = { ...next[idx], included: !next[idx].included }
            setReceiptItems(next)
          }}
          onSave={saveReceiptToHome}
          onClose={() => { setShowReceiptModal(false); setReceiptItems([]) }}
          UNITS={UNITS}
        />
      )}

      {/* Co dnes uvařit? modal */}
      {/* Recipe import confirmation modal */}
      {showRecipeImportModal && (
        <RecipeImportModal
          items={recipeImportItems}
          categories={CATEGORIES}
          onUpdate={(idx, field, value) => {
            const next = [...recipeImportItems]
            next[idx] = { ...next[idx], [field]: value }
            setRecipeImportItems(next)
          }}
          onRemove={(idx) => setRecipeImportItems(recipeImportItems.filter((_, i) => i !== idx))}
          onConfirm={async () => {
            for (const it of recipeImportItems) {
              await addToShopping(it.name || 'Položka', parseDecimal(it.amount) || 1, it.category || 'Ostatní', it.unit || 'ks')
            }
            setShowRecipeImportModal(false)
            setRecipeImportItems([])
          }}
          onClose={() => { setShowRecipeImportModal(false); setRecipeImportItems([]) }}
        />
      )}

      {showCookModal && (
        <CookModal
          onClose={() => { setShowCookModal(false); setRecipes([]) }}
          loading={cookLoading}
          recipes={recipes}
          onTryAgain={async () => {
            setCookLoading(true)
            setRecipes([])
            try {
              const names = homeItems.map((i) => i.name).filter(Boolean)
              const list = await callGeminiForRecipes(names.length ? names : ['mléko', 'chléb'])
              setRecipes(list)
            } catch (e) {
              console.error(e)
              setRecipes([{ title: 'Recept se nepodařilo načíst', description: '', ingredients: [], steps: [] }])
            } finally {
              setCookLoading(false)
            }
          }}
        />
      )}
    </div>
  )
}

function ShoppingSection({
  categories,
  shoppingByCategory,
  boughtItems,
  addToShopping,
  setBought,
  deleteItem,
  moveBoughtToHome,
  editingShoppingId,
  setEditingShoppingId,
  updateItem,
  getItemEmoji,
  onImportFromRecipe,
  recipeImportLoading
}) {
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('1')
  const [category, setCategory] = useState('Ostatní')
  const [showForm, setShowForm] = useState(false)
  const [recipeUrl, setRecipeUrl] = useState('')

  const editingItem = editingShoppingId
    ? [...shoppingByCategory.flatMap((s) => s.items), ...boughtItems].find((i) => i.id === editingShoppingId)
    : null

  const submit = (e) => {
    e.preventDefault()
    if (!name.trim()) return
    addToShopping(name.trim(), parseDecimal(amount) || 1, category)
    setName('')
    setAmount('1')
    setCategory('Ostatní')
    setShowForm(false)
  }

  const handleRecipeImport = (e) => {
    e.preventDefault()
    const url = recipeUrl.trim()
    if (!url) return
    onImportFromRecipe?.(url)
    setRecipeUrl('')
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl md:text-3xl font-bold text-white flex items-center gap-2">
        <ShoppingCart className="w-8 h-8 text-slate-300" />
        Nákupní seznam
      </h1>

      <form onSubmit={handleRecipeImport} className="bg-slate-800 rounded-2xl p-4 border border-slate-600 shadow-sm space-y-2">
        <label className="block text-sm text-slate-400">Import z URL receptu</label>
        <div className="flex gap-2">
          <input
            type="url"
            value={recipeUrl}
            onChange={(e) => setRecipeUrl(e.target.value)}
            placeholder="https://..."
            className="flex-1 px-4 py-2 rounded-xl border border-slate-600 bg-slate-700 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={recipeImportLoading}
          />
          <button type="submit" disabled={recipeImportLoading || !recipeUrl.trim()} className="px-4 py-2 rounded-xl bg-slate-600 text-white font-medium hover:bg-slate-500 disabled:opacity-50 flex items-center gap-2 shrink-0">
            <Link2 className="w-4 h-4" />
            {recipeImportLoading ? 'Načítám…' : 'Importovat'}
          </button>
        </div>
      </form>

      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-blue-500 text-white font-medium hover:bg-blue-600 transition-colors shadow-lg"
        >
          <Plus className="w-5 h-5" />
          Přidat položku
        </button>
      ) : (
        <form onSubmit={submit} className="bg-slate-800 rounded-2xl p-4 md:p-5 border border-slate-600 shadow-sm space-y-4">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Název"
            className="w-full px-4 py-2 rounded-xl border border-slate-600 bg-slate-700 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Množství"
              className="w-full px-4 py-2 rounded-xl border border-slate-600 bg-slate-700 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-4 py-2 rounded-xl border border-slate-600 bg-slate-700 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-2 rounded-xl bg-slate-600 text-slate-200 font-medium">
              Zrušit
            </button>
            <button type="submit" className="flex-1 py-2 rounded-xl bg-blue-500 text-white font-medium hover:bg-blue-600">
              Přidat
            </button>
          </div>
        </form>
      )}

      {shoppingByCategory.map(({ category: cat, items: catItems }) =>
        catItems.length > 0 ? (
          <section key={cat} className="bg-slate-800 rounded-2xl p-4 md:p-5 border border-slate-600 shadow-sm">
            <h2 className="text-lg font-semibold text-white mb-3">{cat}</h2>
            <ul className="space-y-2">
              {catItems.map((item) => (
                <li key={item.id} className="flex items-center gap-3 py-2 border-b border-slate-600 last:border-0">
                  <input
                    type="checkbox"
                    checked={false}
                    onChange={() => setBought(item.id, true)}
                    className="w-5 h-5 rounded border-slate-500 text-blue-500 bg-slate-700"
                  />
                  <span className="text-xl shrink-0" aria-hidden>{item.emoji || getItemEmoji(item.name)}</span>
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-white block">{item.name}</span>
                    <span className="text-sm text-slate-400">{formatQuantity(item.amount)} {item.unit}</span>
                  </div>
                  <button type="button" onClick={() => setEditingShoppingId(item.id)} className="p-2 text-slate-400 hover:text-blue-400 rounded-lg" title="Upravit">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => deleteItem(item.id)} className="p-2 text-slate-400 hover:text-red-400 rounded-lg" title="Smazat">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null
      )}

      {boughtItems.length > 0 && (
        <section className="bg-slate-800 rounded-2xl p-4 md:p-5 border border-slate-600">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-slate-300">Koupeno</h2>
            <button
              type="button"
              onClick={moveBoughtToHome}
              className="text-sm py-1.5 px-3 rounded-xl bg-slate-600 text-slate-200 hover:bg-slate-500 font-medium"
            >
              Přesunout domů &gt;
            </button>
          </div>
          <ul className="space-y-2">
            {boughtItems.map((item) => (
              <li key={item.id} className="flex items-center gap-3 py-2 border-b border-slate-600 last:border-0 opacity-90">
                <input
                  type="checkbox"
                  checked
                  onChange={() => setBought(item.id, false)}
                  className="w-5 h-5 rounded border-slate-500 text-blue-500 bg-slate-700"
                />
                <span className="text-xl shrink-0" aria-hidden>{item.emoji || getItemEmoji(item.name)}</span>
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-slate-400 line-through block">{item.name}</span>
                  <span className="text-sm text-slate-500">{formatQuantity(item.amount)} {item.unit}</span>
                </div>
                <button type="button" onClick={() => setEditingShoppingId(item.id)} className="p-2 text-slate-400 hover:text-blue-400 rounded-lg">
                  <Pencil className="w-4 h-4" />
                </button>
                <button type="button" onClick={() => deleteItem(item.id)} className="p-2 text-slate-400 hover:text-red-400 rounded-lg">
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {shoppingByCategory.every((s) => s.items.length === 0) && boughtItems.length === 0 && (
        <p className="text-center text-slate-400 py-8">Nákupní seznam je prázdný.</p>
      )}

      {/* Edit shopping item modal */}
      {editingItem && (
        <ShoppingEditModal
          item={editingItem}
          categories={categories}
          onSave={(updates) => {
            updateItem(editingItem.id, updates)
            setEditingShoppingId(null)
          }}
          onClose={() => setEditingShoppingId(null)}
          onDelete={() => { deleteItem(editingItem.id); setEditingShoppingId(null) }}
        />
      )}
    </div>
  )
}

function ShoppingEditModal({ item, categories, onSave, onClose, onDelete }) {
  const [name, setName] = useState(item.name || '')
  const [amount, setAmount] = useState(String(item.amount ?? 1).replace('.', ','))
  const [category, setCategory] = useState(item.category || 'Ostatní')
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl p-5 w-full max-w-sm border border-slate-600">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-white">Upravit položku</h3>
          <button type="button" onClick={onDelete} className="p-2 text-slate-400 hover:text-red-400 rounded-lg">
            <Trash2 className="w-5 h-5" />
          </button>
        </div>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Název"
          className="w-full px-4 py-2 rounded-xl border border-slate-600 bg-slate-700 text-white mb-3"
        />
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Množství"
          className="w-full px-4 py-2 rounded-xl border border-slate-600 bg-slate-700 text-white mb-3"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full px-4 py-2 rounded-xl border border-slate-600 bg-slate-700 text-white mb-4"
        >
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 py-2 rounded-xl bg-slate-600 text-slate-200 font-medium">
            Zrušit
          </button>
          <button
            type="button"
            onClick={() => onSave({ name: name.trim() || item.name, amount: parseDecimal(amount) || 1, category })}
            className="flex-1 py-2 rounded-xl bg-blue-500 text-white font-medium hover:bg-blue-600"
          >
            Uložit
          </button>
        </div>
      </div>
    </div>
  )
}

function HomeSection({
  locations,
  selectedLocation,
  setSelectedLocation,
  homeByLocation,
  onScan,
  onScanReceipt,
  aiLoading,
  editingId,
  setEditingId,
  editName,
  editAmount,
  editUnit,
  editCategory,
  editEmoji,
  editConsumeWithinDays,
  setEditName,
  setEditAmount,
  setEditUnit,
  setEditCategory,
  setEditEmoji,
  setEditConsumeWithinDays,
  updateItem,
  moveToShopping,
  deleteItem,
  onOpenCookModal,
  formatExpiry,
  getItemEmoji,
  CATEGORIES,
  UNITS
}) {
  const list = homeByLocation(selectedLocation)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl md:text-3xl font-bold text-white flex items-center gap-2">
        <Warehouse className="w-8 h-8 text-slate-300" />
        Co mám doma
      </h1>

      <section className="bg-slate-800 rounded-2xl p-4 border border-slate-600 shadow-sm">
        <h2 className="text-lg font-semibold text-white mb-3">Přidat zásoby</h2>
        <div className="space-y-1">
          <label className="flex items-center justify-between w-full py-3 px-3 rounded-xl bg-slate-700/50 hover:bg-slate-700 text-white cursor-pointer">
            <span className="flex items-center gap-3">
              <Receipt className="w-5 h-5 text-slate-400" />
              Vyfotit účtenku
            </span>
            <ChevronRight className="w-5 h-5 text-slate-400" />
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onScanReceipt} disabled={aiLoading} />
          </label>
          <label className="flex items-center justify-between w-full py-3 px-3 rounded-xl bg-slate-700/50 hover:bg-slate-700 text-white cursor-pointer">
            <span className="flex items-center gap-3">
              <Camera className="w-5 h-5 text-slate-400" />
              Vyfotit lednici
            </span>
            <ChevronRight className="w-5 h-5 text-slate-400" />
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onScan} disabled={aiLoading} />
          </label>
          <label className="flex items-center justify-between w-full py-3 px-3 rounded-xl bg-slate-700/50 hover:bg-slate-700 text-white cursor-pointer">
            <span className="flex items-center gap-3">
              <Image className="w-5 h-5 text-slate-400" />
              Nahrát z galerie
            </span>
            <ChevronRight className="w-5 h-5 text-slate-400" />
            <input type="file" accept="image/*" className="hidden" onChange={onScan} disabled={aiLoading} />
          </label>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl overflow-hidden border border-slate-600 bg-slate-800/80">
          {locations.map((loc) => (
            <button
              key={loc}
              type="button"
              onClick={() => setSelectedLocation(loc)}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.dataset.dragOver = 'true' }}
              onDragLeave={(e) => { delete e.currentTarget.dataset.dragOver }}
              onDrop={(e) => {
                e.preventDefault()
                delete e.currentTarget.dataset.dragOver
                const id = e.dataTransfer.getData('application/x-domaci-inventar-item-id')
                if (id) updateItem(id, { location: loc })
              }}
              className={`px-4 py-2 font-medium whitespace-nowrap transition-colors ${
                selectedLocation === loc ? 'bg-blue-500 text-white' : 'text-slate-300 hover:bg-slate-700'
              } data-[drag-over=true]:ring-2 data-[drag-over=true]:ring-blue-400`}
            >
              {loc}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onOpenCookModal}
          className="flex items-center gap-2 py-2 px-4 rounded-xl bg-slate-700 border border-slate-600 text-white font-medium hover:bg-slate-600"
        >
          <ChefHat className="w-5 h-5 text-slate-300" />
          Co dnes uvařit?
        </button>
      </div>

      <section className="bg-slate-800 rounded-2xl p-4 md:p-5 border border-slate-600 shadow-sm">
        <h2 className="text-lg font-semibold text-white mb-3">{selectedLocation} <span className="text-slate-400 font-normal">{list.length}x</span></h2>
        {list.length === 0 ? (
          <p className="text-slate-400 py-4">Žádné položky.</p>
        ) : (
          <ul className="space-y-2">
            {list.map((item) => {
              const expiry = formatExpiry(item)
              return (
                <li
                  key={item.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-domaci-inventar-item-id', item.id)
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  className="flex items-center gap-3 py-2 border-b border-slate-600 last:border-0 cursor-grab active:cursor-grabbing"
                >
                  <span className="text-slate-500 shrink-0 touch-none" aria-label="Přetáhnout"><GripVertical className="w-4 h-4" /></span>
                  <span className="text-xl shrink-0" aria-hidden>{item.emoji || getItemEmoji(item.name)}</span>
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-white block">{item.name}</span>
                    <span className="text-sm text-slate-400">
                      {formatQuantity(item.amount)} {item.unit}
                      {expiry ? ` · do ${expiry}` : ''}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(item.id)
                      setEditName(item.name || '')
                      setEditAmount(item.amount != null ? String(item.amount).replace('.', ',') : '0')
                      setEditUnit(item.unit || 'ks')
                      setEditCategory(item.category || 'Ostatní')
                      setEditEmoji(item.emoji || getItemEmoji(item.name))
                      setEditConsumeWithinDays(item.consumeWithinDays ?? 7)
                    }}
                    className="p-2 text-slate-400 hover:text-blue-400 rounded-lg"
                    title="Upravit"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveToShopping(item)}
                    className="p-2 text-slate-400 hover:text-green-400 rounded-lg"
                    title="Přidat do nákupního seznamu"
                  >
                    <ShoppingCart className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => deleteItem(item.id)} className="p-2 text-slate-400 hover:text-red-400 rounded-lg">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {editingId && (
        <ItemEditModal
          title={`Položka ${list.findIndex((i) => i.id === editingId) + 1}`}
          name={editName}
          amount={editAmount}
          unit={editUnit}
          category={editCategory}
          emoji={editEmoji}
          consumeWithinDays={editConsumeWithinDays}
          onNameChange={setEditName}
          onAmountChange={setEditAmount}
          onUnitChange={setEditUnit}
          onCategoryChange={setEditCategory}
          onEmojiChange={setEditEmoji}
          onConsumeWithinDaysChange={setEditConsumeWithinDays}
          categories={CATEGORIES}
          units={UNITS}
          onSave={() => updateItem(editingId, {
            name: editName,
            amount: parseDecimal(editAmount) || 0,
            unit: editUnit,
            category: editCategory,
            emoji: editEmoji,
            consumeWithinDays: Number(editConsumeWithinDays) || 7
          })}
          onClose={() => setEditingId(null)}
          onDelete={() => { deleteItem(editingId); setEditingId(null) }}
        />
      )}
    </div>
  )
}

function ItemEditModal({
  title,
  name,
  amount,
  unit,
  category,
  emoji,
  consumeWithinDays,
  onNameChange,
  onAmountChange,
  onUnitChange,
  onCategoryChange,
  onEmojiChange,
  onConsumeWithinDaysChange,
  categories,
  units,
  onSave,
  onClose,
  onDelete
}) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-slate-800 rounded-2xl p-5 w-full max-w-sm border border-slate-600 my-8">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <span className="text-2xl" aria-hidden>{emoji}</span>
            {title}
          </h3>
          <button type="button" onClick={onDelete} className="p-2 text-slate-400 hover:text-red-400 rounded-lg">
            <Trash2 className="w-5 h-5" />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Název</label>
            <input
              type="text"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              className="w-full px-4 py-2 rounded-xl border border-slate-600 bg-slate-700 text-white"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Množství</label>
            <input
              type="text"
              inputMode="decimal"
              value={amount ?? ''}
              onChange={(e) => onAmountChange(e.target.value)}
              placeholder="1 nebo 1,5"
              className="w-full px-4 py-2 rounded-xl border border-slate-600 bg-slate-700 text-white"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Jednotka</label>
            <select
              value={unit}
              onChange={(e) => onUnitChange(e.target.value)}
              className="w-full px-4 py-2 rounded-xl border border-slate-600 bg-slate-700 text-white"
            >
              {units.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Kategorie</label>
            <select
              value={category}
              onChange={(e) => onCategoryChange(e.target.value)}
              className="w-full px-4 py-2 rounded-xl border border-slate-600 bg-slate-700 text-white"
            >
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Emoji</label>
            <input
              type="text"
              value={emoji}
              onChange={(e) => onEmojiChange(e.target.value)}
              className="w-full px-4 py-2 rounded-xl border border-slate-600 bg-slate-700 text-white"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Spotřebovat za (dní)</label>
            <input
              type="number"
              min="1"
              value={consumeWithinDays}
              onChange={(e) => onConsumeWithinDaysChange(Number(e.target.value) || 7)}
              className="w-full px-4 py-2 rounded-xl border border-slate-600 bg-slate-700 text-white"
            />
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button type="button" onClick={onClose} className="flex-1 py-2 rounded-xl bg-slate-600 text-slate-200 font-medium">
            Zrušit
          </button>
          <button type="button" onClick={onSave} className="flex-1 py-2 rounded-xl bg-blue-500 text-white font-medium hover:bg-blue-600">
            Uložit
          </button>
        </div>
      </div>
    </div>
  )
}

function StatsSection() {
  const data = [
    { name: 'Restaurace', value: 600, color: '#60a5fa' },
    { name: 'Sladkosti', value: 200, color: '#34d399' }
  ]
  const total = data.reduce((s, i) => s + i.value, 0)
  let cum = 0
  const gradient = data.map((i) => {
    const p = total ? (i.value / total) * 100 : 0
    const start = cum
    cum += p
    return `${i.color} ${start}% ${cum}%`
  }).join(', ')
  const weekDays = ['st', 'čt', 'pá', 'so', 'ne', 'po', 'út']
  const weekValues = [0, 0, 0, 0, 0, 0, 200]
  const maxVal = Math.max(...weekValues, 1)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl md:text-3xl font-bold text-white flex items-center gap-2">
        <PieChart className="w-8 h-8 text-slate-300" />
        Přehled
      </h1>

      <div className="bg-slate-800 rounded-2xl p-5 border border-slate-600 shadow-sm">
        <p className="text-base font-semibold text-white mb-1">Odhadovaná útrata tento měsíc</p>
        <p className="text-2xl font-bold text-blue-400">800 Kč</p>
        <p className="text-sm text-slate-400 mt-1">Ruční výdaje jsou zatím &quot;v1&quot; (jednoduché).</p>
      </div>

      <div className="bg-slate-800 rounded-2xl p-5 border border-slate-600 shadow-sm">
        <h2 className="text-lg font-semibold text-white mb-4">Výdaje podle kategorií</h2>
        <div className="flex flex-col sm:flex-row items-center gap-6">
          <div
            className="w-36 h-36 rounded-full border-4 border-slate-700 shadow-md flex-shrink-0"
            style={{ background: `conic-gradient(${gradient})` }}
          />
          <div className="flex-1 w-full space-y-2">
            {data.map((d, i) => (
              <div key={i} className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                  <span className="text-slate-300">{d.name}</span>
                </div>
                <span className="font-medium text-white">{d.value} Kč</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-slate-800 rounded-2xl p-5 border border-slate-600 shadow-sm">
        <h2 className="text-lg font-semibold text-white mb-4">Týdenní trend</h2>
        <div className="flex justify-between items-end gap-1 h-24">
          {weekDays.map((day, i) => (
            <div key={day} className="flex-1 flex flex-col items-center gap-1 h-full">
              <div className="w-full flex-1 min-h-[20px] flex flex-col justify-end items-center">
                <div
                  className="w-6 rounded-t min-h-[4px]"
                  style={{
                    height: `${Math.max(4, (weekValues[i] / maxVal) * 80)}px`,
                    backgroundColor: weekValues[i] ? '#3b82f6' : 'rgb(51 65 85)'
                  }}
                />
              </div>
              <span className="text-xs text-slate-400">{day}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function CookModal({ onClose, loading, recipes, onTryAgain }) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-slate-800 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto border border-slate-600 shadow-xl">
        <div className="sticky top-0 bg-slate-800 flex justify-between items-center p-4 border-b border-slate-600">
          <h2 className="text-xl font-bold text-white">Co dnes uvařit?</h2>
          <button type="button" onClick={onClose} className="p-2 text-slate-400 hover:text-white rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 space-y-4">
          {loading && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="w-10 h-10 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mb-3" />
              <p className="text-slate-300">AI vymýšlí recepty...</p>
            </div>
          )}
          {!loading && recipes.length > 0 && recipes.map((r, idx) => (
            <div key={idx} className="bg-slate-700/50 rounded-xl p-4 border border-slate-600">
              <h3 className="text-lg font-semibold text-white mb-2">{r.title}</h3>
              {r.description && <p className="text-sm text-slate-400 mb-3">{r.description}</p>}
              {r.ingredients && r.ingredients.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-medium text-slate-500 mb-2">Využité suroviny</p>
                  <div className="flex flex-wrap gap-2">
                    {r.ingredients.map((ing, i) => (
                      <span key={i} className="px-2 py-1 rounded-lg bg-slate-600 text-slate-300 text-sm">
                        {ing}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {r.steps && r.steps.length > 0 && (
                <ol className="list-decimal list-inside space-y-1 text-sm text-slate-300">
                  {r.steps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              )}
            </div>
          ))}
        </div>
        <div className="sticky bottom-0 bg-slate-800 flex gap-3 p-4 border-t border-slate-600">
          <button type="button" onClick={onClose} className="flex-1 py-3 rounded-xl bg-slate-600 text-slate-200 font-medium">
            Zavřít
          </button>
          <button type="button" onClick={onTryAgain} className="flex-1 py-3 rounded-xl bg-blue-500 text-white font-medium hover:bg-blue-600 flex items-center justify-center gap-2">
            <ChefHat className="w-5 h-5" />
            Zkusit znovu
          </button>
        </div>
      </div>
    </div>
  )
}

function ReviewModal({ items, categories, locations, selectedLocation, setSelectedLocation, onUpdate, onRemove, onSave, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-slate-800 rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-xl border border-slate-600">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-white">Zkontrolujte položky</h2>
          <button type="button" onClick={onClose} className="p-2 text-slate-400 hover:text-white rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-slate-400 mb-3">Uložit do lokace:</p>
        <select
          value={selectedLocation}
          onChange={(e) => setSelectedLocation(e.target.value)}
          className="w-full mb-4 px-4 py-2 rounded-xl border border-slate-600 bg-slate-700 text-white"
        >
          {locations.map((loc) => (
            <option key={loc} value={loc}>{loc}</option>
          ))}
        </select>

        <ul className="space-y-3 mb-6">
          {items.map((item, idx) => (
            <li key={idx} className="bg-slate-700/50 rounded-xl p-3 flex flex-wrap items-center gap-2 border border-slate-600">
              <input
                type="text"
                value={item.name || ''}
                onChange={(e) => onUpdate(idx, 'name', e.target.value)}
                placeholder="Název"
                className="flex-1 min-w-[100px] px-3 py-1.5 rounded-lg border border-slate-600 bg-slate-700 text-white text-sm"
              />
              <input
                type="number"
                min="0"
                value={item.amount != null ? String(item.amount).replace('.', ',') : ''}
                onChange={(e) => onUpdate(idx, 'amount', e.target.value)}
                className="w-16 px-2 py-1.5 rounded-lg border border-slate-600 bg-slate-700 text-white text-sm"
              />
              <select
                value={item.unit || 'ks'}
                onChange={(e) => onUpdate(idx, 'unit', e.target.value)}
                className="px-2 py-1.5 rounded-lg border border-slate-600 bg-slate-700 text-white text-sm"
              >
                {UNITS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
              <select
                value={item.category || 'Ostatní'}
                onChange={(e) => onUpdate(idx, 'category', e.target.value)}
                className="px-2 py-1.5 rounded-lg border border-slate-600 bg-slate-700 text-white text-sm"
              >
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <button type="button" onClick={() => onRemove(idx)} className="text-red-400 hover:text-red-300 text-sm">
                Smazat
              </button>
            </li>
          ))}
        </ul>

        <div className="flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 py-3 rounded-xl bg-slate-600 text-slate-200 font-medium">
            Zrušit
          </button>
          <button type="button" onClick={onSave} className="flex-1 py-3 rounded-xl bg-blue-500 text-white font-medium hover:bg-blue-600">
            Uložit vše
          </button>
        </div>
      </div>
    </div>
  )
}

function RecipeImportModal({ items, categories, onUpdate, onRemove, onConfirm, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-slate-800 rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto border border-slate-600">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-white">Položky z receptu</h2>
          <button type="button" onClick={onClose} className="p-2 text-slate-400 hover:text-white rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-sm text-slate-400 mb-3">Upravte položky a potvrďte přidání do nákupního seznamu.</p>
        <ul className="space-y-3 mb-6">
          {items.map((item, idx) => (
            <li key={idx} className="bg-slate-700/50 rounded-xl p-3 flex flex-wrap items-center gap-2 border border-slate-600">
              <input
                type="text"
                value={item.name || ''}
                onChange={(e) => onUpdate(idx, 'name', e.target.value)}
                placeholder="Název"
                className="flex-1 min-w-[100px] px-3 py-1.5 rounded-lg border border-slate-600 bg-slate-700 text-white text-sm"
              />
              <input
                type="text"
                inputMode="decimal"
                value={item.amount != null ? String(item.amount).replace('.', ',') : ''}
                onChange={(e) => onUpdate(idx, 'amount', e.target.value)}
                placeholder="Množství"
                className="w-20 px-2 py-1.5 rounded-lg border border-slate-600 bg-slate-700 text-white text-sm"
              />
              <select
                value={item.unit || 'ks'}
                onChange={(e) => onUpdate(idx, 'unit', e.target.value)}
                className="px-2 py-1.5 rounded-lg border border-slate-600 bg-slate-700 text-white text-sm"
              >
                {['ks', 'g', 'kg', 'ml', 'l'].map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
              <select
                value={item.category || 'Ostatní'}
                onChange={(e) => onUpdate(idx, 'category', e.target.value)}
                className="px-2 py-1.5 rounded-lg border border-slate-600 bg-slate-700 text-white text-sm"
              >
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <button type="button" onClick={() => onRemove(idx)} className="text-red-400 hover:text-red-300 text-sm p-1">
                <Trash2 className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
        <div className="flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 py-3 rounded-xl bg-slate-600 text-slate-200 font-medium">
            Zrušit
          </button>
          <button type="button" onClick={onConfirm} className="flex-1 py-3 rounded-xl bg-blue-500 text-white font-medium hover:bg-blue-600">
            Přidat do seznamu
          </button>
        </div>
      </div>
    </div>
  )
}

function ReceiptReviewModal({ items, locations, onUpdate, onToggleIncluded, onSave, onClose, UNITS }) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-slate-800 rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto border border-slate-600">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-white">Položky z účtenky</h2>
          <button type="button" onClick={onClose} className="p-2 text-slate-400 hover:text-white rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-sm text-slate-400 mb-3">Upravte lokaci (Lednice/Mrazák/Spíž) a zaškrtněte, co chcete přidat.</p>
        <ul className="space-y-3 mb-6">
          {items.map((item, idx) => (
            <li key={idx} className={`rounded-xl p-3 flex flex-wrap items-center gap-2 border ${item.included ? 'bg-slate-700/50 border-slate-600' : 'bg-slate-800 border-slate-700 opacity-70'}`}>
              <input
                type="checkbox"
                checked={!!item.included}
                onChange={() => onToggleIncluded(idx)}
                className="w-5 h-5 rounded border-slate-500 text-blue-500 bg-slate-700 shrink-0"
              />
              <input
                type="text"
                value={item.name || ''}
                onChange={(e) => onUpdate(idx, 'name', e.target.value)}
                placeholder="Název"
                className="flex-1 min-w-[80px] px-3 py-1.5 rounded-lg border border-slate-600 bg-slate-700 text-white text-sm"
              />
              <input
                type="text"
                inputMode="decimal"
                value={item.amount != null ? String(item.amount).replace('.', ',') : ''}
                onChange={(e) => onUpdate(idx, 'amount', e.target.value)}
                className="w-16 px-2 py-1.5 rounded-lg border border-slate-600 bg-slate-700 text-white text-sm"
              />
              <select
                value={item.unit || 'ks'}
                onChange={(e) => onUpdate(idx, 'unit', e.target.value)}
                className="px-2 py-1.5 rounded-lg border border-slate-600 bg-slate-700 text-white text-sm"
              >
                {UNITS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
              <select
                value={item.location || 'Spíž'}
                onChange={(e) => onUpdate(idx, 'location', e.target.value)}
                className="px-2 py-1.5 rounded-lg border border-slate-600 bg-slate-700 text-white text-sm"
              >
                {locations.map((loc) => (
                  <option key={loc} value={loc}>{loc}</option>
                ))}
              </select>
            </li>
          ))}
        </ul>
        <div className="flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 py-3 rounded-xl bg-slate-600 text-slate-200 font-medium">
            Zrušit
          </button>
          <button type="button" onClick={onSave} className="flex-1 py-3 rounded-xl bg-blue-500 text-white font-medium hover:bg-blue-600">
            Uložit do inventáře
          </button>
        </div>
      </div>
    </div>
  )
}
