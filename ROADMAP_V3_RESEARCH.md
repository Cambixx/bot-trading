# 🗺️ Hoja de Ruta: Investigación Avanzada V3.0 (Grado Institucional)

Este documento detalla los pilares técnicos para la próxima gran actualización del algoritmo. El objetivo es evolucionar de un sistema basado en indicadores a un sistema basado en **Acción de Precio Institucional** y **Fluidez de Capital**.

---

## 1. Perfil de Volumen por Precio (VPVR) 📊
*El volumen actual es por tiempo (vertical), pero el "dinero inteligente" se mueve por niveles de precio (horizontal).*

### Conceptos Clave:
- **POC (Point of Control)**: El nivel de precio con mayor volumen negociado en un periodo. Actúa como soporte/resistencia magnética.
- **Value Area (VA)**: El rango de precios donde ocurrió el 70% del volumen.
- **Lógica de Implementación**: 
    - No entrar en señales que estén justo debajo de un POC "virgen" (resistencia).
    - Priorizar señales que nazcan desde un POC previo (soporte validado por volumen).

---

## 2. Detección de Market Structure Shift (MSS / ChoCh) 🔄
*Evitar entrar en "caídas libres" solo porque el RSI está bajo. Esperar a que el mercado diga "ya no quiero bajar más".*

### Lógica de Detección:
1.  **Contexto**: El precio está en una zona de descuento (RSI bajo, cerca de soporte).
2.  **Evento**: El precio rompe el último **Máximo Descendente** (en 15m) con una vela impulsiva.
3.  **Confirmación**: Entrar en el **RTO (Return to Origin)** o el primer FVG que se forme tras el cambio de carácter.
- **Beneficio**: Asegura que la tendencia de corto plazo ha revertido antes de poner dinero.

---

## 3. Barrido de Liquidez (Liquidity Sweeps) 🧹
*El mercado crypto a menudo "caza" los stops de la gente antes de iniciar el movimiento real.*

### Identificación Técnica:
- **Patrón**: El precio cae por debajo de un mínimo previo importante (Equal Lows o Swing Low).
- **Acción**: Deja una mecha larga (reject) y cierra rápidamente por encima del mínimo previo.
- **Scoring V3**: Un Barrido de Liquidez + RSI Divergencia será la señal de mayor puntuación (Rating: "A++").

---

## 4. Filtro de Correlación Dinámica (Beta de BTC) 📉
*Ninguna Altcoin es una isla. Si el "Jefe" (BTC) está mal, las Alts sufren.*

### Implementación del "Semáforo BTC":
- **🟢 Verde**: BTC en tendencia alcista 4H y consolidando. Máximo riesgo permitido en Alts.
- **🟡 Ámbar**: BTC lateral o cerca de resistencia macro. Las Alts requieren un Score > 85 para disparar.
- **🔴 Rojo**: BTC rompiendo soportes macro. El bot de Alts se apaga automáticamente o solo permite señales de score 95+.

---

## 5. Gestión de Riesgo Adaptativa ⚙️
- **Sizing Dinámico**: No arriesgar lo mismo en todas las señales. Las señales con Confluencia SMC + Volumen (Grade A) tendrán un tamaño de posición 1.5x mayor que las de Grade B.
- **Trailing Stop Automático**: Mover a Breakeven una vez que el precio alcance el 1:1 de beneficio para proteger capital.

---

### ¿Cuándo implementar?
Implementar estos módulos cuando el historial de la **v2.4** alcance las **30-50 señales**. Esto nos dará la base estadística para calibrar los pesos de estos nuevos filtros.

---
*Documento de Investigación V3.0 - Creado el 23 de Enero, 2026*
