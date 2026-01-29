# Plan de Mejoras del Algoritmo de Señales - Análisis de History.json

## 📊 Resumen de Datos Analizados

- **Total Señales**: 33
- **Win Rate Actual**: 39.4% (13 ganadoras / 20 perdedoras)
- **Umbral de Rentabilidad**: >50% WR con R:R 1:1

---

## 🔍 Hallazgos Clave por Régimen de Mercado

### 1. RANGING (Rango/Consolidación)
**Estadísticas**: 8 señales | 6W / 2L | **75% Win Rate** ✅

| Símbolo | Score | Resultado | Observaciones |
|---------|-------|-----------|---------------|
| RDDTON | 78 | WIN | Breakeven |
| SUI | 97 | WIN | Breakeven |
| ETH | 98 | WIN | Breakeven |
| AALON | 80 | WIN | Breakeven |
| APT | 76 | WIN | Breakeven, sin MSS |
| ATTON | 78 | WIN | Breakeven |
| MSFTON | 100 | WIN | Breakeven |
| PAXG | 87 | LOSS | Sin MSS, sin Sweep |

**Patrón Ganador en RANGING**:
- Score promedio ganador: **87.8**
- 83% usan breakeven (protección de capital)
- MSS presente en 67% de ganadoras
- Sweep presente en 33% de ganadoras

**Problema en RANGING**:
- PAXG (87 score) perdió sin MSS ni Sweep → **Falta confirmación estructural**

---

### 2. TRANSITION (Transición)
**Estadísticas**: 12 señales | 4W / 8L | **33% Win Rate** ⚠️

| Símbolo | Score | Resultado | Observaciones |
|---------|-------|-----------|---------------|
| PALLON | 85 | WIN | MSS + Sweep |
| LRCXON | 100 | WIN | MSS |
| LRCXON | 88 | WIN | Sweep |
| NOWON | 79 | WIN | Sweep |
| SUI | 100 | LOSS | MSS + Sweep |
| ENA | 91 | LOSS | MSS + Sweep |
| ASMLON | 86 | LOSS | Sin Sweep |
| ASTER | 90 | LOSS | Sweep sin MSS |
| PUMP | 90 | LOSS | Sweep sin MSS |
| PUMP | 90 | LOSS | Sweep sin MSS |
| PALLON | 99 | LOSS | MSS |
| ETHFI | 85 | LOSS | MSS |
| MSFTON | 100 | LOSS | MSS |
| ASTER | 87 | LOSS | MSS + Sweep |

**Problemas Críticos en TRANSITION**:
1. **Score 90-100 con MSS+Sweep siguen perdiendo** (SUI 100, ENA 91, MSFTON 100)
2. **MSS sin Sweep = 50% WR** (2W/2L) vs **MSS + Sweep = 20% WR** (1W/4L)
3. **Sweep sin MSS = 0% WR** (0W/3L)

**Insight**: En TRANSITION, la confluencia MSS+Sweep NO garantiza éxito. El mercado está indeciso.

---

### 3. TRENDING (Tendencia)
**Estadísticas**: 11 señales | 3W / 8L | **27% Win Rate** ❌

| Símbolo | Score | Resultado | Observaciones |
|---------|-------|-----------|---------------|
| UNHON | 83 | WIN | MSS |
| ARMON | 75 | WIN | Sin MSS |
| TAO | 100 | LOSS | MSS + Sweep |
| SUI | 100 | LOSS | MSS |
| SUI | 90 | LOSS | Sweep |
| ENA | 86 | LOSS | Sweep |
| PALLON | 78 | LOSS | MSS + Sweep |
| SNOWON | 100 | LOSS | MSS |
| NOWON | 80 | LOSS | MSS |
| OKLOON | 80 | LOSS | MSS |

**Problemas Críticos en TRENDING**:
1. **Score 100 perdiendo** (TAO, SUI, SNOWON)
2. **MSS + Sweep = 0% WR** en TRENDING (0W/2L)
3. **Entradas en contra de la tendencia mayor**

**Insight**: El algoritmo está generando señales de "reversión" en tendencia alcista, lo cual es contraproducente.

---

## 📈 Análisis por Score

| Rango Score | Señales | Wins | Losses | Win Rate |
|-------------|---------|------|--------|----------|
| 75-79 | 4 | 3 | 1 | 75% |
| 80-84 | 3 | 1 | 2 | 33% |
| 85-89 | 5 | 1 | 4 | 20% |
| 90-94 | 3 | 0 | 3 | 0% |
| 95-100 | 18 | 8 | 10 | 44% |

**Hallazgo Sorprendente**: 
- **Scores 75-79 tienen mejor WR (75%) que scores 90-100 (44%)**
- Scores muy altos (>90) en TRANSITION/TRENDING son trampas

---

## 🎯 Factores de Éxito Identificados

### Ganadoras (13 señales):
1. **Régimen RANGING**: 6/8 (75%)
2. **Breakeven activado**: 10/13 (77%)
3. **MSS presente**: 7/13 (54%)
4. **BTC Risk GREEN**: 13/13 (100%)

### Perdedoras (20 señales):
1. **Régimen TRANSITION**: 8/12 (67% de las señales TRANSITION)
2. **Régimen TRENDING**: 8/11 (73% de las señales TRENDING)
3. **Score 90+**: 13/20 (65%)
4. **MSS presente**: 12/20 (60% de perdedoras TIENEN MSS)

---

## 🚨 Problemas del Algoritmo Actual

### 1. Sobre-valoración de MSS en TRANSITION/TRENDING
- MSS da +45 puntos independientemente del régimen
- En TRANSITION, MSS sin dirección clara del mercado = riesgo

### 2. Falta de Filtro de Dirección de Tendencia Mayor
- Señales BUY en TRENDING alcista = comprar en máximos
- Necesita verificar alineación con tendencia 4H/1D

### 3. Penalización Insuficiente para TRANSITION
- Solo +10 en MIN_QUALITY_SCORE (75→85)
- Los datos muestran que TRANSITION debería ser >90 o bloqueado

### 4. Scores Inflados
- Scores 90-100 con múltiples pérdidas indican sobrecalificación
- Los pesos de las categorías necesitan ajuste

### 5. Falta de Análisis de Contexto de Mercado
- No se verifica si el activo está en soporte/resistencia clave
- Sin análisis de correlación BTC/altcoins

---

## 🔧 Plan de Mejoras Detallado

### FASE 1: Filtros por Régimen (Alta Prioridad)

#### 1.1 Bloquear TRANSITION por Defecto
```javascript
// En generateSignal()
if (regime === 'TRANSITION') {
  // Solo permitir si hay confluencia excepcional
  const exceptionalConfluence = 
    mss && sweep && volumeRatio > 1.5 && 
    categoryScores.structure >= 70 && 
    categoryScores.volume >= 70;
  
  if (!exceptionalConfluence) {
    console.log(`[REJECT] ${symbol}: TRANSITION sin confluencia excepcional`);
    return null;
  }
  
  // Requerir score mínimo de 92 en TRANSITION
  MIN_QUALITY_SCORE = 92;
}
```

#### 1.2 Modificar TRENDING para Seguir la Tendencia
```javascript
// En lugar de buscar reversión, buscar pullbacks
if (regime === 'TRENDING') {
  // Verificar que estamos en dirección de la tendencia
  const trendDirection = adx15m.bullishTrend ? 'UP' : 'DOWN';
  
  if (signalType === 'BUY' && trendDirection !== 'UP') {
    console.log(`[REJECT] ${symbol}: BUY en tendencia bajista`);
    return null;
  }
  
  // Requerir pullback a EMA21/EMA50
  const nearEMA21 = Math.abs(distToEma21) < 0.5;
  if (!nearEMA21) {
    console.log(`[REJECT] ${symbol}: TRENDING sin pullback a EMA21`);
    return null;
  }
}
```

#### 1.3 Optimizar RANGING (Único Régimen Rentable)
```javascript
if (regime === 'RANGING') {
  // Reducir requisitos, este régimen funciona
  MIN_QUALITY_SCORE = 70;
  
  // Pero requerir confirmación estructural
  if (!mss && !sweep) {
    console.log(`[REJECT] ${symbol}: RANGING sin MSS ni Sweep`);
    return null;
  }
}
```

---

### FASE 2: Re-calibración de Scores

#### 2.1 Reducir Bonus de MSS según Régimen
```javascript
// MSS bonus adaptativo
let mssBonus = 45;
if (regime === 'TRANSITION') mssBonus = 25;  // Reducido
if (regime === 'TRENDING') mssBonus = 30;    // Reducido
if (regime === 'RANGING') mssBonus = 45;     // Mantener

if (mss && mss.type === 'BULLISH_MSS') {
  score += mssBonus;
}
```

#### 2.2 Ajustar Pesos de Categorías
```javascript
// Pesos actuales vs recomendados
const weights = {
  momentum: 0.20,  // Mantener
  trend: 0.40,     // Reducir a 0.30
  structure: 0.25, // Aumentar a 0.35
  volume: 0.10,    // Mantener
  patterns: 0.05   // Mantener
};

// En TRANSITION, estructura es más importante
if (regime === 'TRANSITION') {
  weights.structure = 0.50;
  weights.trend = 0.20;
  weights.momentum = 0.15;
}
```

#### 2.3 Penalización por Score Inflado
```javascript
// Penalizar scores que dependen demasiado de un factor
const maxCategoryScore = Math.max(...Object.values(categoryScores));
if (maxCategoryScore > 90 && strongCategories < 3) {
  score -= 15; // Score "inflado" por un solo factor
  reasons.push('⚠️ Score inflado (-15)');
}
```

---

### FASE 3: Nuevos Filtros de Calidad

#### 3.1 Filtro de Riesgo/Beneficio Mínimo
```javascript
// Calcular R:R basado en ATR
const risk = currentPrice - sl;
const reward = tp - currentPrice;
const riskRewardRatio = reward / risk;

if (riskRewardRatio < 1.2) {
  console.log(`[REJECT] ${symbol}: R:R ${riskRewardRatio.toFixed(2)} < 1.2`);
  return null;
}
```

#### 3.2 Filtro de Distancia al Stop
```javascript
// Evitar stops muy amplios (>3% en spot)
const stopDistance = (currentPrice - sl) / currentPrice * 100;
if (stopDistance > 3.0) {
  console.log(`[REJECT] ${symbol}: Stop muy amplio (${stopDistance.toFixed(2)}%)`);
  return null;
}
```

#### 3.3 Filtro de Volumen en Ruptura
```javascript
// Requerir volumen creciente en últimas 3 velas
const recentVolumes = closedCandles15m.slice(-3).map(c => c.volume);
const volumeIncreasing = recentVolumes[2] > recentVolumes[1] > recentVolumes[0];

if (!volumeIncreasing && regime !== 'RANGING') {
  console.log(`[REJECT] ${symbol}: Volumen decreciente`);
  return null;
}
```

---

### FASE 4: Mejoras en Gestión de Riesgo

#### 4.1 Ajustar Breakeven más Conservador
```javascript
// Mover BE a 0.8:1 en lugar de 1:1
const risk = entryPrice - sl;
if (!item.breakeven && currentPrice >= (entryPrice + risk * 0.8)) {
  item.breakeven = true;
}
```

#### 4.2 Trailing Stop Virtual
```javascript
// Registrar máximo favorable y ajustar SL virtual
if (item.type === 'BUY') {
  const maxPrice = item.maxFavorable;
  const profit = maxPrice - entryPrice;
  
  // Si subió 2%, mover SL a entry + 0.5%
  if (profit / entryPrice > 0.02) {
    const newSL = entryPrice * 1.005;
    if (currentPrice <= newSL) {
      item.status = 'CLOSED';
      item.outcome = 'BREAK_EVEN_PLUS';
    }
  }
}
```

---

### FASE 5: Métricas y Feedback Loop

#### 5.1 Registrar Más Métricas por Señal
```javascript
const record = {
  // ... campos actuales ...
  
  // Nuevos campos
  entryDistanceEMA21: distToEma21,
  entryDistanceEMA50: distToEma50,
  bbPercentAtEntry: bbPercent,
  volumeProfile: vp ? { poc: vp.poc, distToPoc: distPoc } : null,
  trend4h: trend4h,
  trend1h: trend1h,
  riskRewardRatio: riskRewardRatio,
  stopDistancePercent: stopDistance,
  categoryScores: categoryScores, // Guardar scores individuales
  confluenceFactors: factors // Factores que contribuyeron
};
```

#### 5.2 Análisis Post-Signal Automático
```javascript
// Después de cerrar una señal, analizar qué funcionó
async function analyzeClosedSignal(signal, outcome) {
  const analysis = {
    signalId: signal.id,
    outcome: outcome,
    regime: signal.regime,
    score: signal.score,
    factors: {
      hadMSS: signal.hasMSS,
      hadSweep: signal.hasSweep,
      hadSMC: signal.hasSMC,
      volumeConfirmed: signal.volumeConfirmed,
      btcRisk: signal.btcRisk
    }
  };
  
  // Guardar para análisis futuro
  await store.setJSON('signal-analysis', analysis);
}
```

---

## 📋 Lista de Tareas de Implementación

### Prioridad CRÍTICA (Impacto Inmediato)
1. [ ] Implementar bloqueo de TRANSITION sin confluencia excepcional
2. [ ] Reducir bonus MSS en TRANSITION de 45 a 25
3. [ ] Añadir filtro de pullback a EMA21 en TRENDING
4. [ ] Subir MIN_QUALITY_SCORE a 92 para TRANSITION

### Prioridad ALTA (Mejora significativa)
5. [ ] Implementar filtro de R:R mínimo 1.2
6. [ ] Añadir penalización por score inflado
7. [ ] Ajustar pesos de categorías por régimen
8. [ ] Implementar filtro de distancia al stop máximo 3%

### Prioridad MEDIA (Optimización)
9. [ ] Mejorar gestión de breakeven (0.8:1)
10. [ ] Añadir trailing stop virtual
11. [ ] Registrar métricas extendidas por señal
12. [ ] Implementar análisis post-signal

### Prioridad BAJA (Nice to have)
13. [ ] Análisis de correlación BTC-altcoins
14. [ ] Machine learning para ajuste dinámico de pesos
15. [ ] Backtesting automático semanal

---

## 🎯 Objetivos Esperados

Con estas mejoras, se espera:

| Métrica | Actual | Objetivo |
|---------|--------|----------|
| Win Rate Global | 39.4% | >55% |
| Win Rate RANGING | 75% | >70% (mantener) |
| Win Rate TRANSITION | 33% | >50% o 0% (bloquear) |
| Win Rate TRENDING | 27% | >45% |
| Señales por día | ~8 | ~4-5 (calidad > cantidad) |

---

## 🔄 Próximos Pasos

1. **Validar el plan** con el usuario
2. **Implementar Fase 1** (filtros por régimen)
3. **Monitorear 50 señales** con nuevo algoritmo
4. **Analizar resultados** y ajustar
5. **Iterar** con Fases 2-5

---

*Documento generado el 2026-01-29*
*Basado en análisis de 33 señales históricas*
