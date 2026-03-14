# Bezpečnost a proměnné prostředí

## Nastavení lokálního vývoje

**Nikdy necommitujte soubory s reálnými klíči.** Používejte šablonu `.env.example` a vlastní soubor, který není v gitu.

1. Zkopírujte šablonu:
   ```bash
   cp .env.example .env.local
   ```
2. Otevřete `.env.local` a nahraďte všechny `YOUR_VALUE_HERE` skutečnými hodnotami (Firebase Console, Google AI Studio).
3. Soubor `.env.local` je v `.gitignore` – nebude nikdy commitován.

## Sledované vs. ignorované soubory

- **Sledováno v gitu:** pouze `.env.example` (šablona s placeholdery).
- **Ignorováno:** `.env`, `.env.local`, `.env.production` a jakékoli `*.local`.

## Pokud jste omylem pushli klíče

1. Okamžitě rotujte všechny vystavené klíče (Firebase, Gemini API).
2. Nahraďte `.env.example` bezpečnou šablonou a commitněte.
3. Pro odstranění citlivých hodnot z celé git historie (volitelné, **přepíše historii**):
   - Nainstalujte [BFG Repo-Cleaner](https://rtyley.github.io/bfg-repo-cleaner/) nebo [git-filter-repo](https://github.com/newren/git-filter-repo).
   - **BFG** – vytvořte soubor `secrets.txt` s jedním řádkem obsahujícím každý únik (např. starý API klíč), pak:
     ```bash
     bfg --replace-text secrets.txt
     git reflog expire --expire=now --all && git gc --prune=now --aggressive
     git push --force
     ```
   - **git filter-repo** – pro přepsání obsahu souboru v celé historii je potřeba skript; BFG je pro nahrazení textu jednodušší.
   - **Varování:** Po force-pushu musí všichni spolupracovníci udělat nový klon nebo `git fetch origin && git reset --hard origin/main`. Ověřte, že máte zálohu a že nikdo nemá otevřené PR z postižených commitů.
