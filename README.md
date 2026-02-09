# Moje Spíž & Lednice

PWA aplikace pro správu domácích zásob s AI skenováním pomocí Google Gemini API.

## Funkce

- 🛒 **Nákupní seznam** - Správa nákupů s kategoriemi (Chlazené, Pečivo, Zelenina & Ovoce, Maso, Ostatní), checkbox pro odškrtnutí a sekce "Koupeno"
- 📦 **Co mám doma** - Zásoby podle lokací (Lednice, Mrazák, Spíž), AI skenování, abecední řazení, inline editace, přesun do nákupního seznamu
- 📊 **Statistiky** - Přehled měsíční útraty s koláčovým grafem
- 🤖 **AI Skenování** - Analýza fotek pomocí Google Gemini API (pouze v sekci Inventář)

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
Jedna kolekce pro všechny položky. Pole: `name`, `amount`, `unit`, `category`, `status`, `location`, `isBought`, `appId`.

**Položka v nákupním seznamu** (`status: 'shopping'`):
```javascript
{
  appId: 'domaci-inventar-v1',
  name: 'Chléb',
  amount: 1,
  unit: 'ks',
  category: 'Pečivo', // Chlazené, Pečivo, Zelenina & Ovoce, Maso, Ostatní
  status: 'shopping',
  isBought: false
}
```

**Položka doma** (`status: 'home'`):
```javascript
{
  appId: 'domaci-inventar-v1',
  name: 'Mléko',
  amount: 500,
  unit: 'ml',
  category: 'Chlazené',
  status: 'home',
  location: 'Lednice'  // Lednice, Mrazák, Spíž
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
