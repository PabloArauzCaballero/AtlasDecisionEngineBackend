# Ejecución en vivo

Este módulo transmite una simulación nodo a nodo para autores y QA. A nivel de negocio permite
explicar una ruta antes de publicar sin generar evidencia productiva falsa; a nivel de sistema usa
SSE, heartbeat configurable y el mismo resolver/motor que la simulación, sin persistir ejecución.

La feature requiere `LIVE_EXECUTION_STREAM_ENABLED=true`, rechaza PROD y limita el JSON de entrada.
Los errores inesperados se registran en servidor y se redactan porque el handshake SSE ya respondió
HTTP 200.
