# Worms

Clon simplificado del clásico **Worms** implementado con [Phaser 3](https://phaser.io/), desarrollado como ejercicio para explorar dos objetivos en paralelo:

1. **Desarrollo asistido por IA**: validar qué tan lejos se puede llegar usando [Claude Code](https://claude.com/claude-code) para implementar un juego 2D con física, terreno destructible y múltiples sistemas (cámara, turnos, audio, UI), partiendo de cero.
2. **Despliegue en AWS**: probar el flujo completo de hosting estático en S3 + distribución global con CloudFront (HTTPS, CDN, caché).

**[🎮 Jugar ahora](https://d1uraqpiuhfjxd.cloudfront.net)**

---

## Características del juego

- **2 equipos × 3 gusanos** que se turnan para destruirse mutuamente.
- **Terreno destructible** basado en una máscara de canvas — cada explosión carva un cráter real con borde quemado, y los gusanos pueden caer al vacío.
- **4 tipos de escenario aleatorios** generados proceduralmente: islas flotantes, montañas, cavernas con túneles, y ciudad con edificios dañables.
- **Mar animado** con ondas y reflejos. Los gusanos que caen al agua mueren con efecto de splash.
- **Cámara dinámica**: sigue al gusano activo o al proyectil en vuelo, con zoom (rueda / `+` / `−`) y paneo manual (click derecho + arrastrar).
- **Pantalla completa** (`F` o botón).
- **Audio**: sonido sintetizado de explosión via Web Audio API + sample de voz "¡Me muero!" al morir un gusano.
- **Indicador visual del gusano activo**: flecha del color del equipo flotando arriba + halo pulsante alrededor.
- **HUD**: turno actual, gusanos vivos por equipo, HP, ángulo de tiro, zoom y banner final del ganador.

## Controles

| Tecla | Acción |
|---|---|
| `←` / `→` | Mover gusano |
| `↑` / `↓` | Apuntar |
| `Espacio` (mantener) | Cargar potencia y disparar |
| `W` | Saltar |
| `Enter` | Terminar turno |
| `Rueda` / `+` / `−` | Zoom |
| `Click derecho` + arrastrar | Panear el mapa |
| `C` | Recentrar cámara en el gusano activo |
| `F` | Pantalla completa |

## Stack técnico

- **Phaser 3** (frame de juego, escenas, input, cámara, tweens)
- **Canvas 2D** para el terreno destructible (manipulación de `ImageData` cacheado en `Uint8ClampedArray` para colisiones O(1))
- **Web Audio API** para sonido procedural de explosiones
- **HTML5** puro, sin bundler ni dependencias adicionales

## Arquitectura de despliegue en AWS

```
        ┌──────────────────────────┐
Browser │ https://d1uraqpiuhfjxd.  │
   ───▶ │ cloudfront.net           │
        └────────────┬─────────────┘
                     │ HTTPS
                     ▼
        ┌──────────────────────────┐
        │  CloudFront Distribution │  ← TLS, gzip/brotli, cache global,
        │  (PriceClass_All)        │    POPs en Brasil/Argentina
        └────────────┬─────────────┘
                     │ HTTP origin
                     ▼
        ┌──────────────────────────┐
        │  S3 Static Website       │  ← worms-game-mstrione (sa-east-1)
        │  index.html + assets     │    Bucket público de lectura
        └──────────────────────────┘
```

**Componentes**:

- **S3 bucket** (`worms-game-mstrione`) en `sa-east-1` con hosting estático habilitado, configurado como origen de CloudFront.
- **CloudFront Distribution** con:
  - Certificado HTTPS por defecto de CloudFront (sin dominio custom)
  - Redirección automática HTTP → HTTPS
  - Política de caché administrada `CachingOptimized`
  - Compresión automática
  - HTTP/2
- **IAM user** dedicado (`worms-deploy`) con permisos mínimos (`AmazonS3FullAccess` + `CloudFrontFullAccess`) — no se opera desde root.

### Costo estimado

Para tráfico bajo (uso personal / demo):
- S3 almacenamiento: ~$0.01/mes (1 MB de archivos)
- S3 + CloudFront transferencia: dentro del free tier (1 TB/mes de salida)
- Total: **< $0.05/mes**

### Flujo de deploy

```bash
# Sync de archivos a S3
aws s3 sync . s3://worms-game-mstrione \
  --exclude ".git/*" --exclude ".claude/*" --exclude "README.md" --delete

# Invalidar caché de CloudFront (cuando hay cambios)
aws cloudfront create-invalidation \
  --distribution-id E3IUU4J6ZWNNEJ --paths "/*"
```

## Cómo desarrollar localmente

```bash
# Levantar un server estático (los assets se cargan vía fetch)
python3 -m http.server 8000

# Abrir en el browser
open http://localhost:8000
```

## Estructura

```
.
├── index.html         # Layout full-window, controles HUD
├── game.js            # Lógica completa del juego (~1100 líneas)
├── phaser.min.js      # Phaser 3 (vendored)
├── me-muero.mp3       # Sample de voz al morir
└── README.md
```

---

Hecho por [Mauro Strione](https://www.strione.com), 2026.
