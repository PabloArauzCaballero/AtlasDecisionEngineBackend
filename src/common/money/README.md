# Dinero exacto

`Money` existe para que una decisión financiera no dependa de redondeo binario. A nivel de negocio
protege importes, moneda y reproducibilidad; a nivel de sistema representa unidades menores con
`bigint`, controla escala y define serialización decimal canónica.

No convierta dinero a `number` para cálculos regulados. Operaciones entre monedas o escalas
incompatibles deben fallar explícitamente.
