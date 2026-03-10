# 📡 Guía de Sincronización de Datos (Netlify Blobs)

Este proyecto utiliza **Netlify Blobs** para almacenar datos persistentes de la operativa de trading (registros, historial, auditorías, etc.). El script de sincronización permite descargar estos datos remotos a archivos JSON locales para su análisis o backup.

## 📋 Requisitos Previos

1. **Netlify CLI**: Debes tener instalada la herramienta de línea de comandos de Netlify.
   ```bash
   npm install -g netlify-cli
   ```

2. **Autenticación**: Debes haber iniciado sesión en tu cuenta de Netlify desde la terminal.
   ```bash
   netlify login
   ```

## 🚀 Cómo Ejecutar el Script

### Opción 1: Sincronización Total (Recomendada)
Descarga todos los almacenes de datos definidos (6 en total) y actualiza los archivos locales correspondientes.

```bash
npm run sync
```

### Opción 2: Sincronización Individual
Si solo deseas actualizar un archivo específico, puedes pasar el nombre o un alias al script:

```bash
node scripts/sync-blobs.js [target]
```

**Ejemplos:**
- `node scripts/sync-blobs.js history` (Actualiza solo `history.json`)
- `node scripts/sync-blobs.js shadow` (Actualiza solo `shadow_trades.json`)

## 📂 Mapeo de Archivos y Aliases

El script mapea los siguientes "blobs" remotos a archivos locales:

| Alias | Blob Remoto | Archivo Local | Descripción |
| :--- | :--- | :--- | :--- |
| `history` | `signal-history-v2` | `history.json` | Registro de señales generadas |
| `logs` | `persistent-logs-v1` | `persistent_logs.json` | Logs detallados de las ejecuciones |
| `shadow` | `shadow-trades-v1` | `shadow_trades.json` | Trades en seguimiento (near-misses) |
| `archive` | `shadow-trades-archive-v1` | `shadow_trades_archive.json` | Histórico de trades shadow |
| `memory` | `signal-memory-v1` | `signal_memory.json` | Memoria de momentum por símbolo |
| `autopsy` | `trade-autopsies-v1` | `autopsies.json` | Diagnóstico de trades cerrados |

## 🛠️ Solución de Problemas

- **"No Netlify auth token found"**: Asegúrate de haber ejecutado `netlify login`. Si el problema persiste en macOS/Linux, el script busca automáticamente el token en las rutas estándar de configuración de la CLI.
- **Archivos Vacíos**: Si un blob no existe en el servidor o está vacío, el script creará un archivo con un array vacío `[]` para evitar errores en otras partes de la aplicación.
