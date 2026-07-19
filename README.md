# Álbum Mundial 2026 — Control de figuritas

App web simple para llevar el control de tus figuritas del álbum "Usa Méx Can 26":
cuáles tenés, el precio de cada una, y el total invertido. Incluye lector de QR
compatible con los códigos que genera la app **Figuritas** para sincronizar
automáticamente cuáles tenés.

No tiene backend propio: es un sitio estático, y todos tus datos
(figuritas marcadas, precios y repetidas) se guardan en el navegador de tu
celular o computadora (`localStorage`). Si borrás los datos del navegador o
cambiás de dispositivo, se pierden — salvo que uses alguna de las dos formas
de llevarlos a otro dispositivo que trae esta app: un **backup manual**
(exportar/importar un archivo) o una **sincronización automática opcional**
conectando la app a un proyecto gratis de Firebase (ver más abajo).

## Secciones de la app

La app está organizada en 4 pestañas, con una barra de navegación fija justo
debajo del marcador de puntaje:

- **📖 Mi Álbum** — la grilla completa de figuritas por equipo, con el
  buscador, los precios automáticos y los filtros ("Solo faltantes", "Solo
  repetidas").
- **💰 Venta** — tus figuritas repetidas listas para vender (con filtros por
  tipo: escudos, formaciones, especiales) y el acceso a **"Vender a un
  cliente (QR)"**.
- **📊 Estadísticas** — cuántos escudos, formaciones, especiales y repetidas
  tenés, y el ranking de equipos de menos a más completo.
- **⚙️ Ajustes** — sincronizar dispositivos, hacer backup y reiniciar el
  álbum.

El botón dorado **"Actualizar mi álbum"**, arriba de todo, siempre está
visible sin importar en qué pestaña estés.

## Ver la app en tu computadora

No necesitás instalar nada especial. Dos opciones:

**Opción A — abrir el archivo directamente**
Abrí `public/index.html` con doble clic en tu navegador. Funciona para
probar la interfaz, pero la cámara puede no habilitarse por seguridad al
abrir un archivo local (`file://`). Para probar el lector de QR, usá la
Opción B.

**Opción B — servidor local (recomendado)**
```bash
npm run dev
```
y abrí `http://localhost:3000` en tu navegador.

## Desplegar en Vercel

1. Subí esta carpeta a un repositorio de GitHub (o usá `vercel` CLI directo
   desde acá).
2. En [vercel.com](https://vercel.com), "Add New Project" → importá el
   repositorio.
3. Vercel va a detectar el `vercel.json` incluido, que le indica que es un
   sitio estático servido desde la carpeta `public/` (sin paso de build).
4. Deploy. Listo — la URL que te da Vercel ya es tu app.

También podés hacerlo desde la terminal, parado en esta carpeta:
```bash
npx vercel
```

## Instalarla en el celular (sin abrir Chrome cada vez)

La app ahora es una **PWA instalable**: podés agregarla a la pantalla de
inicio y se abre como una app normal, a pantalla completa, sin la barra de
direcciones de Chrome/Safari ni tener que escribir la URL de Vercel.

**Android (Chrome):**
1. Abrí la URL de Vercel de la app.
2. Tocá el menú `⋮` (arriba a la derecha) → **"Instalar aplicación"** (o
   "Agregar a la pantalla de inicio"). A veces Chrome muestra un cartelito
   propio abajo ofreciendo instalar; también sirve.
3. Confirmá. Va a aparecer un ícono en tu pantalla de inicio/cajón de apps,
   igual que cualquier otra app.

**iPhone (Safari):**
1. Abrí la URL de Vercel de la app en **Safari** (tiene que ser Safari, no
   Chrome — iOS solo permite instalar PWAs desde Safari).
2. Tocá el botón de **Compartir** (el cuadrado con la flecha hacia arriba).
3. Elegí **"Agregar a inicio"**.
4. Confirmá. Te va a quedar el ícono en la pantalla de inicio.

Una vez instalada, abrís ese ícono y listo — no hay barra de navegador, y
funciona incluso con mala conexión (el "cascarón" de la app —HTML, CSS,
JS— queda guardado en el celular; los datos siguen viviendo en
`localStorage`/Firebase como siempre).

Si actualizás el sitio en Vercel más adelante, puede que tengas que cerrar
del todo la app instalada (deslizarla para cerrarla, no solo minimizarla) y
volver a abrirla una o dos veces para que tome la versión nueva.

## 🌟 Extras (Extra Stickers)

Pestaña nueva para llevar el set especial "Extra Stickers" (20 jugadores ×
4 categorías: Base, Bronce, Plata, Oro) — los mismos datos que estaban en
`Extra_Stickers_Mundial_2026.xlsx`. La primera vez que abrís la pestaña, se
carga con los valores exactos de ese Excel (`public/extras-data.json`); a
partir de ahí, todo lo que edites se guarda en este dispositivo y se
sincroniza con el resto del álbum (nube / backup) si tenés eso configurado.

- **−/+** en cada categoría para cargar cuántas tenés.
- El número después de la barra (ej. `1/1`) es tu objetivo — tocalo para
  cambiarlo si querés juntar más de una.
- Nota opcional por jugador.
- **⬇️ Exportar a Excel**: descarga un `.xlsx` nuevo con la misma
  estructura del original (Conteo/Resumen/Faltantes/Guía), con tus datos
  actuales — útil como respaldo o para compartir.
- **Reiniciar**: vuelve a cargar los valores originales del Excel que
  subiste, por si querés empezar de nuevo desde ahí.

## Precios automáticos



Al marcar una figurita como tuya, la app le pone un precio automático según
el tipo:

- **Escudo** (figurita #1 de cada equipo), **formación** (figurita #13 de
  cada equipo) y **especiales** (sección "Especiales" — trofeo, sedes,
  historia): **$2000**.
- El resto de las figuritas: **$1000**.

Ambos montos son editables desde la barra de herramientas ("Común" y
"Escudo/Formación/Especial"), por si cambian los precios que manejás. El
botón **"Recalcular precios"** vuelve a aplicar la regla a todas tus
figuritas ya marcadas (útil si cambiaste los montos o corregiste algo a
mano y querés que todo quede consistente de nuevo). También podés seguir
editando el precio de una figurita puntual a mano, tocando el campo `$`
debajo de su número — eso no se pisa solo, salvo que uses "Recalcular
precios".

## Cómo funciona el lector de QR

La app **Figuritas** codifica el álbum de cada usuario como un texto con dos
o tres bloques comprimidos (gzip + base64) separados por `;`. Uno de esos
bloques es un mapa de bits: cada figurita del álbum tiene una posición fija
(en el mismo orden que aparece en `public/sections.json`), y un bit en `1`
significa "la tengo". Esta app decodifica ese mapa de bits con la cámara
(usando `jsQR` y `pako`, ambas cargadas desde CDN) y, según el modo elegido,
lo usa para actualizar tu álbum o para calcular qué le podés vender a otra
persona (ver siguiente sección).

Si en algún momento la app Figuritas cambia el formato de su QR, el lector
puede dejar de funcionar — en ese caso seguís pudiendo cargar todo a mano
desde la grilla de figuritas.

### Corrección: conteo de repetidas al importar

El tercer bloque comprimido del QR (uno por cada figurita repetida) no
contiene "copias extra además de la primera" como se creía originalmente:
contiene la **cantidad total** de copias de esa figurita. Sumar +1 de más
por cada repetida inflaba el número de "Repetidas" que mostraba esta app al
importar (comparado con lo que muestra la propia app Figuritas). Esto ya
está corregido: los números de "Pegadas" y "Repetidas" que ves al importar
ahora coinciden con los de Figuritas.

### Exportar de vuelta a Figuritas (experimental)

En **⚙️ Ajustes → "📤 Exportar QR para Figuritas"** podés generar un código
QR con el progreso cargado en esta página, armado con el mismo formato
(mapa de bits comprimido) que usa la app Figuritas para el suyo, incluyendo
los bytes de encabezado que identifican a qué álbum pertenece el código (sin
esos bytes, Figuritas lo rechaza con "este código pertenece a un álbum
diferente"). La idea es poder abrir Figuritas, elegir "Importar" y escanear
este código para llevar lo cargado acá de vuelta a la app.

Como el formato del QR de Figuritas no es una especificación oficial sino
algo reconstruido comparando códigos reales, esta función sigue siendo
**experimental**: puede haber otras validaciones internas de la app
(checksums, versión, etc.) que no detectamos todavía con una sola muestra.
Antes de confiar en ella, probala una vez y fijate que el resumen que te
muestre Figuritas al importar coincida con el que te muestra esta página
antes de escanear. Si Figuritas rechaza el código o el resumen no coincide,
avisá para seguir ajustando el formato.

### Mi QR para intercambiar

En la pestaña **💰 Venta → "🔄 Mi QR para intercambiar"** hay un código
armado con el mismo formato que "Exportar QR para Figuritas" (compatible
con la app oficial), pero pensado para intercambios entre coleccionistas en
vez de para actualizar tu propia app Figuritas. Como usa el mismo formato,
se puede leer de dos formas:

- **Con la app oficial Figuritas**, desde su pestaña **"Cambiar"** ("Escanea
  el código QR de tus amigos para descubrir qué figuritas puedes
  intercambiar") — funciona igual que si fuera tu propio código de esa app.
- **Con esta misma app**, tocando **"🔍 Leer QR de otro coleccionista"**, que
  además del intercambio típico calcula el resultado en las **dos
  direcciones a la vez**.

Sirve para las dos puntas de un intercambio a la vez:

- Si estás buscando láminas, mostrale tu QR a alguien: al leerlo (con
  Figuritas o con esta app), esa persona ve cuáles de sus repetidas te
  sirven a vos.
- Si alguien quiere saber qué tenés repetido para ofrecerte algo a cambio,
  con el mismo código ve también cuáles de tus repetidas le sirven a
  ella/él (esto último solo si lo lee con esta app, ya que es la parte que
  la app oficial no calcula).

Cuando lo lee esta app, muestra un resultado en las dos direcciones —
**"Tus repetidas que a él/ella le faltan"** y **"Sus repetidas que a vos te
faltan"** — con precios de tu lado y sin que ninguno de los dos tenga que
mostrar el álbum completo. Como con "Vender a un cliente", **este modo
nunca modifica tu álbum**; es solo informativo, con un botón para copiar el
resumen y compartirlo por WhatsApp.

### Tres modos de escaneo

Hay varios botones distintos porque un QR de este tipo se ve igual sea tu
propio código, el de un cliente o el "QR para intercambiar" de otro
coleccionista — la app no tiene forma de saber cuál es cuál, así que elegís
vos la intención tocando el botón correcto:

**📷 "Actualizar mi álbum"** (arriba a la derecha)
Escaneás **tu propio** QR. La app **agrega** a tu álbum las figuritas nuevas
que trae el código, con precio automático según el tipo. Nunca borra ni
desmarca nada, así que tus precios, cantidades y repetidas cargadas a mano
siempre quedan a salvo.

**🤝 "Vender a un cliente (QR)"** (pestaña 💰 Venta)
Escaneás el QR **de otra persona** (un comprador/coleccionista). La app
compara lo que esa persona ya tiene contra tus propias repetidas, y te
muestra una lista de las figuritas que vos tenés de más y que a ella le
faltan — listas para separar y vender, con el precio de cada una y el total
a cobrar. Podés destildar las que finalmente no vendas, copiar la lista para
mandarla por WhatsApp, y tocar **"Confirmar venta"** para que la app reste 1
del stock de cada figurita vendida. **Este modo nunca modifica tu álbum de
figuritas que tenés/te faltan** — solo tu cantidad de repetidas al confirmar
una venta.

**🔍 "Leer QR de otro coleccionista"** (pestaña 💰 Venta)
Escaneás el **"QR para intercambiar"** que te muestra otra persona. La app
compara ese código contra tu álbum en las dos direcciones y te muestra qué
de tus repetidas le sirven a ella, y qué de las suyas te sirven a vos —
puramente informativo, sin tocar tu álbum ni tu stock de repetidas.

### Mejoras del lector (estabilidad)

- Prueba primero la cámara trasera ideal y, si el celular no la deja
  configurar así, cae automáticamente a cualquier cámara disponible en vez
  de fallar directamente.
- Mensajes de error específicos según lo que pasó (permiso denegado, cámara
  en uso por otra app, sin HTTPS, sin cámara, etc.), en vez de un genérico
  "no pude acceder a la cámara".
- Botón de **linterna** (si el celular lo permite) y de **cambiar de
  cámara** cuando hay más de una disponible — ayuda mucho a leer el QR con
  poca luz.
- El escaneo se frena automáticamente si cambiás de pestaña o la app pasa a
  segundo plano, para no dejar la cámara prendida gastando batería.
- Detección de QR más tolerante (colores invertidos, poca luz) y sin
  saturar el procesador escaneando cada frame.
- Vibración corta al leer un QR con éxito, como confirmación.

## Sincronizar entre dispositivos

Por defecto la app guarda todo solo en el navegador de cada dispositivo
(nada de sincronización). Si querés que el celular y la compu (o varios
celulares) vean el mismo álbum en tiempo real, podés conectar la app a un
proyecto **gratis** de Firebase. Es un ratito, una sola vez:

**1. Crear el proyecto**
1. Entrá a [console.firebase.google.com](https://console.firebase.google.com)
   con tu cuenta de Google → **"Agregar proyecto"**.
2. Ponele el nombre que quieras (ej. `album-mundial-2026`). Podés desactivar
   Google Analytics, no hace falta.

**2. Crear la base de datos (Firestore)**
1. En el menú izquierdo: **Build → Firestore Database → Crear base de
   datos**.
2. Elegí una región cercana y el modo **"Producción"** (no "modo de
   prueba", que se desactiva solo a los 30 días).
3. Andá a la pestaña **"Reglas"** de Firestore y reemplazá el contenido por:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /albums/{code} {
         allow read, write: if true;
       }![![alt text](image-1.png)](image.png)
     }
   }
   ```
   Con esto, cualquiera que sepa el "código de álbum" que vas a elegir en el
   paso 4 puede leer o escribir ese álbum — no hay usuario ni contraseña.
   Para un uso personal (vos + tu familia/celular) alcanza y sobra; elegí un
   código largo y no lo publiques.

**3. Registrar una app web y copiar la configuración**
1. En **"Descripción general del proyecto"** (ícono de engranaje →
   Configuración del proyecto), abajo en "Tus apps", tocá el ícono `</>`
   para agregar una app web.
2. Ponele un nombre (no hace falta Firebase Hosting) y creála.
3. Te va a mostrar un bloque `firebaseConfig = { apiKey: "...", ... }`.
   Copiá esos valores.

**4. Pegar la configuración en la app**
Abrí `public/firebase-config.js` en este proyecto y reemplazá los valores
de ejemplo por los que copiaste. Guardá y volvé a desplegar (o refrescá si
estás en local con `npm run dev`).

**5. Activar la sincronización desde la app**
1. Tocá **"⚙️ Ajustes" → "🔗 Sincronizar dispositivos"**.
2. Escribí un **código de álbum** (una palabra o frase que solo vos
   conozcas, ej. `familia-gomez-mundial26`) y tocá "Guardar código".
3. Activá el toggle **"Sincronización automática"**.
4. Repetí el paso 5 (mismo código) en el otro dispositivo.

A partir de ahí, cualquier cambio que hagas en un dispositivo (marcar una
figurita, cambiar un precio, sumar una repetida) aparece solo en el otro en
cuanto ambos tengan conexión a internet — no hace falta hacer nada más. Los
botones "⬆️ Subir ahora" / "⬇️ Traer de la nube" del mismo modal sirven para
forzar la sincronización a mano (por ejemplo la primera vez, para elegir
qué copia de los dos dispositivos "gana").

Si dos dispositivos cambian el álbum *al mismo tiempo* sin conexión, gana el
último que se sincroniza — no se combinan inteligentemente los cambios. Para
uso normal (vos mirando el álbum en dos aparatos) esto no es un problema.

Si preferís no crear una cuenta de Firebase, seguís teniendo el botón
**"💾 Backup"** (pestaña ⚙️ Ajustes) para exportar un archivo en un dispositivo e importarlo en el
otro a mano, sin necesidad de conexión ni cuentas.

## Repetidas para vender

Además de marcar una figurita como "tenés", ahora podés indicar **cuántas
copias** tenés tocando el `+`/`–` que aparece debajo del precio. A partir de
la segunda copia, esa figurita cuenta como "repetida" y aparece en
la pestaña **"💰 Venta"**, con:

- Un resumen de cuántas figuritas repetidas tenés en total y su valor
  estimado (según el precio automático o el que hayas puesto a mano).
- El listado agrupado por equipo, con cuántas te sobran de cada una.
- Un botón **"Copiar lista para compartir"** que arma un texto listo para
  pegar en WhatsApp o donde quieras, para ofrecerlas a otros coleccionistas.

Importante: el escaneo de tu propio QR **no** trae información de cuántas
copias tenés de cada figurita (solo si la tenés o no), así que la
cantidad/repetidas siempre se carga a mano con el `+`/`–`.

Cuando ya estás en persona con un comprador, usá en cambio **"🤝 Vender a un
cliente (QR)"** (ver arriba): leyendo el QR de esa persona, la app filtra
sola cuáles de tus repetidas le sirven a ella, y al confirmar la venta resta
la cantidad automáticamente — no hace falta ir descontando a mano.

## Backup de mis datos

Como todo se guarda en el navegador (`localStorage`), en **⚙️ Ajustes** el botón **"💾 Backup de
mis datos"** te deja:

- **Descargar** un archivo `.json` con todo tu álbum (figuritas, cantidades,
  repetidas y los precios común/premium configurados).
- **Restaurar** ese archivo más adelante, incluso desde otro navegador o
  celular, si perdiste los datos o cambiaste de dispositivo.

Recomendado hacerlo de vez en cuando, sobre todo antes de borrar datos del
navegador o cambiar de celular.

## Estructura del proyecto

```
public/
  index.html            → estructura de la página
  style.css             → estilos (tema "marcador de estadio")
  app.js                → toda la lógica: estado, render, lector de QR, sync, backup
  sections.json         → checklist completo de las 980 figuritas del álbum
  extras-data.json      → roster + valores originales del set "Extra Stickers"
  firebase-config.js    → acá pegás los datos de tu proyecto de Firebase (opcional)
  manifest.webmanifest  → metadata de la PWA (nombre, ícono, colores)
  service-worker.js     → cachea el "cascarón" de la app para que sea instalable
  icons/                → íconos de la PWA (192/512/maskable/apple-touch)
vercel.json              → le dice a Vercel que sirva public/ como sitio estático
```

## Personalizar el álbum

Si querés ajustar nombres, agregar/quitar equipos, o adaptar esto a otro
álbum, editá `public/sections.json`. Cada sección tiene:
```json
{ "id": "MEX", "code": "MEX", "emoji": "🇲🇽", "label": "México", "stickers": ["1","2","...","20"] }
```
El orden de las secciones y de los números dentro de `stickers` importa: es
el orden que usa el lector de QR para interpretar el mapa de bits. Si cambiás
el orden, el escaneo va a asignar las figuritas equivocadas.
