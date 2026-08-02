# Módulos de dominio

Cada subcarpeta implementa una capacidad de negocio con controller, DTO, módulo y servicios
cohesivos. Esta separación existe para asignar dueños y reglas sin crear una clase central; en el
sistema mantiene límites de NestJS, dependencias explícitas y pruebas por dominio.

Los controladores validan y delegan. Los servicios contienen invariantes, usan transacciones para
acción más auditoría y no devuelven autoridad al frontend. Colaboraciones opcionales con el motor
se pasan por argumentos para evitar ciclos de módulos.
