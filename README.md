# 🚀 Crypto Trading Signals Bot - AI Powered

Bot de señales de trading profesional para criptomonedas que combina **análisis técnico avanzado** con **inteligencia artificial** (Gemini API) para identificar oportunidades de compra en day trading spot.

![Trading Bot Screenshot](/.gemini/antigravity/brain/62e43ff4-9802-4fb3-9934-73b6aff0fb76/trading_bot_dashboard_1764061188086.png)

## ✨ Características

### Análisis Técnico Avanzado
- **Indicadores Técnicos**: RSI, MACD, Bollinger Bands, EMA/SMA
- **Análisis Multi-Timeframe**: 1h (entrada) y 4h (tendencia)
- **Detección de Patrones**: Hammer, Engulfing Bullish, Doji
- **Soporte/Resistencia**: Identificación automática de niveles clave
- **Análisis de Volumen**: Detección de spikes y volumen promedio

### Inteligencia Artificial
- **Análisis con Gemini AI**: Validación de señales y análisis de sentimiento
- **Insights Automatizados**: Recomendaciones basadas en IA
- **Evaluación de Riesgo**: Assessment automático de cada señal

### Interfaz de Usuario
- **Diseño Premium**: Dark theme con glassmorphism
- **Responsive**: Optimizado para desktop y móvil
- **Notificaciones**: Alertas en navegador para nuevas señales
- **Auto-Refresh**: Actualización automática cada 5 minutos
- **Real-time Data**: Datos en tiempo real desde Binance API

### Señales de Trading
- **Score de Confianza**: Algoritmo de scoring 0-100
- **Niveles Precisos**: Entry, Take Profit 1, Take Profit 2, Stop Loss
- **Risk/Reward Ratio**: Cálculo automático
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

2. **Verificar Funciones Serverless**
   - En Functions tab, verificar que `gemini-analysis` esté desplegada

3. **Probar la Aplicación**
   - Visitar tu URL de Netlify (ej: `https://tu-app.netlify.app`)
   - Esperar a que carguen los datos del mercado
   - Verificar que se generen señales

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
const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutos en ms
\`\`\`

### Modificar Umbral de Señales
Editar en `src/services/signalGenerator.js`:
\`\`\`javascript
if (score < 50) { // Cambiar umbral aqui
  return null;
}
\`\`\`

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
│       └── gemini-analysis.js     # Función serverless
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
