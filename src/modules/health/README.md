# Salud del servicio

Este módulo ofrece liveness y readiness para orquestadores y soporte. A nivel de negocio evita
enviar tráfico a una instancia incapaz de decidir; a nivel de sistema distingue proceso vivo de
dependencias listas y redacta detalles de infraestructura en rutas públicas.

Liveness no debe depender de servicios externos. Readiness comprueba PostgreSQL/Redis y devuelve
señales accionables sin credenciales ni mensajes crudos.
