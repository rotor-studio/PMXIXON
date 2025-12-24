# PMXIXON

Mapa 3D de calidad del aire en Gijón/Xixón con sensores comunitarios, estaciones oficiales y capa de viento. Incluye tarjetas con histórico local de 24h, previsión meteorológica y visualización en tiempo real.

## Qué incluye
- Mapa 3D con MapLibre + deck.gl.
- Sensores comunitarios (Sensor.Community) y estaciones oficiales (AsturAire).
- Banderas con valores actuales y paneles con histórico local de 24h.
- Capa de viento (partículas) basada en `wind.json` de Sensor.Community.
- Barra de previsión diaria con iconos y UV (Open‑Meteo).

## Fuentes de datos
- Sensores comunitarios: https://data.sensor.community/airrohr/v1
- Estaciones oficiales: https://calidaddelairews.asturias.es/RestCecoma
- Viento: https://maps.sensor.community/data/v1/wind.json
- Meteo: https://api.open-meteo.com/v1/forecast
- Geocoding: https://nominatim.openstreetmap.org/

## Arranque local (Python)
```sh
python /Users/xd/PMXIXON/server.py
```
Luego abre:
```
http://127.0.0.1:8000
```

El servidor:
- Sirve los archivos estáticos.
- Proxya AsturAire (evita CORS).
- Ejecuta el colector de histórico oficial cada 5 min.

## Colector de histórico oficial
Guarda histórico de estaciones oficiales en `data/official_history.json`.

Una ejecución:
```sh
python /Users/xd/PMXIXON/collector.py
```

Bucle cada 5 min:
```sh
python /Users/xd/PMXIXON/collector.py --loop 300
```

## Despliegue en PHP
En producción usa `asturaire-proxy.php` como proxy. El frontend intenta:
1) `./asturaire-proxy.php`
2) `/asturaire` (proxy Python local)

## Notas
- En móviles sin `crypto.subtle`, se usa SHA‑256 en JS puro.
- La rotación y la capa de viento son mutuamente excluyentes.

## Estructura
- `index.html` UI principal
- `style.css` estilos
- `main.js` lógica y capas
- `server.py` servidor local y proxy
- `collector.py` histórico oficial
- `asturaire-proxy.php` proxy para PHP
- `AGENTS.md` estado del trabajo
