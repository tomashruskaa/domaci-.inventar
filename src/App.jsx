import { useState, useEffect } from 'react'
import { initializeApp } from 'firebase/app'
import { getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, query, where, getDocs, onSnapshot } from 'firebase/firestore'
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth'
import { Camera, Home, ShoppingCart, Package, X, Plus, Minus, Check, AlertCircle, Clock } from 'lucide-react'

// Firebase konfigurace
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

const APP_ID = 'moje-spiz-lednice-v1'
const LOCATIONS = ['Lednice', 'Mrazák', 'Spíž', 'Koupelna']
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || 'AIzaSyCYnLRNdA8C3Krr2F0QyuaqPo1H2tHvlRY'
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${GEMINI_API_KEY}`

// Exponential backoff pro retries
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))

async function callGeminiAPI(imageBase64, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(GEMINI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `Analyzuj tuto fotku potravin nebo zásob v lednici/spíži. Vypiš všechny položky, které vidíš. Pro každou položku uveď:
- Název produktu (v češtině)
- Odhadované množství (číslo)
- Jednotku (ks, g, ml, kg, l)
- Navrhovanou lokaci (Lednice, Mrazák, Spíž, nebo Koupelna)

Formátuj odpověď jako JSON pole objektů s klíči: name, quantity, unit, location.
Příklad: [{"name": "Mléko", "quantity": 500, "unit": "ml", "location": "Lednice"}, {"name": "Chléb", "quantity": 1, "unit": "ks", "location": "Spíž"}]

Pokud něco není jasné, odhadni rozumně.`
            }, {
              inline_data: {
                mime_type: "image/jpeg",
                data: imageBase64
              }
            }]
          }]
        })
      })

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const data = await response.json()
      
      if (data.candidates && data.candidates[0] && data.candidates[0].content) {
        const text = data.candidates[0].content.parts[0].text
        // Pokusíme se extrahovat JSON z odpovědi
        const jsonMatch = text.match(/\[[\s\S]*\]/)
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0])
        }
        // Fallback: pokud není JSON, zkusíme parsovat text
        return parseTextResponse(text)
      }
      
      throw new Error('No valid response from API')
    } catch (error) {
      console.error(`Attempt ${i + 1} failed:`, error)
      if (i < retries - 1) {
        await delay(Math.pow(2, i) * 1000) // Exponential backoff
      } else {
        throw error
      }
    }
  }
}

function parseTextResponse(text) {
  // Fallback parser pro případ, že API nevrátí JSON
  const items = []
  const lines = text.split('\n').filter(line => line.trim())
  
  for (const line of lines) {
    const nameMatch = line.match(/(?:název|name|produkt)[:\s]+([^,]+)/i)
    const quantityMatch = line.match(/(?:množství|quantity)[:\s]+(\d+)/i)
    const unitMatch = line.match(/(?:jednotka|unit)[:\s]+(ks|g|ml|kg|l)/i)
    const locationMatch = line.match(/(?:lokace|location)[:\s]+(Lednice|Mrazák|Spíž|Koupelna)/i)
    
    if (nameMatch) {
      items.push({
        name: nameMatch[1].trim(),
        quantity: quantityMatch ? parseInt(quantityMatch[1]) : 1,
        unit: unitMatch ? unitMatch[1] : 'ks',
        location: locationMatch ? locationMatch[1] : 'Lednice'
      })
    }
  }
  
  return items.length > 0 ? items : [{ name: 'Neznámý produkt', quantity: 1, unit: 'ks', location: 'Lednice' }]
}

function App() {
  const [user, setUser] = useState(null)
  const [activeTab, setActiveTab] = useState('dashboard')
  const [items, setItems] = useState([])
  const [shoppingList, setShoppingList] = useState([])
  const [loading, setLoading] = useState(true)
  const [aiLoading, setAiLoading] = useState(false)
  const [reviewItems, setReviewItems] = useState([])
  const [showReviewModal, setShowReviewModal] = useState(false)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setUser(user)
      } else {
        try {
          await signInAnonymously(auth)
        } catch (error) {
          console.error('Auth error:', error)
        }
      }
    })

    return () => unsubscribe()
  }, [])

  useEffect(() => {
    if (!user) return

    setLoading(true)

    // Načíst items
    const itemsQuery = query(
      collection(db, 'items'),
      where('appId', '==', APP_ID)
    )
    
    const unsubscribeItems = onSnapshot(itemsQuery, (snapshot) => {
      const itemsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }))
      setItems(itemsData)
      setLoading(false)
    }, (error) => {
      console.error('Error loading items:', error)
      setLoading(false)
    })

    // Načíst shopping list
    const shoppingQuery = query(
      collection(db, 'shoppingList'),
      where('appId', '==', APP_ID)
    )
    
    const unsubscribeShopping = onSnapshot(shoppingQuery, (snapshot) => {
      const shoppingData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }))
      setShoppingList(shoppingData)
    }, (error) => {
      console.error('Error loading shopping list:', error)
    })

    return () => {
      unsubscribeItems()
      unsubscribeShopping()
    }
  }, [user])

  const addItem = async (item) => {
    try {
      await addDoc(collection(db, 'items'), {
        ...item,
        appId: APP_ID,
        createdAt: new Date()
      })
    } catch (error) {
      console.error('Error adding item:', error)
      alert('Chyba při přidávání položky')
    }
  }

  const updateItemQuantity = async (id, change) => {
    const item = items.find(i => i.id === id)
    if (!item) return
    
    const newQuantity = Math.max(0, (item.quantity || 0) + change)
    
    if (newQuantity === 0) {
      await deleteItem(id)
    } else {
      try {
        await updateDoc(doc(db, 'items', id), {
          quantity: newQuantity
        })
      } catch (error) {
        console.error('Error updating item:', error)
      }
    }
  }

  const deleteItem = async (id) => {
    try {
      await deleteDoc(doc(db, 'items', id))
    } catch (error) {
      console.error('Error deleting item:', error)
    }
  }

  const addShoppingItem = async (name) => {
    try {
      await addDoc(collection(db, 'shoppingList'), {
        name,
        completed: false,
        appId: APP_ID,
        createdAt: new Date()
      })
    } catch (error) {
      console.error('Error adding shopping item:', error)
    }
  }

  const completeShoppingItem = async (shoppingItem) => {
    try {
      // Přidat do inventáře
      await addItem({
        name: shoppingItem.name,
        quantity: 1,
        unit: 'ks',
        location: 'Lednice'
      })
      
      // Smazat z nákupního seznamu
      await deleteDoc(doc(db, 'shoppingList', shoppingItem.id))
    } catch (error) {
      console.error('Error completing shopping item:', error)
    }
  }

  const deleteShoppingItem = async (id) => {
    try {
      await deleteDoc(doc(db, 'shoppingList', id))
    } catch (error) {
      console.error('Error deleting shopping item:', error)
    }
  }

  const handleImageUpload = async (event) => {
    const file = event.target.files[0]
    if (!file) return

    setAiLoading(true)
    
    try {
      const reader = new FileReader()
      reader.onloadend = async () => {
        const base64 = reader.result.split(',')[1]
        
        try {
          const detectedItems = await callGeminiAPI(base64)
          setReviewItems(detectedItems)
          setShowReviewModal(true)
          setAiLoading(false)
        } catch (error) {
          console.error('AI error:', error)
          alert('Chyba při analýze fotky. Zkuste to znovu.')
          setAiLoading(false)
        }
      }
      reader.readAsDataURL(file)
    } catch (error) {
      console.error('Upload error:', error)
      setAiLoading(false)
    }
  }

  const saveReviewItems = async () => {
    for (const item of reviewItems) {
      await addItem({
        name: item.name,
        quantity: item.quantity || 1,
        unit: item.unit || 'ks',
        location: item.location || 'Lednice',
        expiryDate: item.expiryDate || null
      })
    }
    setShowReviewModal(false)
    setReviewItems([])
  }

  const updateReviewItem = (index, field, value) => {
    const updated = [...reviewItems]
    updated[index] = { ...updated[index], [field]: value }
    setReviewItems(updated)
  }

  const deleteReviewItem = (index) => {
    setReviewItems(reviewItems.filter((_, i) => i !== index))
  }

  const getExpiringItems = () => {
    const now = new Date()
    const threeDays = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)
    
    return items.filter(item => {
      if (!item.expiryDate) return false
      const expiry = item.expiryDate.toDate ? item.expiryDate.toDate() : new Date(item.expiryDate)
      return expiry <= threeDays
    })
  }

  const getExpiredItems = () => {
    const now = new Date()
    return items.filter(item => {
      if (!item.expiryDate) return false
      const expiry = item.expiryDate.toDate ? item.expiryDate.toDate() : new Date(item.expiryDate)
      return expiry < now
    })
  }

  const getItemsByLocation = (location) => {
    return items.filter(item => item.location === location)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500">Načítání...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-4 py-6">
        {activeTab === 'dashboard' && (
          <DashboardView
            expiringItems={getExpiringItems()}
            expiredItems={getExpiredItems()}
            shoppingList={shoppingList}
          />
        )}
        
        {activeTab === 'inventory' && (
          <InventoryView
            items={items}
            locations={LOCATIONS}
            getItemsByLocation={getItemsByLocation}
            updateItemQuantity={updateItemQuantity}
            deleteItem={deleteItem}
          />
        )}
        
        {activeTab === 'shopping' && (
          <ShoppingListView
            shoppingList={shoppingList}
            addShoppingItem={addShoppingItem}
            completeShoppingItem={completeShoppingItem}
            deleteShoppingItem={deleteShoppingItem}
          />
        )}
      </div>

      {/* AI Camera Button */}
      <div className="fixed bottom-24 right-4 z-40">
        <label className="bg-blue-500 hover:bg-blue-600 text-white rounded-full p-4 shadow-lg cursor-pointer flex items-center justify-center transition-colors">
          <Camera className="w-6 h-6" />
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleImageUpload}
            disabled={aiLoading}
          />
        </label>
      </div>

      {/* AI Loading Overlay */}
      {aiLoading && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-3xl p-8 shadow-xl">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
              <p className="text-gray-700 font-medium">Načítání (AI analyzuje...)</p>
            </div>
          </div>
        </div>
      )}

      {/* Review Modal */}
      {showReviewModal && (
        <ReviewModal
          items={reviewItems}
          locations={LOCATIONS}
          onUpdate={updateReviewItem}
          onDelete={deleteReviewItem}
          onSave={saveReviewItems}
          onClose={() => setShowReviewModal(false)}
        />
      )}

      {/* Bottom Navigation */}
      <BottomNav activeTab={activeTab} setActiveTab={setActiveTab} />
    </div>
  )
}

function DashboardView({ expiringItems, expiredItems, shoppingList }) {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
      
      {/* Expired Items */}
      {expiredItems.length > 0 && (
        <div className="bg-red-50 border-2 border-red-200 rounded-3xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <AlertCircle className="w-6 h-6 text-red-600" />
            <h2 className="text-xl font-semibold text-red-900">Prošlé položky</h2>
          </div>
          <div className="space-y-2">
            {expiredItems.map(item => (
              <div key={item.id} className="bg-white rounded-2xl p-4 flex justify-between items-center">
                <div>
                  <p className="font-medium text-gray-900">{item.name}</p>
                  <p className="text-sm text-gray-500">{item.location}</p>
                </div>
                <span className="text-red-600 font-medium">
                  {item.quantity} {item.unit}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Expiring Items */}
      {expiringItems.length > 0 && (
        <div className="bg-orange-50 border-2 border-orange-200 rounded-3xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-6 h-6 text-orange-600" />
            <h2 className="text-xl font-semibold text-orange-900">Brzy expiruje (do 3 dnů)</h2>
          </div>
          <div className="space-y-2">
            {expiringItems.map(item => (
              <div key={item.id} className="bg-white rounded-2xl p-4 flex justify-between items-center">
                <div>
                  <p className="font-medium text-gray-900">{item.name}</p>
                  <p className="text-sm text-gray-500">{item.location}</p>
                </div>
                <span className="text-orange-600 font-medium">
                  {item.quantity} {item.unit}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Shopping List Preview */}
      <div className="bg-white rounded-3xl p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Nákupní seznam</h2>
        {shoppingList.length === 0 ? (
          <p className="text-gray-500">Žádné položky</p>
        ) : (
          <div className="space-y-2">
            {shoppingList.slice(0, 5).map(item => (
              <div key={item.id} className="flex items-center gap-2 text-gray-700">
                <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                <span>{item.name}</span>
              </div>
            ))}
            {shoppingList.length > 5 && (
              <p className="text-sm text-gray-500 mt-2">+ {shoppingList.length - 5} dalších</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function InventoryView({ items, locations, getItemsByLocation, updateItemQuantity, deleteItem }) {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-gray-900">Inventář</h1>
      
      {locations.map(location => {
        const locationItems = getItemsByLocation(location)
        return (
          <div key={location} className="bg-white rounded-3xl p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">{location}</h2>
            {locationItems.length === 0 ? (
              <p className="text-gray-500">Žádné položky</p>
            ) : (
              <div className="space-y-2">
                {locationItems.map(item => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    onIncrease={() => updateItemQuantity(item.id, 1)}
                    onDecrease={() => updateItemQuantity(item.id, -1)}
                    onDelete={() => deleteItem(item.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ItemCard({ item, onIncrease, onDecrease, onDelete }) {
  return (
    <div className="bg-gray-50 rounded-2xl p-4 flex items-center justify-between">
      <div className="flex-1">
        <p className="font-medium text-gray-900">{item.name}</p>
        <p className="text-sm text-gray-500">
          {item.quantity} {item.unit}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onDecrease}
          className="bg-white rounded-xl p-2 hover:bg-gray-100 transition-colors"
        >
          <Minus className="w-4 h-4 text-gray-700" />
        </button>
        <button
          onClick={onIncrease}
          className="bg-white rounded-xl p-2 hover:bg-gray-100 transition-colors"
        >
          <Plus className="w-4 h-4 text-gray-700" />
        </button>
        <button
          onClick={onDelete}
          className="bg-red-50 rounded-xl p-2 hover:bg-red-100 transition-colors"
        >
          <X className="w-4 h-4 text-red-600" />
        </button>
      </div>
    </div>
  )
}

function ShoppingListView({ shoppingList, addShoppingItem, completeShoppingItem, deleteShoppingItem }) {
  const [newItem, setNewItem] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (newItem.trim()) {
      addShoppingItem(newItem.trim())
      setNewItem('')
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-gray-900">Nákupní seznam</h1>
      
      <form onSubmit={handleSubmit} className="bg-white rounded-3xl p-4 shadow-sm flex gap-2">
        <input
          type="text"
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          placeholder="Přidat položku..."
          className="flex-1 px-4 py-2 rounded-2xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          className="bg-blue-500 text-white rounded-2xl px-6 py-2 hover:bg-blue-600 transition-colors"
        >
          Přidat
        </button>
      </form>

      <div className="space-y-2">
        {shoppingList.length === 0 ? (
          <div className="bg-white rounded-3xl p-8 text-center">
            <p className="text-gray-500">Nákupní seznam je prázdný</p>
          </div>
        ) : (
          shoppingList.map(item => (
            <div
              key={item.id}
              className="bg-white rounded-2xl p-4 flex items-center justify-between shadow-sm"
            >
              <span className="text-gray-900 font-medium">{item.name}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => completeShoppingItem(item)}
                  className="bg-green-50 rounded-xl p-2 hover:bg-green-100 transition-colors"
                  title="Označit jako splněné"
                >
                  <Check className="w-5 h-5 text-green-600" />
                </button>
                <button
                  onClick={() => deleteShoppingItem(item.id)}
                  className="bg-red-50 rounded-xl p-2 hover:bg-red-100 transition-colors"
                >
                  <X className="w-5 h-5 text-red-600" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function ReviewModal({ items, locations, onUpdate, onDelete, onSave, onClose }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-xl">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-900">Zkontrolujte detekované položky</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="space-y-4 mb-6">
          {items.map((item, index) => (
            <div key={index} className="bg-gray-50 rounded-2xl p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Název
                  </label>
                  <input
                    type="text"
                    value={item.name || ''}
                    onChange={(e) => onUpdate(index, 'name', e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Množství
                  </label>
                  <input
                    type="number"
                    value={item.quantity || 1}
                    onChange={(e) => onUpdate(index, 'quantity', parseInt(e.target.value) || 1)}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Jednotka
                  </label>
                  <select
                    value={item.unit || 'ks'}
                    onChange={(e) => onUpdate(index, 'unit', e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="ks">ks</option>
                    <option value="g">g</option>
                    <option value="kg">kg</option>
                    <option value="ml">ml</option>
                    <option value="l">l</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Lokace
                  </label>
                  <select
                    value={item.location || 'Lednice'}
                    onChange={(e) => onUpdate(index, 'location', e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {locations.map(loc => (
                      <option key={loc} value={loc}>{loc}</option>
                    ))}
                  </select>
                </div>
              </div>
              <button
                onClick={() => onDelete(index)}
                className="mt-3 text-red-600 hover:text-red-700 text-sm font-medium"
              >
                Smazat řádek
              </button>
            </div>
          ))}
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 bg-gray-100 text-gray-700 rounded-2xl py-3 font-medium hover:bg-gray-200 transition-colors"
          >
            Zrušit
          </button>
          <button
            onClick={onSave}
            className="flex-1 bg-blue-500 text-white rounded-2xl py-3 font-medium hover:bg-blue-600 transition-colors"
          >
            Uložit vše
          </button>
        </div>
      </div>
    </div>
  )
}

function BottomNav({ activeTab, setActiveTab }) {
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg z-30">
      <div className="max-w-4xl mx-auto flex justify-around items-center h-16">
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`flex flex-col items-center gap-1 px-4 py-2 rounded-2xl transition-colors ${
            activeTab === 'dashboard' ? 'text-blue-500' : 'text-gray-400'
          }`}
        >
          <Home className="w-6 h-6" />
          <span className="text-xs font-medium">Dashboard</span>
        </button>
        <button
          onClick={() => setActiveTab('inventory')}
          className={`flex flex-col items-center gap-1 px-4 py-2 rounded-2xl transition-colors ${
            activeTab === 'inventory' ? 'text-blue-500' : 'text-gray-400'
          }`}
        >
          <Package className="w-6 h-6" />
          <span className="text-xs font-medium">Inventář</span>
        </button>
        <button
          onClick={() => setActiveTab('shopping')}
          className={`flex flex-col items-center gap-1 px-4 py-2 rounded-2xl transition-colors ${
            activeTab === 'shopping' ? 'text-blue-500' : 'text-gray-400'
          }`}
        >
          <ShoppingCart className="w-6 h-6" />
          <span className="text-xs font-medium">Nákup</span>
        </button>
      </div>
    </div>
  )
}

export default App
