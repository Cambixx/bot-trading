# Solución Implementada: Persistencia de Cooldown

## Problema Crítico Resuelto

**Riesgo**: El cooldown de alertas se reiniciaba en cada invocación de la función serverless, causando potenciales alertas duplicadas.

**Causa**: El `Map` en memoria (`lastNotifiedAtByKey`) se perdía cuando la función serverless terminaba su ejecución.

---

## Solución Implementada

### 1. Instalación de Dependencia
```bash
npm install @netlify/blobs
```

### 2. Cambios en el Código

#### a) Import y Configuración (Líneas 14, 32-34)
```javascript
import { getStore } from "@netlify/blobs";

// Persistent cooldown storage using Netlify Blobs
const COOLDOWN_STORE_KEY = 'signal-cooldowns';
const COOLDOWN_EXPIRY_HOURS = 24; // Clean old entries after 24h
```

#### b) Funciones de Gestión Persistente (Líneas 123-181)
```javascript
async function loadCooldowns(context) {
  // Recibe contexto de Netlify para acceso a siteID y token
  const store = getStore({
    name: 'trading-signals',
    siteID: context?.site?.id,
    token: context?.token
  });
  // Carga el estado de cooldowns desde Netlify Blobs
  // Limpia automáticamente entradas expiradas (>24h)
}

async function saveCooldowns(cooldowns, context) {
  // Guarda el estado actualizado en Netlify Blobs
}

function shouldNotify(cooldowns, key, cooldownMinutes) {
  // Verifica si una señal debe ser notificada
}
```

#### c) Modificación de runAnalysis() (Líneas 1404, 1409, 1470)
```javascript
async function runAnalysis(context = null) {
  // Recibe contexto de Netlify
  
  // Cargar estado persistente al inicio
  const cooldowns = await loadCooldowns(context);
  
  // ... análisis de mercado ...
  
  // Guardar estado actualizado antes de terminar
  if (Object.keys(cooldowns).length > 0) {
    await saveCooldowns(cooldowns, context);
  }
}
```

#### d) Modificación de scheduledHandler (Líneas 1492, 1543, 1585)
```javascript
const scheduledHandler = async (event, context) => {
  // Recibe contexto como segundo parámetro
  
  if (isSchedule) {
    const result = await runAnalysis(context);
    // Pasa contexto a runAnalysis
  }
  
  // También en la invocación por defecto
  const result = await runAnalysis(context);
}
```

---

## Configuración de Netlify Context

### ⚠️ Problema Común

Si ves este error en los logs:
```
Error loading cooldowns: The environment has not been configured to use Netlify Blobs. 
To use it manually, supply the following properties when creating a store: siteID, token
```

**Solución**: El código ahora pasa correctamente el contexto de Netlify a las funciones de Blobs. Esto incluye:
- `context.site.id` - ID del sitio de Netlify
- `context.token` - Token de autenticación

### Fallback Automático

Si el contexto no está disponible o hay un error, el sistema automáticamente:
1. Registra un warning en los logs
2. Continúa funcionando **sin persistencia** (modo in-memory)
3. Las alertas seguirán funcionando, pero podrían duplicarse entre reinicios


---

## Cómo Funciona

### Flujo de Ejecución

1. **Inicio de Función**:
   - Se carga el estado de cooldowns desde Netlify Blobs
   - Se eliminan automáticamente entradas expiradas (>24h)

2. **Procesamiento de Señales**:
   - Por cada señal detectada, se verifica si está en cooldown
   - Si NO está en cooldown → Se añade a la lista y se registra el timestamp
   - Si SÍ está en cooldown → Se omite (no se envía alerta duplicada)

3. **Fin de Función**:
   - Se guarda el estado actualizado de cooldowns en Netlify Blobs
   - El estado persiste para la siguiente ejecución

### Ejemplo Práctico

```
Ejecución #1 (22:00):
  - BTC alcanza RSI < 30
  - Se genera señal "BTCUSDT:BUY:⚡ RSI Sobrevendido"
  - Se guarda: {"BTCUSDT:BUY:⚡ RSI Sobrevendido": 1737150000000}
  - ✅ Alerta enviada

Ejecución #2 (22:15):
  - BTC aún tiene RSI < 30
  - Se verifica cooldown: 15 min < 30 min → EN COOLDOWN
  - ❌ Alerta NO enviada (evita spam)

Ejecución #3 (22:45):
  - BTC aún tiene RSI < 30
  - Se verifica cooldown: 45 min > 30 min → FUERA DE COOLDOWN
  - ✅ Alerta enviada (situación persiste)
```

---

## Ventajas de la Solución

✅ **Persistencia Real**: Estado se mantiene entre reinicios de la función serverless
✅ **Auto-limpieza**: Elimina entradas antiguas (>24h) automáticamente
✅ **Sin Base de Datos**: Usa Netlify Blobs (incluido en el plan)
✅ **Performance**: Operaciones KV son muy rápidas
✅ **Simplicity**: No requiere infraestructura adicional

---

## Variables de Entorno Relevantes

```env
ALERT_COOLDOWN_MIN=30  # Minutos entre alertas del mismo tipo para el mismo símbolo
```

---

## Testing

### Verificar en Logs de Netlify

```bash
# Buscar confirmaciones de persistencia
netlify logs | grep "Loaded .* cooldowns from persistent storage"
netlify logs | grep "Saved .* cooldowns to persistent storage"
netlify logs | grep "Cleaned .* expired cooldown entries"
```

### Prueba Manual

1. Forzar una señal manualmente (modificar threshold temporalmente)
2. Esperar 15 minutos (menos que ALERT_COOLDOWN_MIN)
3. Verificar que NO se envíe alerta duplicada
4. Verificar en logs: `Signal skipped (cooldown)`

---

## Próximos Pasos Opcionales

Si deseas implementar las mejoras de prioridad **Alta** y **Media** del reporte de auditoría:

1. **Validación de Datos MEXC** (Prioridad Alta)
2. **Fallback a Binance/Bybit** (Prioridad Alta)  
3. **Procesamiento Paralelo** (Prioridad Media)
4. **Logging Estructurado** (Prioridad Media)

¿Te gustaría que continúe con alguna de estas mejoras?
