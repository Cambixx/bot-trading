# Guia Maestra Reutilizable para Auditorias y Redisenos del Algoritmo

> Actualizada: `2026-04-05`
>
> Este archivo esta pensado para algo muy concreto:
> poder copiarlo entero y pegarlo en el futuro para pedir una auditoria, un rediseño, una validacion o una investigacion nueva del algoritmo sin tener que rellenar nada manualmente cada vez.
>
> Si pegas este archivo completo en una conversacion futura, debe leerse como un conjunto de instrucciones vinculantes para analizar `netlify/functions/scheduled-analysis.js` con evidencia online, criterio cuantitativo, trazabilidad y apertura real a estrategias nuevas, pero sin caer en complejidad gratuita ni en fantasias de edge.

---

## Como usar esta guia

1. Ejecuta antes:

```bash
npm run sync
```

2. Asegurate de que los archivos sincronizados y el repo local estan actualizados.
3. Copia y pega este archivo completo.
4. No quiero tener que rellenar ningun bloque manual.
5. El asistente debe inferir el tipo de auditoria, la ventana, el problema dominante y el objetivo principal usando:
   - `history.json`
   - `persistent_logs.json`
   - `shadow_trades.json`
   - `shadow_trades_archive.json`
   - `signal memory` si esta disponible via stores sincronizados
   - `autopsies.json`
   - `ALGORITHM_JOURNAL.md`
   - `ALGO_DOCUMENTATION.md`
   - el codigo actual del repo
6. Solo si un dato es realmente imposible de inferir con seguridad, el asistente puede decir explicitamente que queda como supuesto.
7. Si el contexto temporal importa, debe usar siempre fechas exactas en UTC.

### Modo de trabajo por defecto

Salvo que yo diga lo contrario en lenguaje natural, debes asumir que:

- quiero permiso para implementar cambios si la evidencia lo justifica
- quiero que uses la informacion sincronizada como fuente principal
- quiero que infieras el `mode` sin preguntarme ni pedirme que rellene nada

### Inferencia obligatoria del `mode`

Si no doy instrucciones adicionales, el asistente debe inferir el `mode` asi:

- `REDESIGN_COMPLETE` si el objetivo principal es replantear arquitectura y codigo.
- `AUDIT_72H_NO_SETUPS` si el sintoma central es una ventana larga sin `BUY`.
- `AUDIT_GENERAL` si se busca diagnostico amplio sin presuponer rediseño total.
- `VALIDATION_AFTER_CHANGE` si ya hubo cambios recientes y ahora toca verificar si tienen sentido.

### Heuristicas obligatorias para inferir el contexto automaticamente

El asistente debe intentar inferir, en este orden:

1. Cual es la version actual del runtime.
2. Cual fue la ventana reciente mas relevante en UTC.
3. Si hubo suficientes ejecuciones programadas o no.
4. Si el problema dominante parece:
   - operativo
   - estrategico
   - de throughput
   - de calidad de entrada
   - de universo/liquidez
   - de desalineacion `shadow/live`
5. Si la situacion se parece mas a:
   - rediseño completo
   - auditoria de 72h sin setups
   - validacion post-cambio
   - auditoria general

Si encuentra una ventana de `72 horas` recientes con `0 BUY`, debe tratar ese caso prioritariamente como `AUDIT_72H_NO_SETUPS` aunque yo no lo haya dicho.

---

## Objetivo real del sistema

Este sistema debe optimizarse para:

- `spot` cripto
- `long-only`
- `intradia` / `day trading`
- compra para vender mas caro
- foco en robustez, expectativa matematica, drawdown control, liquidez real, ejecutabilidad y consistencia entre `paper`, `shadow` y `live`

No quiero:

- otro ciclo de "mas indicadores + mas bonus + mas penalties + mas thresholds"
- marketing tecnico disfrazado de edge
- complejidad sin evidencia
- sesgos de backtest escondidos
- aprender la leccion equivocada de una muestra minima

---

## Principios metodologicos no negociables

1. Prioriza evidencia antes que creatividad.
2. Prioriza simplicidad robusta antes que complejidad brillante.
3. Prioriza activos grandes y liquidos antes que "oportunidades" dudosas.
4. Prioriza coherencia `live/shadow/history` antes que metricas bonitas.
5. Prioriza validacion `out-of-sample` antes que performance `in-sample`.
6. Prioriza estructuras con explicacion causal razonable antes que combinaciones arbitrarias.
7. Trata cualquier edge en activos pequenos o iliquidos como sospechoso hasta demostrar ejecutabilidad real.
8. Si la evidencia no alcanza para una afirmacion fuerte, debes decirlo y proponer instrumentacion, no fabricar conviccion.
9. Si una baseline simple y explicable no esta claramente superada, la baseline sigue ganando.
10. Si la investigacion nueva contradice esta guia, debes decirlo con claridad y actualizar el prior.

---

## Mandato de investigacion online

Antes de concluir nada importante sobre el algoritmo, debes investigar online.

Esto es obligatorio porque:

- los papers y preprints cambian
- aparecen estrategias nuevas
- cambian benchmarks, microestructura, costes, APIs y condiciones de mercado
- las mejores conclusiones de hace meses pueden no seguir siendo las mejores hoy

### Reglas de esa investigacion

1. Usa primero fuentes primarias o lo mas cerca posible de la fuente original.
2. Cita enlaces y fechas exactas cuando sea posible.
3. Separa siempre:
   - dato observado en mis archivos/codigo/logs
   - evidencia externa online
   - inferencia tuya
   - hipotesis aun no demostrada
4. No te limites a confirmar mis priors; intenta tambien refutarlos.
5. No asumas que esta guia ya contiene todo lo relevante.
6. Debes buscar literatura y evidencia nuevas hasta la fecha actual de la auditoria, no solo repetir referencias historicas.

### Que familias estrategicas debes volver a revisar online en cada auditoria

Siempre debes revaluar, como minimo:

- `trend following`
- `time-series momentum`
- `cross-sectional relative strength`
- `breakout continuation`
- `pullback continuation`
- `intraday mean reversion`
- `volume/liquidity/order-flow`
- `risk-managed momentum`
- `volatility scaling`
- `session/time-of-day effects`
- `execution-aware filters`
- `drawdown-aware risk models`

### Que estrategias nuevas o variantes debes considerar activamente si aparecen online

No debes meterlas por defecto, pero si investigarlas si hay evidencia seria:

- `volume-weighted momentum`
- `volatility-managed momentum`
- `anchored VWAP pullbacks`
- `opening-range style breakouts` adaptados a cripto 24/7
- `leader/laggard rotation` entre majors liquidos
- `breadth/regime filters` simples
- `liquidity-adjusted rankings`
- `time-window specific intraday continuation`
- `cross-exchange or microstructure-informed filters`
- enfoques sencillos con `order flow` o `taker imbalance`, solo si la ejecutabilidad y la data lo justifican

Si investigas algo nuevo, debes responder explicitamente:

- si aporta edge incremental real frente a la baseline actual
- si ese edge parece robusto
- si depende de activos iliquidos o datos dificiles de replicar
- si merece pasar a `live`, quedarse en `shadow`, o solo instrumentarse

---

## Priors actuales de esta guia

Estos priors no son verdades fijas. Son el punto de partida que debe volver a contrastarse online.

### Priors de fuerza alta

1. En cripto, el edge mas repetido en la literatura suele aparecer en familias de `momentum`, `trend following`, `moving averages`, `relative strength` y confirmacion por `volume/liquidity`.
2. El control del riesgo importa mucho:
   - `stop-loss`
   - `time stop`
   - `volatility scaling`
   - sizing dependiente de liquidez/volatilidad
3. La complejidad adicional suele aportar menos de lo que promete y mas riesgo de sobreajuste del que parece.

### Priors de fuerza media

1. El volumen funciona mejor como confirmacion contextual que como senal aislada.
2. Las ventanas intradia importan:
   - peor liquidez en madrugada UTC
   - mas actividad cerca de Europa/EE. UU.
3. Las reglas simples bien auditadas suelen transferirse mejor a `live` que sistemas barrocos.

### Priors de cautela

1. La reversión de muy corto plazo puede existir, pero en cripto muchas veces se concentra en activos pequenos e iliquidos.
2. El `machine learning` no debe entrar como protagonista si no supera claramente una baseline simple y explicable.
3. Una muestra pequena con win rate alto no es evidencia suficiente.

---

## Lo que no quiero en futuras iteraciones

No quiero que la auditoria o el rediseño:

- mantengan el patron de `score soup` inflado con bonus y penalties locales
- mezclen logica `long-only` con residuos de venta/short como eje principal
- dependan de conceptos tipo `MSS`, `FVG`, `order block`, `sweep` o similares sin demostrar edge incremental con datos
- usen comentarios grandilocuentes o "marketing code"
- mantengan benchmarks `shadow` mas laxos que la logica `live`
- compren activos con liquidez teorica pero mala ejecutabilidad real
- optimicen thresholds con muestras pequenas o periodos demasiado recientes
- propongan ML opaco si una baseline simple sigue siendo mas defendible
- acepten explicaciones vagas como "el mercado estaba dificil" sin evidencia
- ignoren la posibilidad de que haya estrategias mejores online que no estamos evaluando aun

---

## Arquitectura preferida, salvo evidencia mejor

Por defecto, el asistente debe evaluar primero estas familias, en este orden:

1. `Trend Pullback Continuation`
   - nucleo principal esperado
   - activos grandes/líquidos
   - sesgo alcista claro
   - pullback controlado
   - fortaleza relativa

2. `Breakout Continuation With Volume`
   - solo si la ruptura ocurre con expansion real de volumen/liquidez
   - sin sobreextension absurda
   - con riesgo de ejecucion defendible

3. `Range Reclaim / Mean Reversion`
   - solo si la validacion demuestra edge robusto en activos liquidos
   - no asumir utilizabilidad por defecto

Si la investigacion nueva no justifica un tercer modulo, mejor `1-2` modulos solidos que `4-5` modulos mediocres.

---

## Estructura minima deseable del algoritmo

El algoritmo deberia acercarse a esta secuencia:

1. `Universe filter`
   - solo pares `USDT`
   - filtro duro de spread, profundidad, volumen y tradabilidad
   - preferencia por alta capitalizacion/liquidez real
   - exclusion explicita de wrappers, sintéticos o pares fuera del objetivo

2. `Market regime layer`
   - clasificacion simple, explicable y estable
   - por ejemplo:
     - `trend`
     - `range`
     - `high-vol breakout`
     - `transition`
     - `risk-off`
   - BTC puede usarse como contexto, no como excusa difusa

3. `Strategy module selection`
   - elegir entre `trend pullback`, `breakout` y, si se justifica, `range reclaim`
   - no mezclar todas las logicas en un unico score agregado

4. `Entry confirmation`
   - precio
   - fortaleza relativa
   - volumen/liquidez
   - estructura simple y medible
   - riesgo de ejecucion

5. `Risk model`
   - `stop-loss`
   - invalidacion temporal
   - sizing o priorizacion por volatilidad/liquidez
   - coherencia entre `live`, `shadow` e `history`

6. `Ranking and emission`
   - si hay varias senales, priorizarlas por calidad esperada real, no por suma ornamental de indicadores

---

## Requisitos duros de validacion

Cualquier propuesta debe explicar como evitara:

- `look-ahead bias`
- `data snooping`
- `benchmark mismatch`
- `survivorship bias`
- optimizacion sobre muy pocas operaciones
- falsa rentabilidad por mala ejecutabilidad
- edge aparente generado por outliers

La validacion debe incluir, como minimo:

1. Comparacion entre modulos por separado y modulo combinado.
2. Metricas por regimen.
3. Metricas por liquidez.
4. Metricas por franja horaria.
5. `expectancy`, `profit factor`, `win rate`, `avg win`, `avg loss`, `MFE`, `MAE`, `time-in-trade`.
6. Analisis de `false positives` y `false negatives`.
7. Revision de que filtros destruyen mas edge.
8. Analisis de sensibilidad de parametros.
9. Explicacion de por que los thresholds elegidos no son puro `curve fitting`.

Si con los datos adjuntos no basta, debes definir exactamente que falta:

- logs
- snapshots
- telemetria de rechazo
- telemetria de throughput
- ejecuciones manuales
- backtests adicionales
- segmentacion por hora o liquidez

---

## Logging e instrumentacion obligatoria

Si se implementa un nuevo algoritmo o ajuste, debe mejorar la capacidad de aprendizaje del sistema.

El codigo deberia registrar explicitamente:

- `module`
- `regime`
- `liquidityTier`
- `relativeStrengthSnapshot`
- `volumeLiquidityConfirmation`
- `rejectReasonCode`
- `entryArchetype`
- `expectedHoldingHours`
- `riskModel`
- `MFE`
- `MAE`
- resumenes agregados de rechazo/throughput por run, si aun no existen

Y debe evitar que `shadow` mida una cosa distinta de la que `live` realmente intentaria operar.

---

## Protocolo especial si pasan 72 horas sin setups

Si el sistema pasa una ventana completa de `72 horas` sin emitir ningun `BUY`, no se debe asumir automaticamente que:

- el mercado no ofrecio oportunidades
- el algoritmo "simplemente es mas selectivo"
- la solucion correcta es bajar thresholds a ojo

Primero hay que distinguir entre estas posibilidades:

1. `Fallo operativo`
   - la funcion no corrio
   - corrio menos veces de las esperadas
   - hubo errores silenciosos
   - fallo la ingesta
   - el universo se quedo casi vacio

2. `Sequia normal de mercado`
   - el mercado realmente no ofrecio setups compatibles con la arquitectura elegida en activos liquidos y horarios validos

3. `Algoritmo excesivamente restrictivo`
   - si hubo proto-setups o near-misses, pero los gates, thresholds o filtros de contexto bloquearon casi todo

4. `Desalineacion entre intencion y ejecucion`
   - la idea conceptual es razonable, pero `scheduled-analysis.js` exige demasiadas condiciones simultaneas

### Senales diagnosticas rapidas

- `0 BUY` y `0 shadow` durante 72h:
  - sospecha fuerte de filtro excesivo, universo mal recortado o fallo operativo
- `0 BUY` y bastantes `shadow`:
  - sospecha fuerte de thresholds demasiado duros o ranking final demasiado exigente
- `0 BUY`, pero tambien pocas o ninguna ejecucion programada:
  - tratar primero como problema operativo
- `0 BUY` con BTC/ETH/SOL u otros lideres liquidos mostrando continuidad, rupturas o pullbacks claros:
  - no aceptes la explicacion de "no hubo mercado" sin pruebas

### Evidencia minima a adjuntar en una auditoria de 72h sin setups

Adjunta, ademas de los archivos normales:

- rango temporal exacto en UTC
- numero esperado de ejecuciones programadas y numero observado real
- extracto o export de logs de Netlify, si existe
- ultimo snapshot de `persistent_logs.json`
- `shadow_trades.json` y `shadow_trades_archive.json` sincronizados al final de la ventana
- nota con valores activos de:
  - `TELEGRAM_ENABLED`
  - `AVOID_ASIA_SESSION`
  - `MAX_SYMBOLS`
  - `MIN_QUOTE_VOL_24H`
  - `SIGNAL_SCORE_THRESHOLD`

### Regla de decision para esta auditoria especial

Si pasan `72 horas` sin setups, la siguiente iteracion no debe empezar redisenando desde cero. Debe empezar contestando, en este orden:

1. `Hubo realmente ejecuciones suficientes?`
2. `El universo analizado fue suficientemente amplio y liquido?`
3. `Que filtro o gate destruyo mas throughput?`
4. `Hubo proto-setups razonables que el algoritmo bloqueo?`
5. `La falta de setups es una decision defendible o un exceso de dureza?`

Solo despues se puede decidir entre:

- `MANTENER`
- `AJUSTE QUIRURGICO`
- `AJUSTE MAYOR`
- `REVERTIR PARCIALMENTE`

---

## Archivos a adjuntar

Adjunta siempre esto al pedir una auditoria o rediseño:

Si previamente ejecutaste `npm run sync`, el asistente debe tratar estos archivos sincronizados como el input estandar de la auditoria y no debe esperar un formulario manual adicional.

| Archivo | Criticidad | Proposito |
|---|---|---|
| `netlify/functions/scheduled-analysis.js` | CRITICO | Algoritmo actual |
| `history.json` | CRITICO | Trades reales cerrados y abiertos |
| `persistent_logs.json` | CRITICO | Trazabilidad operativa |
| `shadow_trades_archive.json` | CRITICO | Near-misses historicos |
| `shadow_trades.json` | IMPORTANTE | Ventana activa reciente |
| `autopsies.json` | CRITICO | Causas probables de fallos |
| `ALGORITHM_JOURNAL.md` | IMPORTANTE | Hipotesis, cambios, lecciones |
| `ALGO_DOCUMENTATION.md` | IMPORTANTE | Contexto funcional, arquitectura actual |
| `netlify/functions/market-data.js` | OPCIONAL | Si el rediseño toca ingestion |
| `netlify/functions/auto-digest.js` | OPCIONAL | Si la auditoria incluye reporting y diagnostico |
| `scripts/manual-run.js` | OPCIONAL | Si la auditoria incluye validacion operativa local |

Si tambien existe un snapshot local de `signal memory`, debe usarse. Si no existe como archivo pero si se menciona en logs, el asistente debe decir explicitamente que esa parte no estaba sincronizada al filesystem.

## Sincronizacion local

```bash
npm run sync
```

Despues de eso, el asistente debe asumir por defecto que:

- `history.json`
- `persistent_logs.json`
- `shadow_trades.json`
- `shadow_trades_archive.json`
- `autopsies.json`

representan el estado operativo mas reciente disponible para auditar.

## Validacion local recomendada tras cambios

```bash
npm test -- --run
npx eslint netlify/functions/scheduled-analysis.js netlify/functions/auto-digest.js netlify/functions/telegram-bot.js
AVOID_ASIA_SESSION=false node scripts/manual-run.js --no-telegram
```

---

## Fuentes base que inspiran esta guia

Estas referencias no sustituyen la investigacion online de la siguiente auditoria. Son solo el punto de partida minimo:

1. Liu & Tsyvinski, `Risks and Returns of Cryptocurrency`, NBER Working Paper `24877`, agosto `2018`; version en *Review of Financial Studies* `2021`.
2. `Dynamic time series momentum of cryptocurrencies`, `2021`.
3. Wen et al., `Intraday return predictability in the cryptocurrency markets`, `2022`.
4. Corbet et al., `The effectiveness of technical trading rules in cryptocurrency markets`, `2019`.
5. Gerritsen et al., `Technical trading and cryptocurrencies`, `2020`.
6. Huang, Sangiorgi & Urquhart, `Cryptocurrency Volume-Weighted Time Series Momentum`, SSRN `2024`.
7. Brauneis, Mestel & Theissen, `The crypto world trades at tea time`, `2024`.
8. `Impact of size and volume on cryptocurrency momentum and reversal`, `2023`.
9. `Machine learning and the cross-section of cryptocurrency returns`, `2024`.
10. Literatura sobre `risk-managed momentum`, `volatility scaling` y control explicito del riesgo en cripto.

De nuevo: en la auditoria futura debes volver a comprobar el estado de estas referencias y buscar otras mas nuevas.

---

## Instrucciones vinculantes para el asistente

Si estas auditando o redisenando este sistema, debes seguir exactamente este proceso.

### Paso 1. Investigacion online sintetizada

Primero resume que estrategias y metodologias muestran mejor evidencia para este caso de uso:

- `trend following`
- `time-series momentum`
- `relative strength`
- `breakout continuation`
- `pullback continuation`
- `mean reversion` intradia
- `volume/liquidity/order flow`
- `risk-managed momentum`
- y cualquier familia nueva relevante encontrada online hasta la fecha actual

Para cada familia, indica:

- si la evidencia es `fuerte`, `media` o `debil`
- si aplica bien a `spot long-only` intradia
- si depende de activos iliquidos o dificiles de ejecutar
- si parece mas adecuada para grandes/liquidos o pequenas/iliquidas
- si merece pasar a baseline, a modulo secundario, a `shadow` o quedarse fuera

Debes terminar esta seccion con un ranking razonado de las `2-3` familias que mas sentido tienen ahora mismo para mi sistema.

### Paso 2. Diagnostico del algoritmo actual

Revisa `scheduled-analysis.js` y explica con precision:

- que preservarias
- que eliminarias
- que reescribirias
- que parte es arquitectura valida y que parte es legado residual

Debes senalar sin suavizar si detectas:

- exceso de indicadores correlacionados
- score heuristico demasiado parcheado
- filtros sin racional claro
- benchmark `shadow` inconsistente
- dependencia excesiva de thresholds estaticos
- complejidad superior al edge demostrado
- throughput demasiado bajo para aprender
- universe drift o activos fuera del dominio objetivo

### Paso 3. Seleccion de arquitectura

Elige:

- una arquitectura principal
- como maximo una secundaria

Explica:

- por que esa arquitectura es superior a seguir iterando el estado actual
- por que es coherente con la evidencia online mas reciente
- por que tiene sentido causal
- por que no depende de fantasia estadistica

Si la investigacion nueva no justifica un tercer modulo, no lo anadas.

### Paso 4. Especificacion del sistema

Define reglas claras para:

- universo de activos
- filtro de liquidez
- filtro de spread/profundidad
- clasificacion de regimen
- condiciones de entrada
- confirmacion por volumen
- confirmacion por fortaleza relativa
- invalidacion / `stop-loss`
- `time stop`
- ranking final
- coherencia `live` vs `shadow`

Prefiere:

- reglas explicables
- pocas piezas
- thresholds defendibles
- percentiles, rankings o normalizaciones antes que numeros magicos fijos, cuando tenga sentido

### Paso 5. Validacion requerida

Explica como validarias el algoritmo evitando:

- `look-ahead bias`
- `overfitting`
- `data snooping`
- `survivorship bias`
- falsa rentabilidad por mala ejecutabilidad

Debes indicar que metricas revisar por:

- regimen
- liquidez
- hora del dia
- tipo de modulo
- sesion UTC

Si con los datos adjuntos no basta para demostrarlo todo, define exactamente que logs o instrumentacion faltan.

### Paso 6. Implementacion en codigo

Si la evidencia y el diagnostico lo justifican, implementa directamente el cambio en codigo.

Reglas:

- no dejes convivir dos algoritmos completos salvo razon tecnica muy fuerte
- simplifica y elimina logica legacy que ya no aporte valor
- manten logs utiles y legibles
- si tocas `shadow`, `history`, `autopsies` o reporting, conserva coherencia operacional
- si cambias arquitectura o comportamiento, actualiza tambien:
  - `ALGORITHM_JOURNAL.md`
  - `ALGO_DOCUMENTATION.md`

### Paso 7. Respuesta final obligatoria

La respuesta final debe venir exactamente en este orden:

#### Si `mode = REDESIGN_COMPLETE`

1. Evidencia online sintetizada
2. Diagnostico del algoritmo actual
3. Arquitectura elegida
4. Cambios implementados en codigo
5. Riesgos, limites y que falta validar

#### Si `mode = AUDIT_72H_NO_SETUPS`

1. Veredicto inicial
2. Calidad operativa de la ventana
3. Throughput real del algoritmo
4. Auditoria de filtros y gates
5. Contraste con el mercado real
6. Diagnostico estrategico
7. Recomendacion final: `MANTENER`, `AJUSTE QUIRURGICO`, `AJUSTE MAYOR` o `REVERTIR PARCIALMENTE`
8. Implementacion, solo si la evidencia lo justifica

#### Si `mode = AUDIT_GENERAL`

1. Evidencia online relevante
2. Hallazgos operativos
3. Hallazgos estrategicos
4. Cambios recomendados o implementados
5. Riesgos y siguientes validaciones

#### Si `mode = VALIDATION_AFTER_CHANGE`

1. Que cambio se esta validando
2. Si la nueva logica es consistente con el objetivo del sistema
3. Si hay regresiones operativas o estrategicas
4. Que muestran logs, history, shadow y autopsies
5. Veredicto y siguientes pasos

En todos los modos:

- incluye enlaces a las fuentes usadas
- usa fechas concretas
- no prometas "el mejor algoritmo del mundo"
- di claramente cuando algo es inferencia y no hecho demostrado

---

## Checklist final obligatorio

Antes de terminar, el asistente debe poder marcar honestamente todo esto:

- confirme que el sistema sigue siendo `spot long-only`
- investigue online antes de concluir
- cite fuentes y fechas
- separe evidencia de inferencia
- revise consistencia `shadow` vs `live`
- evite `score soup` y parches cosmeticos
- justifique por que la arquitectura nueva o el ajuste propuesto tiene sentido
- identifique los filtros que mas destruyen throughput si el problema era frecuencia
- no baje thresholds sin justificacion
- implemente en codigo solo si la evidencia lo justifica
- documente el cambio si hubo cambios de codigo

---

## Regla final de honestidad

Si la evidencia no permite construir un algoritmo claramente superior, la respuesta correcta es:

- simplificar
- instrumentar mejor
- recolectar mas datos
- rechazar ideas debiles
- o mantener sin cambios

No es aceptable fabricar conviccion solo para sacar una version nueva.
