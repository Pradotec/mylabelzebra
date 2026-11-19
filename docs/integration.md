# Intégration

Un autre outil (back-office, tableur, script, application web interne) peut demander une impression à MyLabelZebra **sans serveur** : tout se passe dans le navigateur de l’utilisateur. L’aide intégrée (*Aide* → onglet **Intégration**) génère des exemples à copier pour l’étiquette en cours.

Prérequis communs :

- le **modèle doit être enregistré dans « Mes étiquettes »** du navigateur qui ouvre l’éditeur (le stockage est local à ce navigateur et à cette adresse) ;
- il est désigné par son **nom** (sans tenir compte de la casse) ou son **identifiant**.

## 1. Par un lien

```
https://<adresse-de-l-editeur>/?modele=<nom ou id>&data=<base64url>&imprimer=zebra&copies=1&invite.Lot=L2611
```

| Paramètre | Rôle |
| --- | --- |
| `modele` | nom ou identifiant de l’étiquette enregistrée (**obligatoire**) |
| `data` | lignes de données : **tableau JSON d’objets** (un objet seul est accepté), encodé en **base64url** (UTF-8, `-` et `_`, sans `=`). Une étiquette par objet, toutes cochées ; les clés deviennent les colonnes |
| `imprimer` | `zebra`, `ordinateur` (alias `computer`, `navigateur`), `pdf` ou `zpl` (téléchargement d’un fichier `.zpl`). Sans ce paramètre, l’étiquette est seulement ouverte |
| `copies` | copies par ligne (1 à 999), ou de l’étiquette seule (1 à 9 999) |
| `invite.Nom` | valeur d’un champ `{{?Nom}}` saisi à l’impression (une par champ) |
| `lang` | `en` pour l’interface anglaise (conservé après traitement) |

Comportement :

- le lien n’est traité **qu’une fois** : les paramètres sont retirés de la barre d’adresse (pas de réimpression en rafraîchissant) ;
- avec des données injectées, l’éditeur charge une **copie** du modèle nommée « <modèle> (données reçues) », avec un nouvel identifiant : un *Enregistrer* ne remplace pas le modèle d’origine ;
- les champs `{{?…}}` non fournis reprennent les dernières valeurs ou sont demandés dans la fenêtre de saisie ; les valeurs sont contrôlées (`obligatoire`, `gtin`, `regex`, `min`, `max`…) et un travail invalide est refusé ;
- un paramètre `data` illisible ou un modèle introuvable affiche un message d’erreur.

Construire le lien en Python (exemple de l’aide intégrée) :

```python
import base64, json, urllib.parse
rows = [{"nom": "Confiture fraise", "prix": "4,90"}]
data = base64.urlsafe_b64encode(json.dumps(rows).encode()).decode().rstrip('=')
url = 'https://etiquettes.exemple.fr/?modele=' + urllib.parse.quote('Étiquette prix') + '&data=' + data + '&imprimer=pdf'
```

En JavaScript :

```js
const rows = [{ nom: 'Confiture fraise', prix: '4,90' }];
const bytes = new TextEncoder().encode(JSON.stringify(rows));
const data = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const url = `https://etiquettes.exemple.fr/?modele=${encodeURIComponent('Étiquette prix')}&data=${data}&imprimer=zebra&copies=2`;
```

## 2. Par `window.postMessage`

Pour une application qui **ouvre** l’éditeur (`window.open`) ou l’**intègre dans une iframe** :

1. l’éditeur, une fois prêt, envoie `{ type: 'mlz.ready' }` à la fenêtre qui l’a ouvert (`window.opener`) et/ou à la page parente (iframe) ;
2. l’application envoie une demande :

   ```js
   {
     type: 'mlz.print',
     id: 'commande-1042',          // facultatif, renvoyé tel quel
     modele: 'Étiquette prix',      // nom ou identifiant dans « Mes étiquettes »
     rows: [{ nom: 'Confiture fraise', prix: '4,90' }],   // facultatif
     prompts: { Lot: 'L2611' },     // valeurs des champs {{?…}} (converties en texte)
     imprimer: 'zebra',             // zebra | ordinateur | pdf | zpl (absent = ouvrir seulement)
     copies: 1,                     // nombre
   }
   ```

3. l’éditeur répond à la fenêtre émettrice, sur son origine : `{ type: 'mlz.result', id, ok, count, error }` — `count` = nombre d’étiquettes produites ; `error` en cas d’échec (modèle introuvable, `imprimer=… inconnu`, `rows` qui n’est pas un tableau, annulation par l’utilisateur, impression annulée ou en échec…).

Les demandes sont traitées **une à la fois**, dans l’ordre d’arrivée.

Exemple (nouvel onglet) — repris de l’aide intégrée :

```js
// Ouvre l'éditeur dans un nouvel onglet puis envoie la demande dès qu'il est prêt
const base = 'https://etiquettes.exemple.fr/';
const mlz = window.open(base, 'mylabelzebra');
window.addEventListener('message', (e) => {
  if (e.source !== mlz) return;
  if (e.data?.type === 'mlz.ready') {
    mlz.postMessage({
      type: 'mlz.print',
      id: 'commande-1042',
      modele: 'Étiquette prix',
      rows: [{ nom: 'Confiture fraise', prix: '4,90' }],
      prompts: { Lot: 'L2611' },
      imprimer: 'zebra',
      copies: 1,
    }, new URL(base).origin);
  }
  if (e.data?.type === 'mlz.result') {
    console.log(e.data.ok ? `${e.data.count} étiquette(s) imprimée(s)` : 'Échec : ' + e.data.error);
  }
});
```

Exemple (iframe) :

```html
<iframe id="mlz" src="https://etiquettes.exemple.fr/" style="width:100%;height:700px;border:0"></iframe>
<script>
  const frame = document.getElementById('mlz');
  window.addEventListener('message', (e) => {
    if (e.source !== frame.contentWindow) return;
    if (e.data?.type === 'mlz.ready') {
      frame.contentWindow.postMessage({ type: 'mlz.print', modele: 'Étiquette prix', imprimer: 'pdf' }, 'https://etiquettes.exemple.fr');
    }
    if (e.data?.type === 'mlz.result') console.log(e.data);
  });
</script>
```

L’iframe doit être servie avec des en-têtes qui autorisent l’intégration : la configuration nginx fournie n’envoie ni `X-Frame-Options` ni `frame-ancestors`. Le stockage d’une iframe tierce peut être cloisonné par le navigateur (partitionnement) : les modèles doivent alors être enregistrés **dans l’iframe** elle-même.

## Sécurité

- **Jamais d’impression silencieuse au premier usage** : un bandeau *Demande d’impression* affiche l’origine (« depuis un lien » ou l’origine de la page émettrice), le modèle, le nombre d’étiquettes et la sortie ; *Annuler* ou *Imprimer*.
- La case **« Autoriser l’impression automatique pour ce modèle (sans confirmation) »** supprime la confirmation pour ce modèle **et cette origine uniquement**. Les autorisations se révoquent dans *Aide* → *Intégration* → *Impressions automatiques autorisées*.
- Si l’étiquette en cours a des modifications non enregistrées, le bandeau prévient qu’elle sera remplacée (annulable avec Ctrl+Z) ; une impression automatique autorisée imprime alors le modèle **sans** remplacer le travail en cours.
- L’impression *ordinateur* ouvre toujours la boîte de dialogue d’impression du navigateur.
- Chaque impression est inscrite dans l’historique d’impression avec son origine.

## Liens pré-remplis

Sans `modele`, l’adresse peut créer une étiquette à la volée :

| Paramètre | Effet |
| --- | --- |
| `barcode=VALEUR` | ajoute un code-barres |
| `type=…` | symbologie du code : `code128` (défaut, alias `c128`), `ean13` (`ean`), `ean8`, `upca` (`upc`), `upce`, `code39`, `code93`, `itf`, `gs1-128` (`gs1`), `sscc`, `codabar`, `datamatrix` (`dm`), `pdf417`, `aztec`, `gs1datamatrix` (`gs1dm`, `gs1-datamatrix`), `gs1qrcode` (`gs1qr`, `gs1-qr`), `gs1dlqrcode` (`digitallink`, `gs1-digital-link`), `databaromni` (`databar`, `gs1-databar`), `databarstackedomni` (`databarstacked`), `databarexpanded` (`gs1-databar-expanded`) |
| `qr=TEXTE` | ajoute un QR code (à droite si un code-barres est aussi demandé) |
| `text=TEXTE` | ajoute un texte en gras en haut |
| `seq=MOTIF` | série numérotée en CODE 128 : `{n}` est remplacé par le numéro (`SKU-{n}`) ; avec `start` (défaut 1), `step` (défaut 1), `count` (défaut 10, max 500), `pad` (zéros) |
| `w`, `h` | taille en pouces (défaut 4 × 2) |
| `dpi` | 203 (défaut), 300 ou 600 |
| `name` | nom du document |
| `lang` | `en` ou `fr` |

Exemples :

```
?barcode=590123412345&type=ean13&w=2&h=1
?qr=https://exemple.fr&text=Scannez-moi&w=2&h=2
?seq=SKU-{n}&start=1&count=50&pad=4&dpi=300
```

Les paramètres sont retirés de l’adresse après chargement (sauf `lang`).
