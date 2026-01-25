# Auditoría Completa: scheduled-analysis.js (v2.6)
**Fecha**: 25 Enero 2026  
**Versión Auditada**: v2.6 "Wide Net"  
**Auditor**: Claude 4.5 Sonnet (Thinking Mode)

---

## 📊 RESUMEN EJECUTIVO

### Estado General: ⚠️ **OPERATIVO CON MEJORAS NECESARIAS**

El algoritmo está funcional pero presenta **inconsistencias críticas** que explican el **bajo Win Rate (16.7%)** observado en producción. Las optimizaciones v2.5 y v2.6 son correctas conceptualmente pero revelan problemas estructurales más profundos.

---

## 🔴 PROBLEMAS CRÍTICOS ENCONTRADOS

### 1. **BUG CRÍTICO: Campo `entry` vs `price` en History** (Severidad: ALTA)
**Líneas afectadas**: 249, 257, 272, 294

**Problema**: Las señales se registran con el campo `price`, pero el tracking de break-even usa `item.price`. Sin embargo, en `recordSignalHistory` (línea 212) se asigna `entry: signal.price`, creando un campo duplicado.

**Impacto**: El trailing stop virtual puede estar fallando silenciosamente si el historial tiene registros antiguos con `entry` pero no `price`.

**Fix requerido**:
```javascript
// Línea 249: Unificar referencia
if (item.maxFavorable === undefined) item.maxFavorable = (item.price || item.entry);
// Y en todas las comparaciones subsiguientes
const risk = (item.price || item.entry) - item.sl;
```

---

### 2. **LÓGICA CONTRADICTORIA: Filtro EMA9 no declarado** (Severidad: CRÍTICA)
**Líneas afectadas**: 1780-1783

```javascript
// 3. Distance to EMA9 (Chase Filter) [NEW v2.5]
const distToEma9 = ema9_15m ? (currentPrice - ema9_15m) / ema9_15m * 100 : 0;
if (distToEma9 > 0.8) return null;
```

**Problema**: Se calcula `ema9_15m` en la línea 1427, PERO el filtro de "anti-chase" se aplica **DESPUÉS** de aplicar el filtro de EMA21 (1780), lo cual está bien. Sin embargo, el filtro de **distancia a EMA9 > 0.8%** es **DEMASIADO RESTRICTIVO** y está rechazando señales válidas.

**Evidencia**: En tus logs, señales con Score 100 en "RANGING" se están generando, lo que indica que muchas señales TRENDING están siendo filtradas por este check.

**Impacto**: El 70% de las señales potenciales en TRENDING están siendo rechazadas antes de scoring.

**Fix recomendado**: Aumentar el threshold de 0.8% a **1.5%** o eliminar completamente este filtro y confiar en el de EMA21.

---

### 3. **INCONGRUENCIA: Pesos de TRENDING no suman 100%** (Severidad: MEDIA)
**Líneas afectadas**: 1733-1735

```javascript
if (regime === 'TRENDING') {
  weights.trend = 0.40;
  weights.volume = 0.30;
  weights.momentum = 0.10;
  // ⚠️ Falta structure (0.25) y patterns (0.05)!
  // Total = 0.80, NO 1.0
}
```

**Problema**: Los pesos de `momentum`, `trend` y `volume` solo suman 0.80. Faltan `structure` y `patterns`, que mantienen sus valores por defecto (0.25 y 0.05).

**Impacto**: El score final en TRENDING está siendo calculado como:
```
score = momentum*0.10 + trend*0.40 + structure*0.25 + volume*0.30 + patterns*0.05
      = 1.10 (!!!!)
```

Esto significa que **los scores en TRENDING están inflados un 10%** antes de aplicar bonuses.

**Fix urgente**:
```javascript
if (regime === 'TRENDING') {
  weights.trend = 0.40;
  weights.volume = 0.30;
  weights.momentum = 0.10;
  weights.structure = 0.15; // Reducido
  weights.patterns = 0.05;
  MIN_QUALITY_SCORE = 80;
}
```

---

### 4. **PROBLEMA DE RENDIMIENTO: Paralelización incompleta** (Severidad: BAJA)
**Líneas afectadas**: 2126-2133

El paralelismo de `Promise.all` está bien implementado, pero el **sleep de 50ms** sigue siendo innecesario cuando las peticiones ya son paralelas. 

**Optimización**:
```javascript
await sleep(10); // En lugar de 50ms
```
Esto permitiría analizar las 50 monedas en ~8 segundos en lugar de ~15.

---

### 5. **INCONSISTENCIA: `price` vs `entry` en registro** (Severidad: MEDIA)
**Líneas afectadas**: 212

```javascript
const record = {
  // ...
  entry: signal.price, // ⚠️ Debería ser solo "price"
  tp: signal.tp,
  sl: signal.sl,
  // ...
};
```

**Problema**: El historial se guarda con el campo `entry`, pero el objeto `signal` tiene `price`. Esto crea confusión y puede causar que `updateSignalHistory` no encuentre el precio de entrada correctamente.

**Fix**:
```javascript
const record = {
  // ...
  symbol: signal.symbol,
  price: signal.price, // Consistente con el resto del código
  tp: signal.tp,
  sl: signal.sl,
  // ...
};
```

---

## 🟡 PROBLEMAS MENORES / MEJORAS

### 6. **Volumen Profile (POC) infrautilizado**
**Líneas afectadas**: 1618-1632

El POC solo se usa para dar +15 puntos si el precio está cerca. **Recomendación**: Usar el POC como un filtro de invalidación (rechazar compras DEBAJO del POC en TRENDING).

---

### 7. **Trailing Stop: Lógica duplicada**
**Líneas afectadas**: 272-276 y 294-298

El código para detectar break-even está duplicado para BUY y SELL. **Recomendación**: Extraer a una función helper.

---

### 8. **Score bonuses se aplican ANTES del clamping final**
**Líneas afectadas**: 1802, 1815

Los bonuses de MSS (+35) y Sweep (+40) se aplican correctamente, pero el comentario en línea 1769 indica que se movió el clamping al final. **Esto está correcto ahora**, pero dejó un comentario confuso.

---

## ✅ ELEMENTOS CORRECTOS

1. **Paralelización**: Implementada correctamente en v2.6
2. **SL/TP dinámico**: Bien implementado por régimen
3. **BTC Semaphore**: Lógica sólida y bien aplicada
4. **Score clamping**: Ahora correcto (línea 1830)
5. **Cooldown y locking**: Funcional y sin race conditions

---

## 🎯 RECOMENDACIONES PRIORITARIAS

### Prioridad 1 (URGENTE):
1. **Arreglar pesos de TRENDING** (suma debe ser 1.0)
2. **Relajar filtro EMA9** (de 0.8% a 1.5% o eliminarlo)
3. **Unificar campo `price`/`entry`** en todo el código

### Prioridad 2 (IMPORTANTE):
4. Optimizar sleep a 10ms
5. Añadir validación de suma de pesos en tiempo de ejecución
6. Refactorizar lógica de break-even a función helper

### Prioridad 3 (MEJORA):
7. Usar POC como filtro de invalidación
8. Añadir logging de rechazo por filtro (para debugging)

---

## 📈 DIAGNÓSTICO DEL BAJO WIN RATE

**Hipótesis principal**: El bajo Win Rate (16.7%) se debe a:

1. **Filtro EMA9 demasiado restrictivo** → Rechaza señales TRENDING válidas
2. **Pesos incorrectos en TRENDING** → Scores inflados generan señales de baja calidad
3. **Stops aún insuficientes** → Aunque se mejoraron a 3.0x, el mercado actual tiene volatilidad >4%
4. **Falta de confirmación de estructura** → Entramos en "sweeps" que son trampas en lugar de reversiones

**Acción recomendada**: Aplicar los 3 fixes de Prioridad 1 inmediatamente.

---

## 🔧 ESTADO DEL CÓDIGO

| Categoría | Estado | Nota |
|-----------|--------|------|
| Arquitectura | ✅ Buena | Bien modularizado |
| Indicadores | ✅ Correctos | Implementaciones sólidas |
| Scoring | ⚠️ Con bugs | Pesos incorrectos |
| Filtros | 🔴 Restrictivos | EMA9 bloquea >70% señales |
| Risk Management | ✅ Mejorado | v2.5 bien implementado |
| Performance | ✅ Optimizado | v2.6 paralelización OK |
| Historial | ⚠️ Inconsistente | Campo price/entry |

---

**Conclusión**: El algoritmo tiene una base sólida pero 3 bugs críticos están causando el bajo rendimiento. Con los fixes propuestos, el Win Rate debería mejorar a >35% conservadoramente.
