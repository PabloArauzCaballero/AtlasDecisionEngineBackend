# Validadores de grafo

Esta carpeta separa reglas estructurales, determinismo y referencias de expresiones. A nivel de
negocio evita aprobar políticas ambiguas o con caminos sin decisión; a nivel de sistema produce
issues estables con código, alcance y severidad antes de compilar.

Los validadores son puros y no consultan infraestructura. Toda nueva forma de nodo debe definir su
shape, referencias permitidas, terminalidad y efecto sobre alcanzabilidad.
