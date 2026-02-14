

Review
Guía: Cómo Compartir tu Bot de Telegram de Forma Privada
Esta guía te explica paso a paso cómo crear un Grupo Privado o un Canal en Telegram para que tu amigo (y tú) podáis recibir las alertas del bot sin que nadie más pueda acceder.

Paso 1: Crear el Grupo o Canal
La opción más sencilla es crear un Nuevo Grupo.

Abre Telegram en tu móvil o escritorio.
Ve al menú y selecciona "Nuevo Grupo".
Añade a tu amigo (o a alguien de confianza temporalmente, incluso a otro bot) para poder crearlo.
Ponle un nombre chulo, por ejemplo: 💎 Alertas Crypto VIP.
Dale a Crear.
Paso 2: Añadir al Bot como Administrador
Para que el bot pueda enviar mensajes al grupo sin restricciones, debe ser administrador.

Entra en la información del grupo (toca en el nombre arriba).
Ve a Añadir Miembro.
Busca tu bot por su nombre de usuario (ej: @TuBotDeTrading_bot).
Una vez añadido, ve a la lista de miembros, mantén pulsado sobre el bot (o clic derecho en PC) y selecciona "Promover a administrador".
Asegúrate de que tenga permiso para "Enviar mensajes".
Paso 3: Obtener el ID del Grupo
Este es el paso técnico clave. Necesitamos saber el "DNI" (ID) de ese grupo para decírselo a Netlify.

Añade al siguiente bot al grupo: @RawDataBot (se llama "Raw Data").
En cuanto entre, este bot enviará un mensaje técnico con mucha información JSON.
Busca la sección que dice "chat" y dentro "id".
El ID de un grupo suele empezar por - (signo menos). Ejemplo: -100123456789.
Copia ese número entero (incluyendo el signo menos).
Una vez tengas el número, expulsa a @RawDataBot del grupo para que no moleste más.
Paso 4: Configurar en Netlify
Ahora le diremos a tu algoritmo que envíe las alertas a ese grupo en lugar de a ti en privado.

Ve a tu panel de Netlify.
Entra en tu proyecto (Site settings > Environment variables).
Busca la variable TELEGRAM_CHAT_ID.
Cambia su valor por el ID del Grupo que copiaste en el paso anterior (ej: -100123456789).
Guarda los cambios.
Paso 5: ¡Listo!
A partir de ahora:

Todas las alertas del bot llegarán al grupo.
Tú y tu amigo las veréis al mismo tiempo.
Si quieres invitar a más gente, solo tienes que enviarles el enlace de invitación del grupo.
Si quieres echar a alguien, simplemente le expulsas del grupo y dejará de recibir alertas.
Nota: No es necesario reiniciar nada. La próxima vez que se ejecute el análisis (cada 15 min / 1 hora), usará el nuevo ID automáticamente.