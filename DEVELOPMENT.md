# Guía de Desarrollo

## Ejecutar en Desarrollo

### Opción 1: Con Vite (Recomendado para desarrollo rápido)
```bash
npm run dev
```
- Inicia servidor en `http://localhost:5174`
- Hot reload automático
- **Nota:** Notificaciones Telegram no funcionarán en local

### Opción 2: Con Netlify Dev (Para probar Telegram)
```bash
# Primero instala netlify CLI
npm install -g netlify-cli

# Luego ejecuta
netlify dev
```
- Inicia servidor en `http://localhost:8888`
- Hot reload automático
- **Ventaja:** Proxea correctamente `/.netlify/functions/*`
- Puedes probar notificaciones Telegram en local

## Variables de Entorno

Crear archivo `.env` en la raíz:
```dotenv
GEMINI_API_KEY=tu_api_key
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=tu_bot_token
TELEGRAM_CHAT_ID=tu_chat_id
NOTIFY_SECRET=tu_secret
VITE_NOTIFY_SECRET=tu_secret
VITE_GEMINI_API_KEY=tu_api_key
SIGNAL_SCORE_THRESHOLD=50
```

## Build para Producción

```bash
npm run build
```

Genera carpeta `dist/` lista para deploy en Netlify.

## Testing

### Test de Generación de Señales
```bash
node test/test_signal_generation.mjs
```

Verifica que el algoritmo de señales genera resultados con datos reales de Binance.

### Test de Notificaciones Telegram
```bash
node test/invoke_notify.mjs
```

Envía test directo a Telegram (requiere `.env` configurado).

## Troubleshooting

### Error 404 en Telegram
- En desarrollo con `npm run dev`: Normal, Netlify functions no están disponibles
- En producción: Verifica que `SIGNAL_SCORE_THRESHOLD` esté configurado en Netlify Dashboard
- Las señales se generan pero no se notifican en dev

### Skeleton loaders no animados
- Verifica que los archivos CSS estén cargados
- Abre DevTools → Console para ver errores
- Limpia caché del navegador (Cmd+Shift+R)

### Señales no se generan
- Verifica que `SIGNAL_SCORE_THRESHOLD` sea razonable (recomendado: 50-60)
- Ejecuta `node test/test_signal_generation.mjs` para diagnosticar
- Revisa que Binance API esté disponible (sin VPN)
