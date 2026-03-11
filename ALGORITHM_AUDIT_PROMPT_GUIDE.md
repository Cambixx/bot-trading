# 📋 Guía Completa de Auditoría del Algoritmo (Performance Review)

> **Uso:** Cuando haya pasado tiempo suficiente o un número significativo de operaciones (mínimo 5 trades cerrados o 2 semanas), sigue esta guía para auditar el rendimiento de `scheduled-analysis.js` de forma rigurosa, reproducible y basada en datos.

---

## 📁 Paso 1 — Preparación de Archivos

Antes de iniciar el chat de auditoría, asegúrate de tener **descargados y actualizados** desde producción:

| Archivo | Criticidad | Propósito |
|---------|-----------|-----------|
| `history.json` | 🔴 CRÍTICO | Resultados reales de cada operación (WIN/LOSS/OPEN/STALE_EXIT) con métricas de entrada, sector, score pre-momentum y ajuste de momentum |
| `persistent_logs.json` | 🔴 CRÍTICO | Historial ininterrumpido de mensajes del servidor (NUEVO v6.0) - Evita el borrado de logs de Netlify |
| `shadow_trades_archive.json` | 🔴 CRÍTICO | Histórico completo de near-misses resueltos/expirados. **Fuente principal** para auditoría longitudinal del self-learning, filtros, correlación y benchmark shadow |
| `shadow_trades.json` | 🟠 IMPORTANTE | Shadow activo reciente. **No es histórico completo**; sirve como ventana operativa de corto plazo |
| `autopsies.json` | 🔴 CRÍTICO | Diagnóstico detallado de trades cerrados con duración, excursiones máximas, sector y trazabilidad del ajuste de momentum |
| `signal_memory.json` | 🟡 RECOMENDADO | Historial de momentum y puntajes por símbolo (NUEVO v6.0) |
| `ALGORITHM_JOURNAL.md` | 🟠 IMPORTANTE | Contexto de la versión activa, hipótesis en prueba y lecciones aprendidas |
| `ALGO_DOCUMENTATION.md` | 🟡 RECOMENDADO | Si se van a cambiar parámetros, se necesita para actualizarlo con los cambios |
| `scheduled-analysis.js` | 🟡 RECOMENDADO | Solo si se detectan bugs o se propone cambio de código |

### 🛠️ Automatización de la descarga
Para agilizar este paso, puedes usar el comando:
```bash
npm run sync
```
Este comando descarga automáticamente todos los archivos necesarios desde Netlify Blobs a tu directorio local, asegurando que trabajas con los datos más frescos.

### Nota importante sobre Shadow Trading

- `shadow_trades_archive.json` debe usarse como base del análisis histórico del self-learning.
- `shadow_trades.json` debe tratarse como una ventana reciente de trabajo, no como la verdad histórica completa.
- Si `shadow_trades_archive.json` no está adjunto, el análisis debe indicarlo explícitamente como **limitación de calidad de datos** antes de sacar conclusiones fuertes sobre filtros o Win Rate fantasma.
- El shadow actual persiste benchmark explícito (`shadowBenchmark`), `wouldHaveTP`, `wouldHaveSL`, `resolvedAt` y near-misses de correlación (`SECTOR_CORRELATION`). La auditoría debe usarlos si están disponibles.
- El ajuste de momentum ya es auditable vía `scoreBeforeMomentum` y `momentumAdjustment` en `history.json`, `shadow_trades*.json` y `autopsies.json`.

---

## 🚀 Paso 2 — Prompt Maestro Recomendado (ChatGPT / Codex)

Este es el prompt que recomiendo usar por defecto en futuras auditorías. Está optimizado para:

- maximizar calidad analítica y no solo producir texto bonito;
- evitar sobreajuste con muestras pequeñas;
- priorizar robustez, expectativa matemática, consistencia y supervivencia del sistema;
- separar claramente datos, inferencias y decisiones;
- impedir cambios de código sin evidencia suficiente.

Copia y pega este prompt en el chat, con los archivos adjuntos vía `@`:

```text
Quiero una auditoría cuantitativa y estratégica completa de mi algoritmo de señales de trading.

Objetivo principal:
No quiero optimización cosmética ni ideas “interesantes”. Quiero decisiones que aumenten la calidad real del sistema: robustez, expectancy, control de drawdown, calidad de entrada, adaptabilidad al régimen y capacidad de escalar hacia un sistema de nivel mundial.

Archivos adjuntos:
- @history.json
- @persistent_logs.json
- @shadow_trades_archive.json
- @shadow_trades.json
- @autopsies.json
- @ALGORITHM_JOURNAL.md
- @ALGO_DOCUMENTATION.md
- @scheduled-analysis.js

Reglas obligatorias:
- Usa `shadow_trades_archive.json` como fuente principal para el análisis histórico del shadow trading.
- Usa `shadow_trades.json` solo como contexto reciente, no como histórico total.
- Si falta algún archivo crítico o hay datos truncados/incompletos, indícalo explícitamente al principio.
- Si el shadow incluye `shadowBenchmark`, documenta el benchmark efectivo antes de interpretar el WR hipotético. No mezcles conclusiones entre benchmarks distintos sin avisarlo.
- Si la muestra de trades reales es pequeña, dilo explícitamente y evita proponer cambios agresivos.
- No propongas cambios de código sin justificar primero el problema con datos.
- No modifiques ningún archivo hasta que yo lo confirme.
- Distingue siempre entre:
  - dato observado
  - inferencia razonable
  - hipótesis a validar

Quiero que estructures la auditoría exactamente así:

1. Resumen ejecutivo
- Dame un veredicto inicial en 3-6 líneas.
- Indica si la muestra tiene o no validez estadística suficiente.
- Indica si el problema principal parece ser:
  - frecuencia
  - calidad de entrada
  - régimen de mercado
  - gestión TP/SL
  - filtros demasiado laxos
  - filtros demasiado restrictivos

2. Métricas reales de performance
- Calcula el Win Rate real con la fórmula:
  WR = WIN / (WIN + LOSS)
  Excluye OPEN y STALE_EXIT del denominador.
- Desglosa el WR por régimen.
- Muestra:
  - total trades cerrados
  - % WIN
  - % LOSS
  - % STALE_EXIT
  - R:R real promedio
- Si hay menos de 5 trades cerrados, dilo explícitamente.

3. Frecuencia y throughput del sistema
- ¿Cuántas señales reales se generaron?
- ¿Cuántos near-misses hay en histórico y cuántos en la ventana reciente?
- ¿La frecuencia actual es coherente con la calidad esperada del sistema o está demasiado filtrado?

4. Auditoría de shadow trading
- Calcula el WR hipotético de los near-misses usando `WOULD_WIN` y `WOULD_LOSE`.
- Separa:
  - conclusión histórica (`shadow_trades_archive.json`)
  - conclusión reciente (`shadow_trades.json`)
- Identifica el filtro más costoso en términos de trades ganadores perdidos.
- Evalúa si los ajustes de momentum `+3 / -5` aportan señal útil o ruido usando `scoreBeforeMomentum` y `momentumAdjustment` si existen.
- Identifica cuántos near-misses provienen de `SECTOR_CORRELATION` y si el filtro sectorial está bloqueando edge real o evitando sobreexposición útil.
- Si existe `shadowBenchmark`, `wouldHaveTP` y `wouldHaveSL`, aclara explícitamente con qué benchmark se está calculando el shadow antes de interpretar su WR.
- Si el shadow reciente contradice el histórico, prioriza el histórico y explica por qué.

5. Autopsia de operaciones reales
- Para cada LOSS, clasifica la causa probable usando `history.json`, `autopsies.json` y `persistent_logs.json`.
- Usa estas categorías si aplican:
  - Fake Breakout
  - Entrada overextended
  - Correlación BTC
  - Volumen engañoso
  - Stop demasiado ajustado
  - Baja liquidez / mala sesión
  - Cambio macro / ruptura estructural
- Para cada trade, explica brevemente por qué encaja en esa categoría.
- Clasifica también los STALE_EXIT si existen.

6. Revisión del Journal
- Evalúa cuáles hipótesis pendientes quedan:
  - validadas
  - refutadas
  - inconclusas
- Detecta si alguna “lesson learned” se repite otra vez.
- Indica si el mercado actual favorece probar alguna hipótesis pendiente.

7. Contexto de mercado
- Determina si el período analizado fue mayoritariamente:
  - TRENDING
  - RANGING
  - TRANSITION
  - DOWNTREND
- Indica el color predominante de BTC-SEM.
- Señala eventos de volatilidad, sesiones problemáticas o condiciones especiales.
- Marca explícitamente qué conclusiones son inferencias y no lecturas directas.

8. Diagnóstico estratégico
- Responde cuál es el cuello de botella dominante del sistema ahora mismo:
  - demasiadas pocas señales
  - entradas mediocres
  - mala adaptación al régimen
  - TP/SL mal calibrado
  - sesgo excesivo a TRANSITION
  - dependencia excesiva de BTC context
- Si el WR < 40% o el shadow da una alerta clara, compara estas alternativas:
  - Momentum con filtro fuerte de régimen
  - Capitulation bounce
  - Alineación multi-timeframe pura
  - Volatility breakout
- Si ninguna mejora realmente el sistema, explica por qué.

9. Recomendación final
- Elige solo una:
  - MANTENER
  - AJUSTE QUIRÚRGICO
  - AJUSTE MAYOR
  - REVERTIR
- Si propones cambios:
  - explica exactamente qué cambiarías
  - por qué
  - qué riesgo intenta corregir
  - qué métrica debería mejorar si el cambio funciona
- Si propones cambios de código, indica archivo y línea aproximada, pero no modifiques nada todavía.

10. Checklist final
- Confirma uno por uno:
  - WR calculado
  - LOSS/STALE analizados
  - shadow histórico vs reciente diferenciados
  - hipótesis del journal evaluadas
  - contexto de mercado documentado
  - veredicto emitido

Formato de respuesta obligatorio:
- Primero hallazgos y diagnóstico.
- Después veredicto.
- Después recomendaciones.
- Sé directo, preciso y orientado a evidencia.
- No rellenes con generalidades.
```

---

## 🚀 Paso 3 — Prompt de Auditoría Completo (Versión Larga)

Copia y pega el siguiente prompt en el chat, con los archivos adjuntos via `@`, si prefieres una versión más detallada y prescriptiva:

```text
Hola. Quiero hacer una auditoría de rendimiento completa del algoritmo de trading.

He actualizado y adjunto los siguientes archivos:
- @history.json — Últimas operaciones con sus resultados.
- @persistent_logs.json — El historial persistente de logs (sustituye a logs.txt).
- @shadow_trades_archive.json — Histórico completo de operaciones fantasma resueltas/expiradas.
- @shadow_trades.json — Ventana activa reciente de operaciones fantasma (near-misses).
- @autopsies.json — Diagnóstico de trades cerrados.
- @ALGORITHM_JOURNAL.md — Contexto, hipótesis en prueba y lecciones aprendidas.

Por favor realiza las siguientes tareas **antes de tocar ningún código**:

### REGLAS DE ANÁLISIS

- Usa `shadow_trades_archive.json` como fuente principal para el análisis histórico del shadow trading.
- Usa `shadow_trades.json` solo como complemento para el contexto más reciente.
- Si falta `shadow_trades_archive.json`, indícalo explícitamente y reduce tu nivel de confianza en cualquier conclusión de self-learning.
- Si los archivos de shadow incluyen `shadowBenchmark`, `wouldHaveTP` y `wouldHaveSL`, documenta primero el benchmark efectivo y no mezcles conclusiones entre benchmarks distintos.
- No asumas que el archivo de shadow activo representa todo el historial.
- Si la muestra de trades reales es pequeña, dilo de forma explícita y evita sobreajustes.

---

### BLOQUE 1 — Métricas de Rendimiento

1. **Calcula el Win Rate real** de los trades en `history.json`:
   - Fórmula: WR = WINs / (WINs + LOSSes). Excluir OPEN y STALE_EXIT del denominador.
   - Analiza el Win Rate desglosado **POR RÉGIMEN** (Trending, Ranging, Transition, etc.).
   - Muestra también: total trades cerrados, % LOSSes, % STALE_EXITs.
   - Si hay menos de 5 trades cerrados, indícalo explícitamente.

2. **Frecuencia de señales:** ¿Cuántas señales se generaron reales vs cuántos near-misses se guardaron en `shadow_trades_archive.json` y `shadow_trades.json`?
   - Distingue entre:
     - total histórico (`shadow_trades_archive.json`)
     - ventana reciente (`shadow_trades.json`)
   - Si existe `SECTOR_CORRELATION`, separa cuántos near-misses vienen de filtros clásicos (score/BTC/strong categories) vs cuántos vienen del filtro de correlación.

3. **R:R Real promedio y Autopsias:** Utiliza `autopsies.json` para calcular:
   - Tiempo promedio que un trade ganador (WIN) está abierto vs. un perdedor (LOSS).
   - Máximo movimiento favorable promedio (maxFavorableMove) en los trades LOSS antes de revertirse e ir a Stop Loss.

---

### BLOQUE 1.5 — Análisis de Self-Learning (Shadow Trading)

4. **Evalúa las oportunidades fantasma (`shadow_trades_archive.json` + `shadow_trades.json`):**
   - ¿Cuál habría sido el Win Rate de los *near-misses* si se hubieran operado (considerando los WOULD_WIN y WOULD_LOSE)?
   - ¿Qué filtro nos está costando más trades ganadores? (Filtro más costoso basado en rechazos que terminaron en WOULD_WIN).
   - Analiza si los ajustes de Momentum (+3 / -5) están beneficiando al sistema o introduciendo ruido usando `scoreBeforeMomentum` y `momentumAdjustment` si están presentes.
   - Separa explícitamente los near-misses `SECTOR_CORRELATION` del resto para medir si la correlación está controlando riesgo o bloqueando throughput innecesariamente.
   - Si el archivo incluye `shadowBenchmark`, `wouldHaveTP` y `wouldHaveSL`, especifica el benchmark usado antes de citar el WR fantasma.
   - Separa claramente:
     - conclusión histórica (archivo `archive`)
     - conclusión reciente (archivo activo)
   - Si ambas conclusiones difieren, explícalo y prioriza el histórico para decisiones estratégicas.

---

### BLOQUE 2 — Análisis de Patrones de Pérdida

5. **Clasifica cada trade LOSS** cruzando `autopsies.json`, `history.json` y `persistent_logs.json`. Para cada LOSS, identifica la causa probable:
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
   - Si una conclusión es una inferencia y no una lectura directa del dato, márcala explícitamente como **inferencia**.

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
12. Si la muestra es insuficiente o los datos están truncados/incompletos, dilo de forma explícita y prioriza **no tocar código** salvo que haya un bug claro.

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
| Muchas señales bloqueadas por `SECTOR_CORRELATION` con shadow fuerte | 🔧 Revisar correlación por sector, no bajar score global |
| Shadow fuerte solo con benchmark muy laxo | ⚠️ No relajar filtros hasta revisar `shadowBenchmark` |
| Shadow activo contradice al archivo histórico | ⚠️ Priorizar el histórico y revisar si el activo está truncado o sesgado |

---

## 📝 Checklist Final Post-Auditoría

Antes de cerrar cualquier sesión de auditoría, confirma que se han completado:

- [ ] Win Rate calculado
- [ ] Trades LOSS/STALE_EXIT analizados individualmente
- [ ] Hipótesis del Journal evaluadas
- [ ] Contexto de mercado documentado
- [ ] Shadow histórico vs shadow activo diferenciados
- [ ] Benchmark shadow explícitamente documentado si existe en los archivos
- [ ] Efecto de `momentumAdjustment` evaluado si existe en los archivos
- [ ] Near-misses `SECTOR_CORRELATION` revisados si existen
- [ ] Veredicto emitido (MANTENER / AJUSTE / REVERTIR)
- [ ] Si hubo cambios: `ALGORITHM_JOURNAL.md` actualizado
- [ ] Si hubo cambios: `ALGO_DOCUMENTATION.md` actualizado
- [ ] Si hubo cambios: confirmación en logs del siguiente ciclo pendiente
