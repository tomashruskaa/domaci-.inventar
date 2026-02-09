import { useState, useEffect } from 'react'
import { initializeApp } from 'firebase/app'
import { getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, query, where, onSnapshot } from 'firebase/firestore'
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth'
import { ShoppingBag, Warehouse, PieChart, Camera, X, Plus, Pencil, ShoppingCart } from 'lucide-react'

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

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || 'AIzaSyCYnLRNdA8C3Krr2F0QyuaqPo1H2tHvlRY'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

async function callGeminiForImage(imageBase64, retries = 3) {
  const prompt = `Analyzuj tuto fotku potravin nebo zásob (lednice, nákup). Vrať POUZE validní JSON pole objektů bez markdown a bez dalšího textu.
Každý objekt musí mít přesně: name (název v češtině), amount (číslo), unit (jedna z: ks, g, kg, ml, l), category (přesně jedna z: Chlazené, Pečivo, Zelenina & Ovoce, Maso, Ostatní).
Příklad: [{"name":"Mléko","amount":500,"unit":"ml","category":"Chlazené"},{"name":"Chléb","amount":1,"unit":"ks","category":"Pečivo"}]`

  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } }
            ]
          }]
        })
      })
      if (!res.ok) throw new Error(`API ${res.status}`)
      const data = await res.json()
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text
      if (!text) throw new Error('Prázdná odpověď')
      const match = text.match(/\[[\s\S]*\]/)
      const parsed = match ? JSON.parse(match[0]) : []
      return Array.isArray(parsed) ? parsed : []
    } catch (e) {
      console.warn(`Gemini pokus ${i + 1}`, e)
      if (i < retries - 1) await delay(2 ** i * 1000)
      else throw e
    }
  }
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

  const addToShopping = async (name, amount, category) => {
    try {
      await addDoc(collection(db, 'items'), {
        appId: APP_ID,
        name: name || 'Položka',
        amount: Number(amount) || 1,
        unit: 'ks',
        category: category || 'Ostatní',
        status: 'shopping',
        isBought: false
      })
    } catch (e) {
      console.error(e)
      alert('Nepodařilo se přidat položku.')
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

  const handlePhoto = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setAiLoading(true)
    const reader = new FileReader()
    reader.onloadend = async () => {
      try {
        const base64 = reader.result.split(',')[1]
        const list = await callGeminiForImage(base64)
        setReviewItems(list.length ? list : [{ name: 'Neznámý', amount: 1, unit: 'ks', category: 'Ostatní' }])
        setShowReviewModal(true)
      } catch (err) {
        alert('Analýza fotky selhala. Zkuste to znovu.')
      } finally {
        setAiLoading(false)
      }
    }
    reader.readAsDataURL(file)
  }

  const saveReviewToHome = async () => {
    const location = selectedLocation
    for (const it of reviewItems) {
      await addDoc(collection(db, 'items'), {
        appId: APP_ID,
        name: it.name || 'Položka',
        amount: Number(it.amount) || 1,
        unit: ['ks', 'g', 'kg', 'ml', 'l'].includes(it.unit) ? it.unit : 'ks',
        category: CATEGORIES.includes(it.category) ? it.category : 'Ostatní',
        status: 'home',
        location
      })
    }
    setShowReviewModal(false)
    setReviewItems([])
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <span className="text-gray-500">Načítání…</span>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col md:flex-row">
      {/* Navigace: desktop = boční, mobil = horní */}
      <nav className="flex md:flex-col md:w-52 md:min-h-screen bg-white border-b md:border-b-0 md:border-r border-gray-200 shrink-0">
        <div className="flex md:flex-col w-full">
          {[
            { id: 'shopping', label: 'Nákupní seznam', Icon: ShoppingBag },
            { id: 'home', label: 'Co mám doma', Icon: Warehouse },
            { id: 'stats', label: 'Přehled', Icon: PieChart }
          ].map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setActiveSection(id)}
              className={`flex items-center justify-center gap-2 md:justify-start md:px-6 py-4 text-sm font-medium transition-colors border-b md:border-b-0 md:border-r border-transparent ${
                activeSection === id
                  ? 'bg-blue-50 text-blue-600 border-blue-200'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Icon className="w-5 h-5 shrink-0" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </nav>

      <main className="flex-1 p-4 md:p-6 lg:p-8 pb-24 md:pb-8">
        {activeSection === 'shopping' && (
          <ShoppingSection
            categories={CATEGORIES}
            shoppingByCategory={shoppingByCategory}
            boughtItems={boughtItems}
            addToShopping={addToShopping}
            setBought={setBought}
            deleteItem={deleteItem}
          />
        )}
        {activeSection === 'home' && (
          <HomeSection
            locations={LOCATIONS}
            selectedLocation={selectedLocation}
            setSelectedLocation={setSelectedLocation}
            homeByLocation={homeByLocation}
            onScan={handlePhoto}
            aiLoading={aiLoading}
            editingId={editingId}
            editName={editName}
            editAmount={editAmount}
            setEditingId={setEditingId}
            setEditName={setEditName}
            setEditAmount={setEditAmount}
            updateItem={updateItem}
            moveToShopping={moveToShopping}
            deleteItem={deleteItem}
          />
        )}
        {activeSection === 'stats' && <StatsSection />}
      </main>

      {/* Mobil: spodní tab bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-white border-t border-gray-200 flex justify-around items-center z-30 safe-area-pb">
        {[
          { id: 'shopping', Icon: ShoppingBag },
          { id: 'home', Icon: Warehouse },
          { id: 'stats', Icon: PieChart }
        ].map(({ id, Icon }) => (
          <button
            key={id}
            onClick={() => setActiveSection(id)}
            className={`p-3 rounded-xl transition-colors ${activeSection === id ? 'text-blue-600 bg-blue-50' : 'text-gray-400'}`}
          >
            <Icon className="w-6 h-6" />
          </button>
        ))}
      </div>

      {/* AI loading */}
      {aiLoading && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl px-8 py-6 shadow-xl text-center">
            <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-gray-700 font-medium">AI analyzuje fotku…</p>
          </div>
        </div>
      )}

      {/* Review modal */}
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
    </div>
  )
}

function ShoppingSection({ categories, shoppingByCategory, boughtItems, addToShopping, setBought, deleteItem }) {
  const [name, setName] = useState('')
  const [amount, setAmount] = useState(1)
  const [category, setCategory] = useState('Ostatní')
  const [showForm, setShowForm] = useState(false)

  const submit = (e) => {
    e.preventDefault()
    if (!name.trim()) return
    addToShopping(name.trim(), amount, category)
    setName('')
    setAmount(1)
    setCategory('Ostatní')
    setShowForm(false)
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Nákupní seznam</h1>

      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-blue-500 text-white font-medium hover:bg-blue-600 transition-colors"
        >
          <Plus className="w-5 h-5" />
          Přidat položku
        </button>
      ) : (
        <form onSubmit={submit} className="bg-white rounded-2xl p-4 md:p-5 shadow-sm space-y-4">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Název"
            className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              type="number"
              min="1"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value) || 1)}
              className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-2 rounded-xl bg-gray-100 text-gray-700 font-medium">
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
          <section key={cat} className="bg-white rounded-2xl p-4 md:p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">{cat}</h2>
            <ul className="space-y-2">
              {catItems.map((item) => (
                <li key={item.id} className="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0">
                  <input
                    type="checkbox"
                    checked={false}
                    onChange={() => setBought(item.id, true)}
                    className="w-5 h-5 rounded border-gray-300 text-blue-500"
                  />
                  <span className="flex-1 font-medium text-gray-900">{item.name}</span>
                  <span className="text-sm text-gray-500">{item.amount} {item.unit}</span>
                  <button type="button" onClick={() => deleteItem(item.id)} className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg">
                    <X className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null
      )}

      {boughtItems.length > 0 && (
        <section className="bg-gray-100 rounded-2xl p-4 md:p-5">
          <h2 className="text-lg font-semibold text-gray-700 mb-3">Koupeno</h2>
          <ul className="space-y-2">
            {boughtItems.map((item) => (
              <li key={item.id} className="flex items-center gap-3 py-2 border-b border-gray-200 last:border-0 opacity-80">
                <input
                  type="checkbox"
                  checked
                  onChange={() => setBought(item.id, false)}
                  className="w-5 h-5 rounded border-gray-300 text-blue-500"
                />
                <span className="flex-1 font-medium text-gray-600 line-through">{item.name}</span>
                <span className="text-sm text-gray-500">{item.amount} {item.unit}</span>
                <button type="button" onClick={() => deleteItem(item.id)} className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg">
                  <X className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {shoppingByCategory.every((s) => s.items.length === 0) && boughtItems.length === 0 && (
        <p className="text-center text-gray-500 py-8">Nákupní seznam je prázdný.</p>
      )}
    </div>
  )
}

function HomeSection({
  locations,
  selectedLocation,
  setSelectedLocation,
  homeByLocation,
  onScan,
  aiLoading,
  editingId,
  editName,
  editAmount,
  setEditingId,
  setEditName,
  setEditAmount,
  updateItem,
  moveToShopping,
  deleteItem
}) {
  const list = homeByLocation(selectedLocation)

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Co mám doma</h1>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {locations.map((loc) => (
          <button
            key={loc}
            onClick={() => setSelectedLocation(loc)}
            className={`px-4 py-2 rounded-xl font-medium whitespace-nowrap transition-colors ${
              selectedLocation === loc ? 'bg-blue-500 text-white' : 'bg-white text-gray-600 border border-gray-200'
            }`}
          >
            {loc}
          </button>
        ))}
      </div>

      <label className="flex items-center justify-center gap-2 w-full py-3 rounded-2xl bg-blue-500 text-white font-medium hover:bg-blue-600 transition-colors cursor-pointer">
        <Camera className="w-5 h-5" />
        Skenovat lednici / nákup
        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onScan} disabled={aiLoading} />
      </label>

      <section className="bg-white rounded-2xl p-4 md:p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">{selectedLocation}</h2>
        {list.length === 0 ? (
          <p className="text-gray-500 py-4">Žádné položky.</p>
        ) : (
          <ul className="space-y-2">
            {list.map((item) => (
              <li key={item.id} className="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0">
                {editingId === item.id ? (
                  <>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="flex-1 px-3 py-1.5 rounded-lg border border-gray-200 text-sm"
                    />
                    <input
                      type="number"
                      min="0"
                      value={editAmount}
                      onChange={(e) => setEditAmount(Number(e.target.value) || 0)}
                      className="w-20 px-2 py-1.5 rounded-lg border border-gray-200 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => updateItem(item.id, { name: editName, amount: editAmount })}
                      className="text-blue-600 font-medium text-sm"
                    >
                      Uložit
                    </button>
                    <button type="button" onClick={() => setEditingId(null)} className="text-gray-500 text-sm">
                      Zrušit
                    </button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 font-medium text-gray-900">{item.name}</span>
                    <span className="text-sm text-gray-500">{item.amount} {item.unit}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(item.id)
                        setEditName(item.name || '')
                        setEditAmount(item.amount ?? 0)
                      }}
                      className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"
                      title="Upravit"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveToShopping(item)}
                      className="p-2 text-green-600 hover:bg-green-50 rounded-lg"
                      title="Přidat do nákupního seznamu"
                    >
                      <ShoppingCart className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => deleteItem(item.id)} className="p-2 text-gray-400 hover:text-red-50 rounded-lg">
                      <X className="w-4 h-4" />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function StatsSection() {
  const data = [
    { name: 'Potraviny', value: 1500, color: '#3b82f6' },
    { name: 'Nápoje', value: 800, color: '#10b981' },
    { name: 'Drogerie', value: 500, color: '#f59e0b' },
    { name: 'Ostatní', value: 200, color: '#ef4444' }
  ]
  const total = data.reduce((s, i) => s + i.value, 0)
  let cum = 0
  const gradient = data.map((i) => {
    const p = total ? (i.value / total) * 100 : 0
    const start = cum
    cum += p
    return `${i.color} ${start}% ${cum}%`
  }).join(', ')

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Přehled</h1>

      <div className="bg-white rounded-2xl p-6 shadow-sm">
        <p className="text-lg font-semibold text-gray-900 mb-2">
          Odhadovaná útrata tento měsíc: <span className="text-blue-600">3 000 Kč</span>
        </p>
        <p className="text-sm text-gray-500 mb-6">Rozdělení podle kategorií (mockup)</p>

        <div className="flex flex-col sm:flex-row items-center gap-6">
          <div
            className="w-40 h-40 sm:w-48 sm:h-48 rounded-full border-4 border-white shadow-md flex-shrink-0"
            style={{ background: `conic-gradient(${gradient})` }}
          />
          <div className="flex-1 w-full space-y-2">
            {data.map((d, i) => (
              <div key={i} className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                  <span className="text-gray-700">{d.name}</span>
                </div>
                <span className="font-medium text-gray-900">{d.value} Kč</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function ReviewModal({ items, categories, locations, selectedLocation, setSelectedLocation, onUpdate, onRemove, onSave, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-xl">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-gray-900">Zkontrolujte položky</h2>
          <button type="button" onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-gray-500 mb-3">Uložit do lokace:</p>
        <select
          value={selectedLocation}
          onChange={(e) => setSelectedLocation(e.target.value)}
          className="w-full mb-4 px-4 py-2 rounded-xl border border-gray-200"
        >
          {locations.map((loc) => (
            <option key={loc} value={loc}>{loc}</option>
          ))}
        </select>

        <ul className="space-y-3 mb-6">
          {items.map((item, idx) => (
            <li key={idx} className="bg-gray-50 rounded-xl p-3 flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={item.name || ''}
                onChange={(e) => onUpdate(idx, 'name', e.target.value)}
                placeholder="Název"
                className="flex-1 min-w-[100px] px-3 py-1.5 rounded-lg border border-gray-200 text-sm"
              />
              <input
                type="number"
                min="0"
                value={item.amount ?? ''}
                onChange={(e) => onUpdate(idx, 'amount', e.target.value)}
                className="w-16 px-2 py-1.5 rounded-lg border border-gray-200 text-sm"
              />
              <select
                value={item.unit || 'ks'}
                onChange={(e) => onUpdate(idx, 'unit', e.target.value)}
                className="px-2 py-1.5 rounded-lg border border-gray-200 text-sm"
              >
                {UNITS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
              <select
                value={item.category || 'Ostatní'}
                onChange={(e) => onUpdate(idx, 'category', e.target.value)}
                className="px-2 py-1.5 rounded-lg border border-gray-200 text-sm"
              >
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <button type="button" onClick={() => onRemove(idx)} className="text-red-500 hover:text-red-700 text-sm">
                Smazat
              </button>
            </li>
          ))}
        </ul>

        <div className="flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-700 font-medium">
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
