# PMXIXON – Estado del trabajo

## Resumen
- Mapa 3D con MapLibre + deck.gl, sensores comunitarios y estaciones oficiales AsturAire.
- Sensores comunitarios muestran banderas con etiqueta y panel con iframe Grafana Madavi (24h/7d/28d).
- Estaciones oficiales usan AsturAire (RestCecoma) con autenticacion por firma SHA-256.
- Botones: Rotacion (con slider), Relieve ON/OFF, Banderas ON/OFF, Malla ON/OFF (solo cuando banderas OFF).
- Viento: capa de particulas basada en `wind.json`; viento y rotacion son mutuamente excluyentes.
- Barra meteo con prevision diaria compacta e iconos (Open-Meteo).
- Malla conecta puntos con Delaunay (LineLayer) usando altura de palos (oficiales a media altura).
- Direcciones con Nominatim; etiquetas con formato “Sensor <calle>, <barrio>” sin Gijon.
- Leyenda con escala AQI de 5 colores.
- Estado superior incluye hora de ultima actualizacion por tipo (icono de reloj).
- Boton de pantalla completa flotante en esquina inferior derecha del mapa.
- Controles se mueven bajo el mapa en movil.
- Tarjetas comunitarias incluyen links “Más datos | Sensor Community”.
- Boton cerrar en tarjetas es una “✕”.

## Puntos clave de la implementacion
- Sensores comunitarios: `https://data.sensor.community/airrohr/v1/filter/area=43.5322,-5.6611,6`.
- Grafica Madavi (embed):
  - Base: `https://api-rrd.madavi.de:3000/grafana/d-solo/GUaL5aZMA/pm-sensors-by-map-id`
  - Params: `orgId=1&timezone=browser&var-type=sds011&var-query0=feinstaub&panelId=panel-3|5|7&var-chipID=<nodeId>`.
- Viento:
  - Fuente: `https://maps.sensor.community/data/v1/wind.json` (U/V a 10m).
  - Render: particulas en canvas con campo vectorial en pantalla.
- Meteo:
  - Fuente: `https://api.open-meteo.com/v1/forecast` (daily).
- AsturAire:
  - Base: `https://calidaddelairews.asturias.es/RestCecoma`
  - Auth headers: `signature` y `timestamp`, signature = sha256(sha256(user+pass)+timestamp)
  - `getEstacion?ides=<uuid>` devuelve detalles (incluye `tmpFEs`).
  - `getDato?uuidEs=<uuid>&histo=60m&validado=T&fechaiF=DD-MM-YYYY&fechafF=DD-MM-YYYY` devuelve medidas.

## Servidor local / proxy
- `server.py` sirve el sitio, proxya AsturAire y lanza el colector en segundo plano.
- `asturaire-proxy.php` es el proxy para entorno PHP (produccion).
- El frontend prueba `./asturaire-proxy.php` y luego `/asturaire` (python).

## Archivos clave
- `PMXIXON/index.html`
- `PMXIXON/style.css`
- `PMXIXON/main.js`
- `PMXIXON/server.py`
- `PMXIXON/collector.py`
- `PMXIXON/asturaire-proxy.php`

## Notas de configuracion
- Token Mapbox DEM: `MAPBOX_TOKEN` en `main.js`.
- Malla: `toggle-mesh` solo visible cuando banderas OFF.
- Rotacion: slider `rotate-speed` visible cuando rotacion ON.
- Historico oficial server: `data/official_history.json` (precarga en el navegador).
- Despliegue: copiar `Desktop/PMXIXON-deploy` al servidor (con cache-bust en index).

## Proximo paso sugerido
- Conectar el historico oficial del servidor con la UI si se despliega en produccion.
