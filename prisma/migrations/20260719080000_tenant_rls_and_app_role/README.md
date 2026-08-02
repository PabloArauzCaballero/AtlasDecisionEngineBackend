# Migración: RLS y rol de aplicación

Crea `atlas_app` sin privilegios de bypass y activa aislamiento por tenant en tablas raíz. A nivel
de negocio impide exposición cruzada aunque falte un filtro; a nivel de sistema usa
`app.tenant_id`, fuerza RLS y separa credencial de runtime de la credencial de migración.
