# Guía Maestra para Rediseñar y Auditar el Algoritmo

> Actualizada: `2026-03-31`
>
> Esta guía sustituye la versión centrada solo en auditoría. Su objetivo es obligar a cualquier rediseño de `netlify/functions/scheduled-analysis.js` a partir de evidencia online, validación rigurosa y restricciones reales de `spot` cripto `long-only` intradía.

## Objetivo real

No quiero otra iteración de “más indicadores + más parches + más umbrales”. Quiero un rediseño serio, con base empírica, orientado a señales de alta calidad para:

- `spot` cripto
- `long-only`
- `day trading` / intradía
- compra para vender más caro
- foco en robustez, expectativa matemática, drawdown control, liquidez real y consistencia entre paper/shadow/live

## Lo que esta guía ya asume como punto de partida

La investigación online usada para redactar esta guía sugiere, con distintos niveles de fuerza, lo siguiente:

1. En cripto, el edge más repetido en la literatura no viene de “indicator soup”, sino de familias tipo `momentum`, `trend following`, `moving averages`, `relative strength` y confirmación por `volume/liquidity`.
2. La reversión de muy corto plazo aparece con más frecuencia en activos pequeños e ilíquidos; en activos grandes y líquidos suele ser más robusto el `momentum`.
3. El volumen importa, pero no como fetiche aislado: funciona mejor combinado con precio, liquidez y contexto de régimen.
4. Los modelos complejos no muestran una superioridad robusta frente a reglas más simples y bien validadas; el sobreajuste es un riesgo central.
5. `stop-loss`, `volatility scaling` y control explícito del riesgo mejoran mucho el perfil de retorno/riesgo.
6. Las ventanas intradía importan: la actividad y la volatilidad tienden a concentrarse alrededor del solapamiento Europa/EE. UU.; la madrugada UTC suele ser peor en liquidez.
7. En cripto, los backtests que “ganan” demasiado a menudo dependen de activos difíciles de ejecutar, datos ilíquidos, benchmarks inconsistentes o outliers; eso debe tratarse como sospecha, no como edge.

## Implicación para `scheduled-analysis.js`

Si el código actual:

- mezcla demasiadas señales correlacionadas
- suma scores ad hoc
- usa conceptos sin evidencia robusta
- tiene desalineación entre `shadow` y `live`
- optimiza sobre muestras pequeñas
- o depende de filtros que no resisten explicación causal

entonces la respuesta correcta no es “ajustar dos thresholds”, sino simplificar la arquitectura y reconstruirla.

## Archivos a adjuntar

Adjunta siempre esto al pedir el rediseño:

| Archivo | Criticidad | Propósito |
|---|---|---|
| `netlify/functions/scheduled-analysis.js` | CRÍTICO | Algoritmo actual a reemplazar o rediseñar |
| `history.json` | CRÍTICO | Trades reales cerrados y abiertos |
| `persistent_logs.json` | CRÍTICO | Trazabilidad operativa |
| `shadow_trades_archive.json` | CRÍTICO | Near-misses históricos |
| `shadow_trades.json` | IMPORTANTE | Ventana activa reciente |
| `autopsies.json` | CRÍTICO | Causas probables de fallos |
| `ALGORITHM_JOURNAL.md` | IMPORTANTE | Hipótesis, cambios, lecciones |
| `ALGO_DOCUMENTATION.md` | OPCIONAL | Contexto funcional y changelog |
| `netlify/functions/market-data.js` | OPCIONAL | Si el rediseño requiere cambiar ingestión o estructura de datos |

## Sincronización local

```bash
npm run sync
```

## Fuentes base que inspiraron esta guía

Estas referencias no sustituyen la investigación online del próximo rediseño; son el punto de partida mínimo que no debe ignorarse:

1. Liu & Tsyvinski, `Risks and Returns of Cryptocurrency`, NBER 2018 / RFS 2021: fuerte evidencia de `time-series momentum` y atención del inversor como predictores.
2. Dobrynskaya, `Dynamic time series momentum of cryptocurrencies`, 2021: los periodos de momentum en cripto son frecuentes y una estrategia de momentum puede batir buy-and-hold con mejor perfil ajustado al riesgo.
3. Wen et al., `Intraday return predictability in the cryptocurrency markets`, 2022: existen tanto momentum intradía como reversal; el patrón cambia con jumps, FOMC y liquidez.
4. Corbet et al., `The effectiveness of technical trading rules in cryptocurrency markets`, 2019: el `variable-length moving average` destaca en BTC de alta frecuencia y las señales de compra superan a las de venta.
5. Gerritsen et al., `Technical trading and cryptocurrencies`, 2020: muchas reglas técnicas conservan poder predictivo y reducen drawdowns, pero hay que controlar el data snooping.
6. Huang, Sangiorgi & Urquhart, `Cryptocurrency Volume-Weighted Time Series Momentum`, SSRN 2024: el volumen puede mejorar materialmente las estrategias de momentum.
7. Brauneis, Mestel & Theissen, `The crypto world trades at tea time`, 2024: volumen, volatilidad e iliquidez muestran patrones intradía muy marcados, con picos en la tarde UTC.
8. `Impact of size and volume on cryptocurrency momentum and reversal`, 2023: la reversión corta se concentra sobre todo en coins pequeñas/ilíquidas; las grandes y líquidas muestran momentum más robusto.
9. `Machine learning and the cross-section of cryptocurrency returns`, 2024: las variables simples de precio, momentum e iliquidez explican gran parte del edge; la complejidad adicional aporta poco.
10. `Stop-loss rules and momentum payoffs in cryptocurrencies`, 2023, y `Cryptocurrency market risk-managed momentum strategies`, 2025: el control explícito del riesgo mejora retornos ajustados y/o Sharpe.

## Principios obligatorios del próximo rediseño

1. Prioriza evidencia antes que creatividad.
2. Prioriza simplicidad robusta antes que complejidad brillante.
3. Prioriza activos grandes y líquidos antes que “oportunidades” dudosas.
4. Prioriza consistencia live/shadow antes que métricas bonitas.
5. Prioriza validación out-of-sample antes que performance in-sample.
6. Prioriza estructuras con explicación causal razonable antes que combos arbitrarios de indicadores.

## Lo que NO quiero en el próximo algoritmo

No quiero que el rediseño:

- siga el patrón de `score` inflado con bonus y penalties cada vez más locales
- mezcle lógica `long-only` con residuos de lógica de venta/short como eje principal
- dependa de conceptos tipo `order block`, `FVG`, `MSS`, `sweep`, etc. sin demostrar edge incremental con datos
- use comentarios grandilocuentes o “marketing code” tipo `millonaria`, `god-tier`, etc.
- mantenga benchmarks `shadow` más laxos que la lógica `live`
- compre activos con liquidez teórica pero mala ejecutabilidad real
- optimice thresholds usando muestras pequeñas o periodos demasiado recientes
- proponga machine learning opaco si no supera claramente una baseline simple y explicable

## Arquitectura prioritaria que esta guía favorece

A falta de evidencia mejor en la próxima investigación, el rediseño debe evaluar primero estas familias, en este orden:

1. `Trend Pullback Continuation`
   - Núcleo principal esperado.
   - Buscar activos grandes/líquidos en tendencia alcista, con fortaleza relativa y pullback controlado.

2. `Breakout Continuation With Volume`
   - Solo si la ruptura ocurre con expansión real de volumen/liquidez y sin sobreextensión absurda.

3. `Range Reclaim / Mean Reversion`
   - Solo como módulo secundario y únicamente si la validación demuestra edge robusto en activos líquidos.
   - No asumir que la reversión de corto plazo en coins pequeñas es utilizable.

Si la investigación futura no justifica un tercer módulo, mejor dejar el sistema en `1-2` módulos sólidos que en `4-5` módulos mediocres.

## Estructura mínima deseable del nuevo algoritmo

El nuevo `scheduled-analysis.js` debería acercarse a esta secuencia:

1. `Universe filter`
   - Solo pares `USDT`
   - Filtro duro de spread, profundidad, volumen y tradabilidad
   - Preferencia por activos de alta capitalización/liquidez real

2. `Market regime layer`
   - Clasificación simple, explicable y estable
   - Ejemplo: `trend`, `range`, `high-vol breakout`, `risk-off`
   - BTC y/o benchmark de mercado pueden usarse como contexto, no como excusa difusa

3. `Strategy module selection`
   - Elegir entre `trend pullback`, `breakout`, y opcionalmente `range reclaim`
   - No mezclar todas las lógicas en un único score agregado

4. `Entry confirmation`
   - Precio
   - fortaleza relativa
   - volumen/liquidez
   - estructura simple y medible
   - riesgo de ejecución

5. `Risk model`
   - `stop-loss`
   - invalidación temporal
   - sizing o priorización por volatilidad/liquidez
   - coherencia entre `live`, `shadow` e `history`

6. `Ranking and emission`
   - Si hay varias señales, priorizarlas por calidad esperada real, no por suma ornamental de indicadores

## Requisitos duros de validación

Cualquier propuesta debe demostrar cómo evitará:

- `look-ahead bias`
- `data snooping`
- `benchmark mismatch`
- `survivorship bias`
- optimización sobre muy pocas operaciones
- confundir edge de activos ilíquidos con edge real ejecutable

La validación debe incluir, como mínimo:

1. Comparación entre módulos por separado y módulo combinado.
2. Métricas por régimen.
3. Métricas por liquidez.
4. Métricas por franja horaria.
5. `expectancy`, `profit factor`, `win rate`, `avg win`, `avg loss`, `MFE`, `MAE`, `time-in-trade`.
6. Análisis de `false positives` y `false negatives`.
7. Revisión de qué filtros destruyen más edge.
8. Análisis de sensibilidad de parámetros.
9. Explicación de por qué los thresholds elegidos no son puro curve fitting.

## Logging e instrumentación obligatoria

Si se implementa un nuevo algoritmo, debe mejorar la capacidad de aprendizaje del sistema. El código nuevo debería registrar explícitamente:

- `module` que generó la señal
- `regime`
- `liquidity tier`
- `relative strength snapshot`
- `volume/liquidity confirmation`
- `rejectReasonCode`
- `entry archetype`
- `expected holding window`
- `risk model` aplicado

Y debe evitar que `shadow` mida una cosa distinta de la que `live` realmente intentaría operar.

## Protocolo especial si pasan 72 horas sin setups

Si el sistema pasa una ventana completa de `72 horas` sin emitir ningún `BUY`, no se debe asumir automáticamente que:

- el mercado no ofreció oportunidades
- el algoritmo “simplemente es más selectivo”
- o que la solución correcta es bajar thresholds a ojo

Primero hay que distinguir entre estas posibilidades:

1. `Fallo operativo`
   - La función no corrió, corrió menos veces de las esperadas, hubo errores silenciosos, falló la ingesta o el universo se quedó casi vacío.

2. `Sequía normal de mercado`
   - El mercado realmente no ofreció setups compatibles con la arquitectura elegida en activos líquidos y horarios válidos.

3. `Algoritmo excesivamente restrictivo`
   - Sí hubo proto-setups o near-misses, pero los gates, thresholds o filtros de contexto los bloquearon casi todos.

4. `Desalineación entre intención y ejecución`
   - La arquitectura conceptual es correcta, pero la implementación concreta en `scheduled-analysis.js` exige simultáneamente demasiadas condiciones.

### Señales diagnósticas rápidas

- `0 BUY` y `0 shadow` durante 72h:
  - sospecha fuerte de filtro excesivo, universo mal recortado o fallo operativo.
- `0 BUY` y bastantes `shadow`:
  - sospecha fuerte de thresholds demasiado duros o ranking final demasiado exigente.
- `0 BUY`, pero también pocas o ninguna ejecución programada:
  - tratar primero como problema operativo, no de edge.
- `0 BUY` con BTC/ETH/SOL mostrando continuidad, rupturas o pullbacks claros en el mismo periodo:
  - no aceptes la explicación de “no hubo mercado” sin pruebas.

### Evidencia mínima a adjuntar en una auditoría de 72h sin setups

Adjunta, además de los archivos normales, lo siguiente:

- rango temporal exacto en UTC analizado
- número esperado de ejecuciones programadas y número observado real
- extracto o export de logs de Netlify de esa ventana, si está disponible
- último snapshot de `persistent_logs.json` tras la ventana
- `shadow_trades.json` y `shadow_trades_archive.json` ya sincronizados al final de la ventana
- nota breve indicando si `TELEGRAM_ENABLED`, `AVOID_ASIA_SESSION`, `MAX_SYMBOLS`, `MIN_QUOTE_VOL_24H` y `SIGNAL_SCORE_THRESHOLD` estaban activos y con qué valores

### Regla de decisión para esta auditoría especial

Si pasan `72 horas` sin setups, la siguiente iteración no debe empezar rediseñando desde cero. Debe empezar contestando, en este orden:

1. `¿Hubo realmente ejecuciones suficientes?`
2. `¿El universo analizado fue suficientemente amplio y líquido?`
3. `¿Qué filtro o gate destruyó más throughput?`
4. `¿Hubo proto-setups razonables que el algoritmo bloqueó?`
5. `¿La falta de setups es una decisión estratégica defendible o un exceso de dureza?`

Solo después de responder eso se puede decidir entre:

- mantener el sistema sin cambios
- hacer un ajuste quirúrgico
- hacer un ajuste mayor
- o revertir parcialmente algún gate

## Prompt canónico de rediseño

Copia y pega este prompt junto con los archivos adjuntos vía `@`.

```text
Quiero que rediseñes `netlify/functions/scheduled-analysis.js` para un sistema de trading cripto `spot`, `long-only`, intradía/day trading.

No quiero una auditoría superficial ni una lista de ideas. Quiero investigación online + diagnóstico del algoritmo actual + implementación de un rediseño real en código, siempre que la evidencia y los datos lo justifiquen.

Contexto operativo:
- Exchange/datos actuales: MEXC spot público.
- Universo: pares `USDT`.
- Solo compro para vender más caro; no hago short.
- Horizonte operativo: intradía/day trading.
- Quiero priorizar robustez, liquidez real, calidad de entrada, adaptación al régimen, drawdown control, consistencia entre shadow/live y trazabilidad.

Archivos adjuntos:
- @netlify/functions/scheduled-analysis.js
- @history.json
- @persistent_logs.json
- @shadow_trades_archive.json
- @shadow_trades.json
- @autopsies.json
- @ALGORITHM_JOURNAL.md
- @ALGO_DOCUMENTATION.md
- @netlify/functions/market-data.js

Reglas obligatorias:
- Antes de proponer arquitectura o tocar código, investiga online usando fuentes primarias o lo más cercanas posible a la fuente original.
- Debes citar enlaces y mencionar fechas exactas de publicación o versión cuando sea posible.
- Separa siempre:
  - dato observado en mis archivos/código
  - evidencia externa encontrada online
  - inferencia tuya
  - hipótesis aún no demostrada
- No asumas que “más complejo = mejor”.
- Si la evidencia favorece una solución más simple, elige la simple.
- No uses conceptos como `MSS`, `sweep`, `order block`, `FVG`, `mystic pulse` o similares como núcleo del algoritmo salvo que puedas justificar edge incremental con evidencia o con mis datos.
- Trata cualquier edge en activos pequeños/ilíquidos como sospechoso hasta demostrar ejecutabilidad real.
- No mezcles un benchmark shadow laxo con una ejecución live mucho más exigente.
- No mantengas lógica de `SELL_ALERT` como eje estratégico principal; este sistema es `spot long-only`.
- Si faltan datos para demostrar edge de forma seria, implementa instrumentación y explícitalo en vez de inventar certezas.
- Si detectas que el algoritmo actual es un “score soup” sobreajustado, dilo con claridad y reemplázalo por una arquitectura modular.

Quiero que sigas exactamente este proceso:

1. Investigación online
- Resume primero cuáles son las estrategias y metodologías con mejor evidencia para este caso de uso:
  - `trend following`
  - `time-series momentum`
  - `relative strength`
  - `breakout continuation`
  - `pullback continuation`
  - `mean reversion` intradía
  - `volume/liquidity/order flow`
  - `risk-managed momentum`
- Para cada familia, indica:
  - si la evidencia es fuerte, media o débil
  - si aplica bien a `spot long-only` intradía
  - si depende de activos ilíquidos o difíciles de ejecutar
  - si parece más adecuada para grandes/líquidos o pequeñas/ilíquidas
- Termina esta sección con un ranking razonado de las 2-3 familias que más sentido tienen para mi sistema.

2. Diagnóstico del algoritmo actual
- Revisa `scheduled-analysis.js` y dime con precisión:
  - qué partes preservaría
  - qué partes eliminaría
  - qué partes reescribiría
- Señala si el algoritmo actual cae en alguno de estos problemas:
  - exceso de indicadores correlacionados
  - score heurístico demasiado parcheado
  - filtros sin racional claro
  - benchmark shadow inconsistente
  - demasiada dependencia de thresholds estáticos
  - complejidad superior al edge demostrado
- Si detectas estos problemas, dilo sin suavizar.

3. Selección de arquitectura
- Elige una arquitectura principal para el nuevo algoritmo y, como máximo, una secundaria.
- Explica por qué esa arquitectura es superior a seguir iterando el score actual.
- Si la investigación no justifica un tercer módulo, no lo añadas.
- Por defecto, considera muy seriamente una estructura basada en:
  - `Trend Pullback Continuation` como módulo principal
  - `Breakout Continuation With Volume/Relative Strength` como módulo secundario
  - `Mean Reversion` solo si los datos realmente lo justifican

4. Especificación del nuevo sistema
- Define reglas claras para:
  - universo de activos
  - filtro de liquidez
  - filtro de spread/profundidad
  - clasificación de régimen
  - condiciones de entrada
  - confirmación por volumen
  - confirmación por fortaleza relativa
  - invalidación/stop-loss
  - time stop o stale exit
  - ranking final de señales
- Prefiere reglas explicables, con pocas piezas y thresholds defendibles.
- Cuando sea posible, prefiere percentiles, rankings o normalizaciones antes que números mágicos fijos.

5. Validación requerida antes de dar por bueno el diseño
- Explica cómo validarías el algoritmo evitando:
  - look-ahead bias
  - overfitting
  - data snooping
  - survivorship bias
  - falsa rentabilidad por mala ejecutabilidad
- Indica qué métricas revisarías por:
  - régimen
  - liquidez
  - hora del día
  - tipo de módulo
- Si con los datos adjuntos no basta para demostrarlo todo, define exactamente qué logs/instrumentación faltan.

6. Implementación en código
- Después del análisis, implementa el rediseño directamente en `netlify/functions/scheduled-analysis.js`.
- Simplifica y elimina lógica legacy que ya no aporte valor.
- No dejes convivir dos algoritmos completos salvo que haya una razón técnica fuerte y explícita.
- Si necesitas introducir helpers o refactors, hazlo con claridad y sin inflar el archivo innecesariamente.
- Mantén logs útiles y legibles.
- Todo cambio que afecte a `shadow`, `history` o `autopsy` debe conservar coherencia entre entrada, benchmark y salida.

7. Respuesta final obligatoria
- Entrega la respuesta final exactamente en este orden:
  1. Evidencia online sintetizada
  2. Diagnóstico del algoritmo actual
  3. Arquitectura elegida
  4. Cambios implementados en código
  5. Riesgos, límites y qué falta validar
- Incluye enlaces a las fuentes usadas.
- Usa fechas concretas.
- No prometas “el mejor algoritmo jamás creado”.
- Sí entrega el algoritmo más robusto, evidenciado y defendible que puedas construir con la información disponible.

Checklist obligatorio antes de terminar:
- confirmaste que el sistema sigue siendo `spot long-only`
- investigaste online antes de codificar
- citaste fuentes y fechas
- separaste evidencia de inferencia
- revisaste consistencia `shadow` vs `live`
- evitaste score soup y parches cosméticos
- justificaste por qué la nueva arquitectura tiene más sentido que seguir iterando la actual
- implementaste el rediseño en `scheduled-analysis.js`
```

## Prompt canónico de auditoría si pasan 72 horas sin setups

Copia y pega este prompt si, tras una ventana completa de `72 horas`, el sistema no emitió ningún `BUY`.

```text
Quiero una auditoría cuantitativa, operativa y estratégica de mi algoritmo porque ha pasado una ventana completa de 72 horas sin emitir ningún setup `BUY`.

No asumas que eso significa automáticamente que “el mercado no dio oportunidades”. Quiero que determines con evidencia si el problema es:
- operativo
- de universo/liquidez
- de filtros demasiado restrictivos
- de thresholds demasiado duros
- de ranking final
- de régimen
- o una combinación de varios factores

Contexto:
- Sistema: `spot` cripto, `long-only`, intradía/day trading
- Archivo principal: `netlify/functions/scheduled-analysis.js`
- La versión actual puede incluir módulos como `Trend Pullback Continuation` y `Breakout Continuation With Volume`
- Mi prioridad no es forzar señales; es distinguir falta real de oportunidad vs exceso de dureza del algoritmo

Archivos adjuntos:
- @netlify/functions/scheduled-analysis.js
- @history.json
- @persistent_logs.json
- @shadow_trades_archive.json
- @shadow_trades.json
- @autopsies.json
- @ALGORITHM_JOURNAL.md
- @ALGO_DOCUMENTATION.md
- @netlify/functions/market-data.js

Datos operativos que debes pedir o usar si están disponibles:
- ventana exacta auditada en UTC
- número esperado de ejecuciones programadas
- número real de ejecuciones observadas
- logs de Netlify o logs equivalentes de la ventana
- valores activos de `TELEGRAM_ENABLED`, `AVOID_ASIA_SESSION`, `MAX_SYMBOLS`, `MIN_QUOTE_VOL_24H`, `SIGNAL_SCORE_THRESHOLD`

Reglas obligatorias:
- Investiga online antes de concluir que 72 horas sin setups es normal o anómalo.
- Usa fuentes primarias o lo más cercanas posible a la fuente original.
- Cita enlaces y fechas concretas.
- Separa siempre:
  - dato observado en mis archivos/logs/código
  - evidencia externa online
  - inferencia tuya
  - hipótesis pendiente
- No propongas bajar thresholds “porque sí”.
- No uses lenguaje vago como “quizá estaba difícil el mercado” sin demostrarlo.
- No mezcles fallo operativo con falta de edge.
- No des por buena la explicación de “no hubo setups” si BTC, ETH, SOL u otros líderes líquidos sí mostraron pullbacks o breakouts razonables en esa ventana.
- Si detectas que el problema es un gate concreto, identifica exactamente cuál y por qué.
- Si detectas que el sistema está demasiado estricto, prioriza un ajuste quirúrgico antes que volver al score soup.

Quiero que estructures la auditoría exactamente así:

1. Veredicto inicial
- Dime en 4-8 líneas si el problema dominante parece ser:
  - fallo operativo
  - falta real de oportunidades
  - exceso de filtros
  - thresholds demasiado duros
  - universo demasiado estrecho
  - ranking final demasiado exigente
  - combinación de varios

2. Calidad operativa de la ventana
- Confirma el rango temporal exacto auditado.
- Confirma cuántas ejecuciones debieron ocurrir y cuántas ocurrieron realmente.
- Señala si hubo errores, ejecuciones truncadas, timeouts, problemas de API o runs incompletos.
- Si aquí detectas un problema operativo serio, dilo antes de hablar de estrategia.

3. Throughput real del algoritmo
- Calcula:
  - cuántos `BUY` emitió
  - cuántos `shadow` o near-misses registró
  - cuántos símbolos analizó por ejecución, si puede inferirse
  - cuántos símbolos fueron descartados por liquidez, spread, profundidad o régimen
- Dime si la ausencia de setups viene de falta de candidatos o de exceso de rechazo.

4. Auditoría de filtros y gates
- Identifica qué filtros bloquearon más setups potenciales.
- Separa, si es posible:
  - liquidez
  - spread/profundidad
  - BTC context
  - régimen
  - score mínimo
  - strong categories
  - confirmación de volumen
  - fortaleza relativa
  - time/session filter
- Si no existe instrumentación suficiente para medir alguno, dilo explícitamente.

5. Contraste con el mercado real
- Investiga online cómo se comportó el mercado en esa ventana exacta.
- Indica si en activos líquidos hubo:
  - pullbacks tendenciales razonables
  - breakout continuations razonables
  - sesiones con volumen suficiente
  - o una sequía real de setups
- Usa fechas y horas concretas.
- Marca claramente qué parte es evidencia externa y qué parte es inferencia.

6. Diagnóstico estratégico
- Responde con claridad:
  - ¿el algoritmo está demasiado estricto?
  - ¿está bien calibrado aunque la frecuencia sea baja?
  - ¿hay un módulo que prácticamente nunca puede activarse?
  - ¿hay filtros que se pisan entre sí y vuelven imposible la entrada?
- Si detectas que la implementación exige demasiadas condiciones simultáneas, dilo sin suavizar.

7. Recomendación final
- Elige solo una:
  - MANTENER
  - AJUSTE QUIRÚRGICO
  - AJUSTE MAYOR
  - REVERTIR PARCIALMENTE
- Si propones cambios, prioriza cambios mínimos, medibles y defendibles.
- Para cada cambio propuesto, explica:
  - qué tocarías
  - por qué
  - qué riesgo corrige
  - qué métrica debería mejorar

8. Implementación, solo si la evidencia lo justifica
- Si el diagnóstico es claro, implementa directamente el ajuste en `netlify/functions/scheduled-analysis.js`.
- No reconstruyas todo desde cero salvo que la auditoría lo haga inevitable.
- Si implementas cambios, actualiza también:
  - `ALGORITHM_JOURNAL.md`
  - `ALGO_DOCUMENTATION.md`

Checklist obligatorio antes de terminar:
- confirmaste que realmente hubo o no hubo ejecuciones suficientes
- separaste problema operativo de problema estratégico
- identificaste los filtros que más destruyen throughput
- contrastaste la ventana con el mercado real usando investigación online
- no bajaste thresholds sin justificación
- priorizaste ajuste quirúrgico antes que score soup
- si cambiaste código, documentaste el cambio
```

## Nota final

Si en la próxima iteración la evidencia no permite construir un algoritmo claramente superior, la respuesta correcta será:

- simplificar
- instrumentar mejor
- recolectar más datos
- y rechazar ideas débiles

No será aceptable “fabricar convicción” solo para sacar una versión nueva.
