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

### Dos modos de escaneo

Hay dos botones distintos porque el QR de la app Figuritas se ve igual sea
tu propio código o el de otra persona — la app no tiene forma de saber de
quién es, así que elegís vos la intención tocando el botón correcto:

**📷 "Actualizar mi álbum"** (arriba a la derecha)
Escaneás **tu propio** QR. La app **agrega** a tu álbum las figuritas nuevas
que trae el código, con precio automático según el tipo. Nunca borra ni
desmarca nada, así que tus precios, cantidades y repetidas cargadas a mano
siempre quedan a salvo.

**🤝 "Vender a un cliente (QR)"** (en los accesos rápidos)
Escaneás el QR **de otra persona** (un comprador/coleccionista). La app
compara lo que esa persona ya tiene contra tus propias repetidas, y te
muestra una lista de las figuritas que vos tenés de más y que a ella le
faltan — listas para separar y vender, con el precio de cada una y el total
a cobrar. Podés destildar las que finalmente no vendas, copiar la lista para
mandarla por WhatsApp, y tocar **"Confirmar venta"** para que la app reste 1
del stock de cada figurita vendida. **Este modo nunca modifica tu álbum de
figuritas que tenés/te faltan** — solo tu cantidad de repetidas al confirmar
una venta.

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
1. Tocá **"🔗 Sincronizar dispositivos"**.
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
**"💾 Backup"** para exportar un archivo en un dispositivo e importarlo en el
otro a mano, sin necesidad de conexión ni cuentas.

## Repetidas para vender

Además de marcar una figurita como "tenés", ahora podés indicar **cuántas
copias** tenés tocando el `+`/`–` que aparece debajo del precio. A partir de
la segunda copia, esa figurita cuenta como "repetida" y aparece en el botón
**"🔁 Repetidas para vender"**, con:

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

Como todo se guarda en el navegador (`localStorage`), botón **"💾 Backup de
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
  firebase-config.js    → acá pegás los datos de tu proyecto de Firebase (opcional)
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
