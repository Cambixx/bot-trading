# 📋 Guía Completa de Auditoría del Algoritmo (Performance Review)

> **Uso:** Cuando haya pasado tiempo suficiente o un número significativo de operaciones (mínimo 5 trades cerrados o 2 semanas), sigue esta guía para auditar el rendimiento de `scheduled-analysis.js` de forma rigurosa y basada en datos.

---

## 📁 Paso 1 — Preparación de Archivos

Antes de iniciar el chat de auditoría, asegúrate de tener **descargados y actualizados** desde producción:

| Archivo | Criticidad | Propósito |
|---------|-----------|-----------|
| `history.json` | 🔴 CRÍTICO | Resultados reales de cada operación (WIN/LOSS/OPEN/STALE_EXIT) con métricas de entrada |
| `shadow_trades.json` | 🔴 CRÍTICO | Registro de operaciones fantasma y near-misses (NUEVO v6.0) |
| `autopsies.json` | 🔴 CRÍTICO | Diagnóstico detallado de trades cerrados con duración y excursiones máximas (NUEVO v6.0) |
| `signal_memory.json` | 🟡 RECOMENDADO | Historial de momentum y puntajes por símbolo (NUEVO v6.0) |
| `logs.txt` | 🔴 CRÍTICO | Registro de decisiones del servidor: qué se rechazó y por qué |
| `ALGORITHM_JOURNAL.md` | 🟠 IMPORTANTE | Contexto de la versión activa, hipótesis en prueba y lecciones aprendidas |
| `ALGO_DOCUMENTATION.md` | 🟡 RECOMENDADO | Si se van a cambiar parámetros, se necesita para actualizarlo con los cambios |
| `scheduled-analysis.js` | 🟡 RECOMENDADO | Solo si se detectan bugs o se propone cambio de código |

---

## 🚀 Paso 2 — Prompt de Auditoría Completo

Copia y pega el siguiente prompt en el chat, con los archivos adjuntos via `@`:

```text
Hola. Quiero hacer una auditoría de rendimiento completa del algoritmo de trading.

He actualizado y adjunto los siguientes archivos:
- @history.json — Últimas operaciones con sus resultados.
- @shadow_trades.json — Historial de operaciones fantasma (near-misses).
- @autopsies.json — Diagnóstico de trades cerrados.
- @logs.txt — Registro de decisiones del servidor.
- @ALGORITHM_JOURNAL.md — Contexto, hipótesis en prueba y lecciones aprendidas.

Por favor realiza las siguientes tareas **antes de tocar ningún código**:

---

### BLOQUE 1 — Métricas de Rendimiento

1. **Calcula el Win Rate real** de los trades en `history.json`:
   - Fórmula: WR = WINs / (WINs + LOSSes). Excluir OPEN y STALE_EXIT del denominador.
   - Analiza el Win Rate desglosado **POR RÉGIMEN** (Trending, Ranging, Transition, etc.).
   - Muestra también: total trades cerrados, % LOSSes, % STALE_EXITs.
   - Si hay menos de 5 trades cerrados, indícalo explícitamente.

2. **Frecuencia de señales:** ¿Cuántas señales se generaron reales vs cuántos near-misses se guardaron en `shadow_trades.json`?

3. **R:R Real promedio y Autopsias:** Utiliza `autopsies.json` para calcular:
   - Tiempo promedio que un trade ganador (WIN) está abierto vs. un perdedor (LOSS).
   - Máximo movimiento favorable promedio (maxFavorableMove) en los trades LOSS antes de revertirse e ir a Stop Loss.

---

### BLOQUE 1.5 — Análisis de Self-Learning (Shadow Trading)

4. **Evalúa las oportunidades fantasma (`shadow_trades.json`):**
   - ¿Cuál habría sido el Win Rate de los *near-misses* si se hubieran operado (considerando los WOULD_WIN y WOULD_LOSE)?
   - ¿Qué filtro nos está costando más trades ganadores? (Filtro más costoso basado en rechazos que terminaron en WOULD_WIN).
   - Analiza si los ajustes de Momentum (+3 / -5) están beneficiando al sistema o introduciendo ruido.

---

### BLOQUE 2 — Análisis de Patrones de Pérdida

5. **Clasifica cada trade LOSS** cruzando `autopsies.json`, `history.json` y `logs.txt`. Para cada LOSS, identifica la causa probable:
   - 🔴 **Falsa ruptura (Fake Breakout):** MSS confirmado pero precio revirtió rápidamente.
   - 🔴 **Entrada overextended:** bbPercent > 0.90 o RSI > 70 en el momento de entrada.
   - 🟠 **Correlación BTC:** ¿BTC-SEM era RED o AMBER cuando se entró? ¿Hubo giro bajista intraday?
   - 🟠 **Volumen engañoso:** volumeRatio alto pero delta negativo (OBI contrario a la señal).
   - 🟡 **Stop demasiado ajustado:** Precio tocó SL pero luego recuperó hacia TP (R:R problemático).
   - 🟡 **Sesión de baja liquidez:** ¿La señal se generó en horario Asia o pre-Londres?
   - ⚪ **Cambio de tendencia macro:** Evento externo o ruptura estructural post-entrada.

6. **Clasifica los STALE_EXIT:** ¿Son trades que nunca se movieron favorablemente (entradas sin momentum real) o trades que se estancaron después de un movimiento inicial positivo? Revisa el campo `favorableMovePct` en `autopsies.json`.

---

### BLOQUE 3 — Revisión del Journal

7. **Revisa el `ALGORITHM_JOURNAL.md`:**
   - ¿Las hipótesis en "Pending Hypotheses" han sido validadas o refutadas por los datos?
   - ¿Alguna "Lesson Learned" anterior se repite como patrón en estos datos nuevos?
   - ¿El mercado actual sugiere que debemos probar alguna de las hipótesis pendientes?

8. **Evalúa el contexto de mercado durante el período** basándote en los logs y autopsias:
   - ¿El mercado estaba mayoritariamente en DOWNTREND, RANGING o TRENDING?
   - ¿El BTC-SEM fue predominantemente RED, AMBER o GREEN?
   - ¿Hubo sesiones de alta volatilidad o eventos extraordinarios?

---

### BLOQUE 4 — Innovación Estratégica

9. **Si el WR < 40% o hay una alerta clara del Shadow Trading**, propón alternativas estratégicas modernas o ajustes adaptativos. Considera:

   **A) Estrategias de Momentum con Filtro de Regime:**
   - Solo operar en regímenes RANGING (Mean Reversion) + TRENDING (Pullback), ignorando TRANSITION y DOWNTREND completamente.
   - Ventaja: Menos señales pero de mayor calidad en regímenes predecibles.

   **B) Estrategia de Rebote en Oversold Extremo ("Capitulation Bounce"):**
   - Activar solo cuando BTC RSI4H < 35 + BTC-SEM GREEN + estructura confirmada.
   - Captura rebotes desde capitulación — alta expectativa cuando el mercado está en panic sell.

   **C) Estrategia de Alineación Multi-Timeframe Pura:**
   - Exigir que TODOS los timeframes (15m, 1h, 4h) estén en tendencia alcista simultáneamente.
   - Reduce señales a 1-2 por semana pero con alta probabilidad de continuación.

   **D) Estrategia de Volatility Breakout:**
   - Detectar compresión de Bollinger Bands (bandwidth en mínimos de 20 velas) + ruptura con volumen > 2x.
   - Captura arranques explosivos después de períodos de consolidación.

   Si ninguna aplica, explica por qué la estrategia actual es correcta para el entorno actual.

---

### BLOQUE 5 — Veredicto y Recomendación

10. **Da un veredicto claro** con una de estas opciones:
   - ✅ **MANTENER:** El algoritmo está funcionando correctamente. Solo observar.
   - 🔧 **AJUSTE QUIRÚRGICO:** 1-2 cambios específicos de parámetros o filtros. Indica exactamente qué línea del código y qué cambio.
   - 🔄 **AJUSTE MAYOR:** Cambio significativo de estrategia o de múltiples parámetros. Requiere más pruebas antes de producción.
   - ❌ **REVERTIR:** La versión actual empeora el rendimiento. Propón exactamente a qué configuración revertir.

11. Si se propone cualquier cambio de código, **espera mi confirmación** antes de modificar `scheduled-analysis.js`. Analiza primero, actúa después.

---

### POST-IMPLEMENTACIÓN (si se aprueba un cambio)

Si implementamos cambios en el código, asegúrate de:
1. Actualizar `ALGORITHM_JOURNAL.md` con: nueva versión, cambios realizados, bugs encontrados, nuevas hipótesis y lecciones aprendidas.
2. Actualizar `ALGO_DOCUMENTATION.md` con: nueva versión en el changelog, parámetros actualizados en las tablas de regímenes y SL/TP, y cualquier filtro nuevo añadido.
3. Confirmar que los logs del próximo ciclo muestran los nuevos mensajes de rechazo/aceptación esperados.
```

---

## 📊 Criterios de Decisión Rápida

Usa esta tabla como referencia rápida al recibir el análisis:

| Situación | Acción Recomendada |
|-----------|-------------------|
| WR ≥ 60% + frecuencia OK | ✅ Mantener — el algo funciona |
| WR 40-60% + pocas señales | 🔧 Ajuste menor en umbrales de score |
| WR 40-60% + R:R < 1.5 | 🔧 Ajustar multiplicadores TP/SL |
| WR < 40% + patrón de fake breakout | 🔄 Endurecer filtros de estructura |
| WR < 40% + mercado bajista global | ⚠️ Evaluar contexto antes de tocar código |
| 0 señales en > 5 días | 🔄 Los filtros son demasiado restrictivos — relajar selectivamente |
| R:R promedio > 2.0 pero WR < 30% | 🔄 El problema no es el R:R sino la calidad de entrada |

---

## 📝 Checklist Final Post-Auditoría

Antes de cerrar cualquier sesión de auditoría, confirma que se han completado:

- [ ] Win Rate calculado
- [ ] Trades LOSS/STALE_EXIT analizados individualmente
- [ ] Hipótesis del Journal evaluadas
- [ ] Contexto de mercado documentado
- [ ] Veredicto emitido (MANTENER / AJUSTE / REVERTIR)
- [ ] Si hubo cambios: `ALGORITHM_JOURNAL.md` actualizado
- [ ] Si hubo cambios: `ALGO_DOCUMENTATION.md` actualizado
- [ ] Si hubo cambios: confirmación en logs del siguiente ciclo pendiente
