# 🚀 Crypto Trading Signals Bot - AI Powered

Bot de señales de trading profesional para criptomonedas que combina **análisis técnico avanzado** con **inteligencia artificial** (Gemini API) para identificar oportunidades de compra en day trading spot.

![Trading Bot Screenshot](/.gemini/antigravity/brain/62e43ff4-9802-4fb3-9934-73b6aff0fb76/trading_bot_dashboard_1764061188086.png)

## ✨ Características

### Análisis Técnico Avanzado
- **Indicadores Técnicos**: RSI, MACD, Bollinger Bands, EMA/SMA, ATR, Stochastic Oscillator
- **Análisis Multi-Timeframe**: 1h (entrada) y 4h (tendencia)
- **Detección de Patrones**: Hammer, Engulfing, Three White Soldiers, Morning Star, Evening Star, Double Top, Double Bottom
- **Detección de Divergencias**: Divergencias alcistas/bajistas en RSI y MACD
- **Soporte/Resistencia**: Identificación automática de niveles clave
- **Análisis de Volumen**: Spikes, presión compradora/vendedora, On-Balance Volume (OBV)
- **Detección de Acumulación**: Identifica zonas de acumulación antes de breakouts
- **Convergencia de Indicadores**: Requiere múltiples indicadores alineados para validar señal
- **Niveles Dinámicos**: Stop Loss y Take Profit adaptados a volatilidad real (ATR)

### Inteligencia Artificial
- **Análisis con Gemini AI**: Validación de señales y análisis de sentimiento
- **Insights Automatizados**: Recomendaciones basadas en IA
- **Evaluación de Riesgo**: Assessment automático de cada señal

### Interfaz de Usuario
- **Diseño Premium**: Dark theme con glassmorphism
- **Responsive**: Optimizado para desktop y móvil
- **Notificaciones**: Alertas en navegador y Telegram para nuevas señales
- **Auto-Refresh**: Actualización automática cada 20 minutos
- **Análisis Automático**: Función serverless que analiza el mercado cada 20 minutos
- **Real-time Data**: Datos en tiempo real desde Binance API

### Señales de Trading
- **Score de Confianza**: Algoritmo de scoring 0-100 con convergencia de indicadores
- **Convergencia Requerida**: Mínimo 2 indicadores alineados para generar señal
- **Niveles Precisos**: Entry, Take Profit 1, Take Profit 2, Stop Loss (dinámicos basados en ATR)
- **Risk/Reward Ratio**: Cálculo automático con niveles adaptativos
- **Razones Detalladas**: Explicación de por qué se generó la señal

## 🛠️ Tecnologías

- **Frontend**: React 19 + Vite
- **Estilos**: CSS Moderno (Glassmorphism, Gradientes, Animaciones)
- **Data Source**: Binance API (pública, sin autenticación)
- **AI**: Google Gemini API
- **Serverless**: Netlify Functions
- **Icons**: Lucide React
- **Charts**: Recharts
- **Deployment**: Netlify

## 📋 Requisitos Previos

- Node.js 18 o superior
- npm o yarn
- API Key de Gemini (gratis en [Google AI Studio](https://makersuite.google.com/app/apikey))
- Bot de Telegram (opcional, para notificaciones automáticas)
- Cuenta de Netlify (gratis)

## 🚀 Instalación Local

### 1. Clonar el repositorio
\`\`\`bash
git clone <tu-repositorio>
cd trading
\`\`\`

### 2. Instalar dependencias
\`\`\`bash
npm install
\`\`\`

### 3. Configurar variables de entorno
\`\`\`bash
# Copiar el archivo de ejemplo
cp .env.example .env

# Editar .env y agregar tu API key de Gemini
GEMINI_API_KEY=tu_api_key_aqui
\`\`\`

### 4. Ejecutar en desarrollo
\`\`\`bash
npm run dev
\`\`\`

La aplicación estará disponible en `http://localhost:5173`

### 5. (Opcional) Probar funciones serverless localmente
\`\`\`bash
# Instalar Netlify CLI
npm install -g netlify-cli

# Ejecutar con funciones
netlify dev
\`\`\`

## 🌐 Despliegue en Netlify

### Opción 1: Despliegue Automático desde Git

1. **Conectar Repositorio**
   - Ve a [Netlify](https://app.netlify.com)
   - Click en "Add new site" → "Import an existing project"
   - Conecta tu repositorio de Git (GitHub, GitLab, Bitbucket)

2. **Configurar Build Settings**
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Functions directory: `netlify/functions`

3. **Configurar Variables de Entorno**
    - En Netlify Dashboard → Site settings → Environment variables
    - Agregar: `GEMINI_API_KEY` con tu API key
    - **Opcional para Telegram**: `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID`

4. **Deploy**
   - Click en "Deploy site"
   - Netlify automáticamente construirá y desplegará tu aplicación

### Opción 2: Despliegue Manual con CLI

\`\`\`bash
# Instalar Netlify CLI (si no lo tienes)
npm install -g netlify-cli

# Login en Netlify
netlify login

# Inicializar sitio
netlify init

# Configurar variable de entorno
netlify env:set GEMINI_API_KEY tu_api_key_aqui

# Build local
npm run build

# Desplegar
netlify deploy --prod
\`\`\`

### Configuración Post-Deployment

1. **Variables de Entorno en Netlify**
    - Site settings → Environment variables
    - Agregar `GEMINI_API_KEY` con tu API key de Gemini
    - **Opcional para notificaciones Telegram**: `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID`

2. **Configurar Bot de Telegram (Opcional)**
    - Crear un bot con [@BotFather](https://t.me/botfather) en Telegram
    - Obtener el token del bot
    - Iniciar conversación con tu bot y enviar `/start`
    - Obtener el Chat ID usando: `https://api.telegram.org/bot<TOKEN>/getUpdates`
    - Configurar `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID` en Netlify

3. **Verificar Funciones Serverless**
    - En Functions tab, verificar que `gemini-analysis` y `scheduled-analysis` estén desplegadas
    - La función `scheduled-analysis` se ejecutará automáticamente cada 20 minutos

4. **Probar la Aplicación**
    - Visitar tu URL de Netlify (ej: `https://tu-app.netlify.app`)
    - Esperar a que carguen los datos del mercado
    - Verificar que se generen señales
    - Si configuraste Telegram, recibirás notificaciones automáticas cada 20 minutos

    ### Protección del endpoint de notificaciones (recomendado)

    Para evitar que terceros invocen la función `scheduled-analysis` y provoquen envíos no deseados a tu bot de Telegram, el proyecto soporta un secreto opcional.

    - `NOTIFY_SECRET` (server-side): valor secreto que debes configurar en Netlify como variable de entorno. Si `NOTIFY_SECRET` está definido, la función rechazará cualquier POST que no incluya el header `x-notify-secret` con el valor correcto (HTTP 401).
    - `VITE_NOTIFY_SECRET` (client/build): si quieres que el frontend pueda notificar al servidor (por ejemplo, al abrir la app), añade el mismo valor como `VITE_NOTIFY_SECRET` en Netlify. Cuando el cliente se construya, `import.meta.env.VITE_NOTIFY_SECRET` será embebido y el cliente incluirá `x-notify-secret` en las peticiones.

    Ejemplo de `.env` local (NO subir al repositorio):

    ```dotenv
    # API Key (NO SUBIR)
    GEMINI_API_KEY=tu_gemini_key_aqui

    # Telegram
    TELEGRAM_ENABLED=true
    TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
    TELEGRAM_CHAT_ID=987654321

    # Protección del endpoint (opcional)
    NOTIFY_SECRET=mi-secreto-largo-y-aleatorio
    VITE_NOTIFY_SECRET=mi-secreto-largo-y-aleatorio
    ```

    Prueba local rápida:

    1. Añade las variables al `.env` como en el ejemplo anterior.
    2. Carga las variables y ejecuta el script de prueba que invoca la función con POST (incluye el header si `NOTIFY_SECRET` está presente):

    ```bash
    set -a && source .env && set +a
    node test/invoke_notify.mjs
    ```

    3. Revisa el chat de Telegram y los logs de la función en Netlify.

    Notas de seguridad y alternativas:

    - `VITE_NOTIFY_SECRET` se incorpora al bundle del cliente en tiempo de *build* (necesario si quieres que el frontend haga POST directamente). Si prefieres no exponer ningún secreto en el frontend, no configures `VITE_NOTIFY_SECRET` y utiliza un flujo completamente server-side (por ejemplo, guardar señales en una cola y procesarlas desde funciones protegidas).
    - Si no deseas que el cliente notifique automáticamente, se puede cambiar para que solo notifique cuando el usuario active la campana de notificaciones.

    Configura en Netlify (resumen):

    - `TELEGRAM_ENABLED=true`
    - `TELEGRAM_BOT_TOKEN` = tu token
    - `TELEGRAM_CHAT_ID` = tu chat id
    - `NOTIFY_SECRET` = mi-secreto-largo-y-aleatorio
    - `VITE_NOTIFY_SECRET` = mi-secreto-largo-y-aleatorio

## 📊 Uso de la Aplicación

### Dashboard Principal
- **Mercado**: Visualiza precios actuales de 6 criptomonedas principales
- **Indicadores**: RSI en tiempo real con código de colores
- **Cambio 24h**: Porcentaje de cambio con indicador visual

### Señales de Trading
- **Score**: Puntuación de 0-100 (mayor = mejor oportunidad)
- **Confianza**: HIGH/MEDIUM/LOW basado en el score
- **Niveles de Trading**:
  - **Entry**: Precio de entrada recomendado
  - **TP1**: Take Profit 1 (+2%)
  - **TP2**: Take Profit 2 (+5%)
  - **Stop Loss**: Nivel de protección (-2% bajo soporte)

### Notificaciones
1. Click en el icono de campana para activar
2. Permitir notificaciones en el navegador
3. Recibirás alertas cuando se generen nuevas señales

### Actualización Manual
- Click en el icono de refresh para obtener datos actualizados inmediatamente

## 🔧 Personalización

### Modificar Criptomonedas Monitoreadas
Editar en `src/App.jsx`:
\`\`\`javascript
const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'ADAUSDT', 'XRPUSDT'];
\`\`\`

### Ajustar Intervalo de Actualización
Cambiar en `src/App.jsx`:
\`\`\`javascript
const REFRESH_INTERVAL = 20 * 60 * 1000; // 20 minutos en ms
\`\`\`

### Modificar Umbral de Señales
Editar en `src/services/signalGenerator.js`:
```javascript
// Ahora el umbral y pesos están centralizados en SIGNAL_CONFIG.
// Para ajustar el comportamiento edita `SIGNAL_CONFIG` en `src/services/signalGenerator.js`.
// Ejemplo: cambiar `scoreToEmit` a 0.5 para ser más permisivo.
```

### Configurar Umbral para Notificaciones (Telegram)
Para controlar qué señales se envían al bot de Telegram, configura la variable de entorno `SIGNAL_SCORE_THRESHOLD` en Netlify.

- **Variable**: `SIGNAL_SCORE_THRESHOLD`
- **Valor por defecto**: `70`
- **Descripción**: Mínimo score (0-100) requerido para enviar una notificación.
- **Ejemplo**: Si quieres recibir más señales, bájalo a `60`. Si quieres solo las mejores, súbelo a `80`.

### Ejecutar backtests con datos reales

El motor de backtesting vive en [scripts/v13-backtest.js](scripts/v13-backtest.js). Descarga klines de Binance (con cache local 6h), simula el bot vela a vela y produce un reporte HTML + JSON con OOS train/holdout.

**Comandos rápidos:**
```bash
# Backtest individual del bot Trader o Knife (1 mes, top-5 USDT por defecto)
npm run backtest:trader
npm run backtest:knife

# Torneo de estrategias: corre 10-14 variantes y elige ganador
npm run tournament:trader
npm run tournament:knife

# Verificar que los wrappers de producción (v14/v4) coinciden con el backtest
node scripts/verify-wrappers.js
```

Cada backtest abre automáticamente el HTML al terminar. Output va a [backtests/](backtests/) (1 archivo por tipo, se sobrescribe en cada run).

Documentación completa: [BACKTEST_GUIDE.md](BACKTEST_GUIDE.md). Auditoría y justificación de las estrategias actuales: [AUDIT_BOTS_2026-05.md](AUDIT_BOTS_2026-05.md).

## 🧪 Estructura del Proyecto

\`\`\`
trading/
├── src/
│   ├── components/          # Componentes React
│   │   ├── SignalCard.jsx   # Tarjeta de señal
│   │   ├── SignalCard.css
│   │   ├── CryptoCard.jsx   # Tarjeta de crypto
│   │   └── CryptoCard.css
│   ├── services/            # Lógica de negocio
│   │   ├── binanceService.js      # Conexión con Binance API
│   │   ├── technicalAnalysis.js   # Indicadores técnicos
│   │   ├── signalGenerator.js     # Generación de señales
│   │   └── aiAnalysis.js          # Cliente de AI
│   ├── App.jsx              # Componente principal
│   ├── App.css
│   ├── index.css            # Estilos globales
│   └── main.jsx             # Entry point
├── netlify/
│   └── functions/
│       ├── gemini-analysis.js     # Función serverless para AI
│       └── scheduled-analysis.js  # Función programada para análisis automático
├── public/                  # Assets estáticos
├── netlify.toml            # Configuración de Netlify
├── .env.example            # Template de variables
└── package.json
\`\`\`

## ⚠️ Disclaimer

**IMPORTANTE**: Este bot es solo para fines educativos y de investigación. Las señales generadas NO constituyen asesoramiento financiero. El trading de criptomonedas es altamente riesgoso y puede resultar en pérdida total de capital.

**Siempre**:
- Haz tu propia investigación (DYOR)
- Solo invierte lo que puedas permitirte perder
- Usa stop loss en todas tus operaciones
- Nunca operes con apalancamiento si eres principiante

## 📝 Licencia

Este proyecto es de código abierto y está disponible bajo la licencia MIT.

## 🤝 Contribuciones

Las contribuciones son bienvenidas. Por favor:
1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## 📧 Soporte

Si encuentras algún bug o tienes sugerencias, por favor abre un issue en GitHub.

## 🙏 Agradecimientos

- [Binance](https://binance.com) por su API pública
- [Google](https://ai.google.dev) por Gemini API
- [Netlify](https://netlify.com) por hosting y funciones serverless
- Comunidad de trading por compartir conocimientos

---

**Happy Trading! 🚀📈**

*Recuerda: El mejor momento para aprender trading es ahora, pero el mejor momento para operar es cuando estás preparado.*
