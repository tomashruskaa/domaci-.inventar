# Moje Spíž & Lednice

PWA aplikace pro správu domácích zásob s AI skenováním pomocí Google Gemini API.

## Funkce

- 📊 **Dashboard** - Přehled expirujících a prošlých položek
- 📦 **Inventář** - Správa zásob podle lokací (Lednice, Mrazák, Spíž, Koupelna)
- 🛒 **Nákupní seznam** - Seznam s automatickým přidáváním do inventáře
- 🤖 **AI Skenování** - Analýza fotek pomocí Google Gemini API

## Instalace

1. Nainstalujte závislosti:
```bash
npm install
```

2. Vytvořte soubor `.env` v kořenovém adresáři (nebo zkopírujte `.env.example`):
```bash
cp .env.example .env
```

Aplikace má výchozí hodnoty v kódu, takže bude fungovat i bez `.env` souboru. Pro produkci však doporučuji použít `.env` soubor s vašimi hodnotami.

3. Spusťte vývojový server:
```bash
npm run dev
```

## Nastavení Firebase

1. Vytvořte nový projekt na [Firebase Console](https://console.firebase.google.com/)
2. Povolte **Anonymous Authentication** v Authentication > Sign-in method
3. Vytvořte Firestore databázi v režimu testování
4. Zkopírujte konfigurační hodnoty do `.env` souboru

## Nastavení Google Gemini API

1. Získejte API klíč z [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Přidejte klíč do `.env` souboru jako `VITE_GEMINI_API_KEY`

## Build pro produkci

```bash
npm run build
```

Výstup bude v `dist/` složce, připravený pro nasazení na Vercel nebo jinou platformu.

## PWA Ikony

Pro plnou PWA funkcionalitu je potřeba přidat ikony do `public/` složky:
- `pwa-192x192.png` (192x192 px)
- `pwa-512x512.png` (512x512 px)
- `apple-touch-icon.png` (180x180 px)
- `mask-icon.svg` (pro Safari)

Ikony můžete vygenerovat pomocí nástrojů jako [PWA Asset Generator](https://github.com/onderceylan/pwa-asset-generator).

## Nasazení na Vercel

1. Pushněte kód do Git repozitáře
2. Připojte repozitář k Vercel
3. Přidejte všechny proměnné prostředí z `.env` do Vercel projektu
4. Deploy!

## Struktura dat Firestore

### Kolekce: `items`
```javascript
{
  appId: 'moje-spiz-lednice-v1',
  name: 'Mléko',
  quantity: 500,
  unit: 'ml',
  location: 'Lednice',
  expiryDate: Timestamp, // volitelné
  createdAt: Timestamp
}
```

### Kolekce: `shoppingList`
```javascript
{
  appId: 'moje-spiz-lednice-v1',
  name: 'Chléb',
  completed: false,
  createdAt: Timestamp
}
```

## Technologie

- React 18
- Vite
- Tailwind CSS
- Firebase (Firestore, Anonymous Auth)
- Google Gemini API
- Lucide React (ikony)
- PWA support
