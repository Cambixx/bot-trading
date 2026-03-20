# Guía Unificada de Auditoría del Algoritmo

> Uso recomendado: cuando haya al menos `5` trades cerrados o haya pasado `1-2 semanas` desde la última revisión relevante. El objetivo de esta guía es dejar una sola plantilla de auditoría, rigurosa y reutilizable, para evaluar `scheduled-analysis.js` con foco en `spot` long-only, `scalping` y `day trading`.

## Archivos a adjuntar

| Archivo | Criticidad | Propósito |
|---------|-----------|-----------|
| `history.json` | CRÍTICO | Resultados reales de las operaciones |
| `persistent_logs.json` | CRÍTICO | Logs persistentes del sistema |
| `shadow_trades_archive.json` | CRÍTICO | Histórico completo de near-misses resueltos/expirados |
| `shadow_trades.json` | IMPORTANTE | Ventana activa reciente de near-misses |
| `autopsies.json` | CRÍTICO | Diagnóstico de trades cerrados |
| `ALGORITHM_JOURNAL.md` | IMPORTANTE | Contexto, hipótesis y lecciones aprendidas |
| `ALGO_DOCUMENTATION.md` | OPCIONAL | Necesario si se aprueban cambios |
| `scheduled-analysis.js` | OPCIONAL | Necesario si se detecta bug o se propone cambio línea a línea |

## Sincronización local

```bash
npm run sync
```

## Prompt Canónico de Auditoría

Copia y pega este prompt en el chat junto con los archivos adjuntos vía `@`.

```text
Quiero una auditoría cuantitativa y estratégica completa de mi algoritmo de trading.

Contexto operativo:
- El sistema está pensado para spot long-only.
- Mi estilo es scalping y day trading.
- Solo compro para vender más caro; no hago short.
- Quiero priorizar robustez, calidad de entrada, adaptación al régimen, control de drawdown y capacidad de escalar el sistema sin sobreajuste.

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
- Usa `shadow_trades.json` solo como complemento reciente; no asumas que representa todo el historial.
- Si falta `shadow_trades_archive.json`, dilo explícitamente al principio y reduce tu confianza en cualquier conclusión de self-learning.
- Si los archivos shadow incluyen `shadowBenchmark`, `wouldHaveTP` y `wouldHaveSL`, documenta primero el benchmark efectivo y no mezcles conclusiones entre benchmarks distintos.
- Comprueba si `shadow_trades.json` solapa o duplica registros ya presentes en `shadow_trades_archive.json`; si ocurre, dilo antes de interpretar la ventana activa.
- Si la muestra real es pequeña, está truncada o está concentrada en muy poco tiempo, dilo explícitamente y evita sobreajustes.
- Separa siempre con claridad:
  - dato observado
  - inferencia razonable
  - hipótesis a validar
- Si detectas errores operativos o bugs en logs/código, sepáralos del diagnóstico estratégico. No mezcles "fallo de implementación" con "falta de edge".
- Respeta el contexto spot long-only al evaluar estrategias: no propongas lógica pensada para shorting como solución principal.
- No modifiques ningún archivo hasta que yo lo confirme.
- Si propones cambios, prioriza primero ajustes concretos y verificables antes que rediseños innecesarios.

Quiero que estructures la auditoría exactamente así:

1. Resumen ejecutivo
- Dame un veredicto inicial en 4-8 líneas.
- Indica si la muestra tiene validez suficiente o si la confianza es baja.
- Resume cuál parece ser el cuello de botella dominante:
  - frecuencia
  - calidad de entrada
  - mala adaptación al régimen
  - TP/SL
  - filtros demasiado restrictivos
  - filtros demasiado laxos
  - bug operativo / fallo de implementación

2. Calidad de datos y alcance
- Indica qué archivos están presentes y cuáles faltan.
- Aclara el rango temporal real analizado si puede inferirse.
- Di si `shadow_trades.json` está truncado, duplicado o solapado respecto al archive.
- Si hay cualquier limitación fuerte de datos, dilo aquí antes de entrar en conclusiones.

3. Métricas reales de rendimiento
- Calcula el Win Rate real con la fórmula:
  WR = WIN / (WIN + LOSS)
- Excluye `OPEN` y `STALE_EXIT` del denominador.
- Desglosa el WR por régimen.
- Muestra también:
  - total trades cerrados
  - % WIN
  - % LOSS
  - % STALE_EXIT
  - R:R real promedio
  - tiempo medio abierto de WIN vs LOSS
- Si hay menos de 5 trades cerrados, dilo explícitamente.

4. Frecuencia y throughput
- ¿Cuántas señales reales se generaron?
- ¿Cuántos near-misses hay en histórico y cuántos en ventana reciente?
- Separa, si existe, cuántos near-misses vienen de `SECTOR_CORRELATION` y cuántos vienen de filtros clásicos.
- Evalúa si la frecuencia está alineada con un sistema de scalping/day trading spot o si está excesivamente filtrado.

5. Auditoría de shadow trading
- Calcula el WR hipotético de los near-misses usando `WOULD_WIN` y `WOULD_LOSE`.
- Separa claramente:
  - conclusión histórica (`shadow_trades_archive.json`)
  - conclusión reciente (`shadow_trades.json`)
- Identifica el filtro más costoso en términos de ganadores perdidos.
- Evalúa si `SECTOR_CORRELATION` está controlando riesgo o bloqueando throughput sin necesidad.
- Evalúa el efecto de `scoreBeforeMomentum` y `momentumAdjustment` si existen.
- Si el shadow reciente contradice al histórico, prioriza el histórico para decisiones estratégicas y explica por qué.
- Si el benchmark shadow es laxo o cambió entre muestras, dilo antes de interpretar cualquier WR fantasma.

6. Autopsia de operaciones reales
- Clasifica cada `LOSS` cruzando `history.json`, `autopsies.json` y `persistent_logs.json`.
- Usa, cuando aplique, estas categorías:
  - Fake Breakout
  - Entrada overextended
  - Correlación BTC
  - Volumen engañoso
  - Stop demasiado ajustado
  - Baja liquidez / mala sesión
  - Cambio macro / ruptura estructural
- Para cada trade LOSS, explica brevemente la causa probable y marca si es dato directo o inferencia.
- Clasifica también los `STALE_EXIT` si existen:
  - sin impulso real desde el inicio
  - estancamiento tras avance favorable inicial

7. Revisión del Journal
- Revisa `ALGORITHM_JOURNAL.md` y clasifica las `Pending Hypotheses` en:
  - validadas
  - refutadas
  - inconclusas
- Detecta si alguna `Lesson Learned` reaparece como patrón.
- Indica si el mercado actual sugiere probar alguna hipótesis pendiente o descartarla.

8. Contexto de mercado
- Determina si el período analizado fue mayoritariamente:
  - TRENDING
  - RANGING
  - TRANSITION
  - DOWNTREND
- Indica el color predominante de `BTC-SEM`.
- Señala si hubo sesiones problemáticas, baja liquidez, volatilidad excepcional o eventos relevantes.
- Marca explícitamente como `inferencia` cualquier conclusión que no salga de una lectura directa del dato.

9. Diagnóstico estratégico
- Responde cuál es el cuello de botella dominante del sistema en este momento.
- Si el WR < 40% o el shadow da una alerta clara, compara estas opciones desde la óptica spot long-only:
  - operar solo `RANGING` y `TRENDING`
  - `Capitulation Bounce` solo bajo condiciones extremas y confirmadas
  - alineación multi-timeframe pura
  - volatility breakout
- Si ninguna mejora realmente el sistema, explica por qué la estrategia actual sigue siendo la adecuada.
- Si detectas que el problema central es de implementación y no de edge, dilo de forma explícita.

10. Recomendación final
- Elige solo una:
  - MANTENER
  - AJUSTE QUIRÚRGICO
  - AJUSTE MAYOR
  - REVERTIR
- Si propones cambios:
  - explica exactamente qué cambiarías
  - por qué
  - qué riesgo intentas corregir
  - qué métrica debería mejorar si el cambio funciona
- Si propones cambios de código, indica archivo y línea aproximada, pero no modifiques nada todavía.

11. Post-implementación, solo si yo apruebo cambios
- Actualiza `ALGORITHM_JOURNAL.md` con:
  - nueva versión
  - cambios realizados
  - bugs encontrados
  - nuevas hipótesis
  - lecciones aprendidas
- Actualiza `ALGO_DOCUMENTATION.md` con:
  - changelog
  - parámetros actualizados
  - cambios de filtros, regímenes o SL/TP
- Si es posible, valida el comportamiento con `manual-run.js` o equivalente y confirma qué logs esperas ver en el siguiente ciclo.

12. Checklist final
- Confirma uno por uno:
  - WR calculado
  - LOSS/STALE revisados
  - shadow histórico vs activo diferenciados
  - benchmark shadow explicitado si existe
  - `momentumAdjustment` evaluado si existe
  - `SECTOR_CORRELATION` revisado si existe
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

## Nota práctica

Si la auditoría acaba proponiendo cambios de código, no se deben aplicar en la misma respuesta salvo aprobación explícita posterior. La auditoría primero debe demostrar el problema; la implementación va después.
