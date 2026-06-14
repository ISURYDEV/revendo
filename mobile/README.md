# Revendo Mobile

PWA companion (lecture seule + actions hors ligne) du projet **Revendo desktop**.

L'app desktop reste la source principale (imports CSV, documents, déclaration URSSAF complète).
Mobile sert pour : consulter le CA URSSAF du trimestre, le stock, créer des dépenses rapides,
enregistrer des mouvements de stock, et marquer des éléments de révision — le tout hors ligne.

## Stack

- React 18 + TypeScript + Vite 5
- Tailwind 3
- React Router 6 (HashRouter pour fonctionner depuis `file://` ou serveurs statiques)
- Zod (validation partagée avec desktop via `../shared/mobile`)
- IndexedDB local
- Service Worker basique (cache de l'app shell)
- AES-256-GCM + scrypt (déchiffrement WebCrypto) pour snapshots cifrés

## Démarrer en développement

```bash
cd mobile
npm install
npm run dev
```

Le serveur écoute sur `http://localhost:5174` (et sur le réseau local — accessible depuis ton téléphone).
Pour tester sur le téléphone : mets le PC et le téléphone sur le même Wi-Fi, ouvre `http://<ip-pc>:5174`.

## Build production

```bash
cd mobile
npm run build
```

Statique dans `mobile/dist/`. Sers via n'importe quel serveur statique (Nginx, Caddy, `npx serve`,
ou même Vite preview : `npm run preview`).

## Installation comme PWA

Android Chrome → menu → "Ajouter à l'écran d'accueil".
iOS Safari → Partager → "Sur l'écran d'accueil".

## Flux d'utilisation

1. Sur le PC : Réglages → 📱 Revendo Mobile → **Générer snapshot mobile JSON anonymisé**.
2. Copier le fichier `.json` vers le téléphone (USB, email, Drive, NextCloud, etc.).
3. Sur le téléphone : ouvrir Revendo Mobile → Réglages → **Importer un snapshot**.
4. Utiliser l'app hors ligne — créer dépenses, mouvements de stock, etc.
5. Sur le téléphone : Réglages → **Exporter les actions vers le PC** (génère un JSON).
6. Sur le PC : Réglages → 📱 Revendo Mobile → **Importer actions mobile** → vérifier l'aperçu → Appliquer.

## Sécurité

- Aucun serveur Revendo. Aucun cloud obligatoire.
- Mode anonymisé par défaut : emails / adresses des acheteurs masqués dans le snapshot.
- Stockage 100% local (IndexedDB du navigateur).
- Photos non synchronisées (conservées dans la galerie du téléphone, à joindre côté PC).
- Snapshots cifrés `.revendo.enc` supportés (déchiffrement local, mot de passe jamais stocké).
- Bouton "Effacer toutes les données locales" disponible dans Réglages.

## Limitations connues (v0.1)

- Pas d'app native iOS/Android (PWA). Une migration vers Capacitor est possible plus tard sans
  réécrire le code.
- Pas de sync automatique. Tout passe par export / import manuel de fichiers.
- Photos pas embarquées dans les actions exportées.
- Le déchiffrement d'un snapshot scrypt N=131072 prend 0.3–2s sur téléphone moderne.
- Pas de notifications push (hors scope).

## Architecture

```
mobile/
  src/
    App.tsx
    main.tsx
    storage/        IndexedDB (snapshot + actions queue)
    services/       Crypto, snapshot reader, search, format
    screens/        Dashboard, URSSAF, Stock, AddExpense, AddStock, Review, Search, Settings
    components/     Layout (bottom nav), Toast, Empty, SnapshotContext
  public/
    manifest.webmanifest, sw.js, icon.svg
```

Les DTOs et schémas zod sont partagés avec le desktop via `../shared/mobile/`.
