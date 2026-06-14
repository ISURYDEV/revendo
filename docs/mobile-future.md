# Revendo — préparation mobile future

Revendo reste une application PC local-first. La vue mobile actuelle n'est pas une application native :
elle est générée localement sous forme de snapshot HTML en lecture seule.

## Contenu du snapshot

Le snapshot mobile contient uniquement les données utiles à la consultation :

- tableau de bord,
- ventes résumées,
- stock résumé,
- dépenses résumées,
- résumé URSSAF,
- résumé du Centre de révision,
- métadonnées de documents.

Depuis la version `revendo-mobile-v2`, le snapshot inclut :

- `schema_version`,
- `generated_at`,
- `app_version`,
- `redaction_mode`,
- `encrypted`,
- `data_scope`.

## Données masquées

Par défaut, le snapshot mobile est généré en mode anonymisé.

Les données suivantes ne sont pas incluses ou sont remplacées :

- nom d'acheteur,
- username acheteur si l'option est active,
- email acheteur,
- adresse acheteur,
- tiers document sensible quand applicable.

Les documents lourds ne sont pas intégrés directement dans le HTML mobile. Ils restent accessibles
dans le dossier synchronisé `Revendo Backups/documents/`.

## Protection

Revendo peut générer un snapshot mobile chiffré avec `AES-256-GCM` et une clé dérivée par `scrypt`.
Le mot de passe n'est pas stocké. Si le mot de passe est perdu, le fichier chiffré ne peut pas être récupéré.

## Limites actuelles

- Pas d'application mobile native dans cette phase.
- Pas de synchronisation bidirectionnelle.
- Pas de serveur Revendo.
- Pas de login en ligne.
- Pas de modification depuis mobile.

## Évolution possible

Une future application mobile native pourrait lire ces DTOs, puis utiliser une synchronisation sécurisée
basée sur `sync_state` et `sync_changes`. La résolution de conflits, l'authentification et le chiffrement
de bout en bout restent hors périmètre de cette phase.
