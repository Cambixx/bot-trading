# Guía para Auditoría del Algoritmo (Performance Review)

Cuando decidas que ha pasado suficiente tiempo (o una cantidad significativa de operaciones) y quieras auditar el rendimiento de los últimos cambios en `scheduled-analysis.js`, sigue estos pasos para asegurar que el análisis sea preciso y basado en datos.

## 📁 1. Preparación de Archivos
Asegúrate de tener **descargados y actualizados** (desde el servidor de producción si aplica) los siguientes archivos y menciónalos en el chat usando `@`:

- **`history.json` (CRÍTICO):** Contiene el resultado real de las operaciones (WIN, LOSS, BREAK_EVEN, OPEN) y el PnL.
- **`logs.txt` (CRÍTICO):** Contiene el proceso de decisión del algoritmo. Es vital para entender *por qué* un trade falló o acertó (ej: ¿entró en MODO AGRESIVO y fue una trampa de liquidez?).
- **`ALGORITHM_JOURNAL.md` (IMPORTANTE):** Contiene el contexto de qué versión estamos testeando y cuáles eran nuestras hipótesis (ej: bajar la restricción en TRANSITION).

*(Nota: Archivos como `ALGO_DOCUMENTATION.md` o el propio `scheduled-analysis.js` solo serán necesarios si decidimos modificar el código tras la auditoría).*

---

## 🚀 2. Prompt de Auditoría
Copia y pega el siguiente texto exacto en un **nuevo chat** (o en este, si prefieres mantener el hilo) una vez tengas los archivos listos:

```text
Hola. Han pasado unos días desde nuestra última actualización del algoritmo (v5.1 MODO AGRESIVO). Quiero que hagamos una auditoría de rendimiento para ver si debemos mantener los parámetros, ajustarlos o revertirlos.

He actualizado y adjuntado los siguientes archivos:
- @history.json con las últimas operaciones.
- @logs.txt con el registro de decisiones del servidor.
- @ALGORITHM_JOURNAL.md con nuestro contexto y objetivos.

Por favor, realiza las siguientes tareas:
1. Analiza el `history.json` y calcula el Win Rate de los trades generados de las alertas recientes.
2. Identifica patrones en las operaciones perdedoras (LOSS) o cerradas sin beneficio cruzando la información con `logs.txt` (¿fueron por falsa ruptura, falta de volumen, cambio de tendencia repentino, stop muy ajustado?).
3. Revisa la sección "Pending Hypotheses" y "Lessons Learned" del `ALGORITHM_JOURNAL.md`.
4. Dame un veredicto claro y basado en datos: ¿Mantenemos la configuración actual, ajustamos parámetros como el Risk:Reward, o endurecemos los filtros de entrada de nuevo?

Espero tu análisis detallado antes de tocar código.
```
