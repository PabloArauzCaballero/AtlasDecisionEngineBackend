---
paths:
  - "src/**/*.ts"
---

# Clean code

- Funciones y clases cohesivas; una responsabilidad por unidad.
- Sin código muerto ni duplicación semántica: reutiliza los servicios existentes
  (validador de grafo, runner de scripts, escritor de ejecución) en vez de
  reimplementar.
- Nombres que reflejen el dominio (artifact, version, node, edge, condition,
  action, reason). Sigue las convenciones del código circundante.
- Prefiere composición y argumentos explícitos sobre estado global.
- Escribe código que lea como el que lo rodea (densidad de comentarios, idioma,
  idioms).
