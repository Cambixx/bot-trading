# 📊 Guía de Uso: Backtesting Engine

Esta guía explica cómo ejecutar, configurar e interpretar los resultados del motor de backtesting para los bots de trading (Fusion v13 y Knife Catcher).

## 🚀 Ejecución Rápida

Para ejecutar un backtest estándar con los parámetros por defecto (BTCUSDT, 5 días):

```bash
npm run backtest
```

## ⚙️ Configuración y Argumentos

El script acepta varios argumentos para personalizar la simulación. Debes usar `--` para pasar argumentos a través de npm:

```bash
npm run backtest -- [SÍMBOLO] [OPCIONES]
```

### Argumentos Principales

| Argumento | Descripción | Ejemplo |
| :--- | :--- | :--- |
| `SÍMBOLO` | El par de trading a testear (debe estar en MEXC). | `ETHUSDT` |
| `--bot=knife` | Selecciona el bot Knife Catcher (por defecto es `trader`). | `--bot=knife` |
| `--days=N` | Número de días de datos históricos a descargar. | `--days=30` |
| `--months=N` | Número de meses de datos (1 mes = 30 días). | `--months=3` |
| `--start=YYYY-MM-DD` | Fecha de inicio específica para el test. | `--start=2024-01-01` |
| `--no-open` | Evita que el reporte HTML se abra automáticamente. | `--no-open` |
| `--relax` | **Modo Relajado**: Suaviza filtros de volumen y puntuación para ver qué señales están "cerca". | `--relax` |
| `--debug` | Muestra logs detallados de cada vela y candidatos de módulos. | `--debug` |

### Ejemplos de Comandos

- **Test de 2 meses en SOLUSDT:**
  ```bash
  npm run backtest -- SOLUSDT --months=2
  ```

- **Test del bot Knife Catcher en PEPEUSDT (15 días):**
  ```bash
  npm run backtest -- PEPEUSDT --bot=knife --days=15
  ```

- **Test con debug activado para análisis profundo:**
  ```bash
  npm run backtest -- BTCUSDT --days=3 --debug
  ```

---

## 📈 Resultados y Reportes

Al finalizar cada ejecución, el sistema genera dos archivos en la carpeta `backtests/`:

1.  **`backtest-report.html`**: Un reporte visual premium con métricas, gráficos de rendimiento y lista de trades. Se abre automáticamente al finalizar (a menos que uses `--no-open`).
2.  **`backtest-report.json`**: Los datos crudos del test para procesamiento programático o auditorías.

> [!IMPORTANT]
> Los archivos se sobrescriben en cada ejecución para mantener la carpeta limpia. Si deseas conservar un reporte, cámbiale el nombre manualmente antes de ejecutar el siguiente test.

---

## 🧪 Backtesting en Lote (Batch)

Si deseas probar una estrategia contra múltiples activos (Top 50 monedas) simultáneamente:

```bash
npm run backtest:batch [trader|knife] [días]
```

Ejemplo:
```bash
npm run backtest:batch trader 7
```

*Nota: El modo Batch tiene desactivada la apertura automática del navegador para evitar saturar el sistema.*

---

## 🔍 Interpretando "0 Trades"

Si tu backtest no genera trades (todo sale a 0), no significa que el bot no funcione. El v13 es **extremadamente selectivo**.

### 1. Panel de "Logic Rejections"
Revisa este panel en el reporte HTML. Te dirá por qué se rechazaron las señales:
- **VOLUME_BELOW_MODULE_FLOOR**: El activo no tiene suficiente volumen relativo.
- **OVEREXTENDED**: El precio ha subido demasiado rápido y el bot espera un retroceso.
- **NO_MOMENTUM**: No hay confirmación de Squeeze o MACD.

### 2. Cómo forzar señales
Para diagnosticar o ver qué señales están siendo ignoradas, usa el **Modo Relajado**:
```bash
npm run backtest -- BTCUSDT --relax
```
Esto bajará el umbral de puntuación de 5 a 1 y desactivará los filtros de volumen mínimo.

---

## 🛠️ Notas Técnicas

- **Fidelidad**: La simulación utiliza datos de velas de 5m, 15m, 1h y 4h para replicar el análisis multi-temporal del bot.
- **Slippage**: Se aplica un slippage por defecto del 0.1% en las entradas para mayor realismo.
- **Contexto BTC**: El motor descarga automáticamente datos de BTCUSDT para simular el filtrado por régimen de mercado.

---
*Generado por Antigravity AI • v1.3*
