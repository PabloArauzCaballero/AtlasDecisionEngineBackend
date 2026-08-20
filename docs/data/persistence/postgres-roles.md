# Roles y privilegios PostgreSQL

Cuatro roles conceptuales, con responsabilidades que no se solapan:

| Rol | Para qué | Quién lo usa |
| --- | --- | --- |
| `atlas` (propietario/migrador) | Crea objetos y aplica migraciones | `prisma migrate`, aprovisionamiento |
| `atlas_app` | Rol histórico del runtime, NO superusuario | La aplicación mientras no se separen rutas |
| `atlas_writer` | DML de la aplicación en la ruta de escritura | `DATABASE_WRITE_URL` |
| `atlas_reader` | Consultas, estrictamente de solo lectura | `DATABASE_READ_URL` |

En desarrollo, propietario y migrador coinciden. **La conexión administrativa no se
registra nunca en el runtime**: `postgres-admin` es un nombre reservado que el registro se
niega a aceptar y el router se niega a resolver.

## Qué recibe cada rol

### `atlas_writer`

Recibe: `CONNECT`, `USAGE` sobre los esquemas gestionados, `SELECT`/`INSERT`/`UPDATE`/
`DELETE` sobre las tablas, `USAGE, SELECT` sobre las secuencias, y los privilegios
predeterminados equivalentes para los objetos futuros.

No recibe: `SUPERUSER`, `CREATEDB`, `CREATEROLE`, `REPLICATION`, `BYPASSRLS`, propiedad de
la base ni permisos administrativos. **No se usa como migrador.**

Excepción explícita: `UPDATE`, `DELETE` y `TRUNCATE` están **revocados** sobre
`decision_audit_event`. La cadena de auditoría es append-only y encadenada por hash; el
escritor inserta y nada más. Espeja lo que la migración `20260719080000` aplica a
`atlas_app` y refuerza los disparadores existentes.

### `atlas_reader`

Recibe: `CONNECT`, `USAGE` sobre los esquemas gestionados, `SELECT` sobre tablas y vistas.

No puede: `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `CREATE`, `ALTER`, `DROP`, `GRANT`,
`REVOKE`, ni tocar secuencias. **Y hay pruebas que lo ejecutan de verdad** — ver
[pruebas y evidencia](testing-and-evidence.md).

Ninguno de los dos tiene `BYPASSRLS`: un rol de aplicación que se salte la Row-Level
Security anula el aislamiento por tenant de la plataforma entera.

## Aprovisionamiento idempotente

```bash
yarn db:provision:dev
```

o, dentro de Compose:

```bash
docker compose --profile provision run --rm provision-db-roles
```

El script (`scripts/postgres/provision-development-roles.mjs`):

1. Valida el entorno y **se niega a correr con `NODE_ENV=production`**.
2. Carga `.env` sin depender de dotenv.
3. Se conecta con el rol administrativo.
4. Crea los roles que falten.
5. **Reafirma los atributos en cada corrida**: si alguien concedió `SUPERUSER` o
   `BYPASSRLS` a mano, volver a ejecutarlo lo deshace.
6. Fija las contraseñas desde variables, nunca desde SQL versionado.
7. Concede privilegios sobre los objetos existentes.
8. Configura los privilegios predeterminados con el `FOR ROLE` correcto.
9. **Verifica preguntando al motor**, no dando por hecho que el `GRANT` surtió efecto.
10. Emite un resumen saneado: nombres de rol y recuentos, ni URL, ni contraseñas, ni host.
11. Sale con código distinto de cero ante un problema real.

### Seguridad del DDL dinámico

Ninguna sentencia se construye concatenando texto. Se genera **en el servidor** con
`format('%I' / '%L')` y parámetros enlazados:

```js
const { rows } = await client.query(
  `SELECT format('ALTER ROLE %I WITH PASSWORD %L', $1::text, $2::text) AS stmt`,
  [role, password],
);
await client.query(rows[0].stmt);
```

Es el propio PostgreSQL quien entrecomilla identificador y literal. Concatenar aquí sería
el camino corto a una inyección en el script que existe precisamente para endurecer la
base.

### Variables

| Variable | Por defecto | Notas |
| --- | --- | --- |
| `POSTGRES_ADMIN_URL` | `ADMIN_DATABASE_URL` → `DATABASE_URL` | Conexión administrativa |
| `POSTGRES_WRITER_ROLE` | `atlas_writer` | Validado contra `^[a-z_][a-z0-9_]{0,62}$` |
| `POSTGRES_READER_ROLE` | `atlas_reader` | Debe ser distinto del escritor |
| `POSTGRES_WRITER_PASSWORD` | *(obligatoria)* | ≥ 16 caracteres |
| `POSTGRES_READER_PASSWORD` | *(obligatoria)* | ≥ 16 caracteres y **distinta** de la anterior |
| `POSTGRES_MANAGED_SCHEMAS` | `public` | Lista separada por comas |
| `POSTGRES_OBJECT_OWNER_ROLE` | usuario administrativo | Rol que CREA los objetos |

Contraseñas iguales para lector y escritor se rechazan: las credenciales separadas son el
punto de todo esto.

## Privilegios predeterminados

Dependen del rol **que crea** los objetos, por eso llevan `FOR ROLE`:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE atlas IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO atlas_writer;
ALTER DEFAULT PRIVILEGES FOR ROLE atlas IN SCHEMA public
  GRANT SELECT ON TABLES TO atlas_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE atlas IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO atlas_writer;
```

Sin el `FOR ROLE` correcto, la tabla de la próxima migración nace invisible para los dos
roles y la aplicación falla justo después de desplegar. Si el rol migrador cambia, hay que
reejecutar el aprovisionamiento.

## Producción

**No se crean roles automáticamente en producción.** Ni al arrancar, ni desde el runtime.
El script se niega explícitamente. En producción:

- El aprovisionamiento va por IaC o proceso controlado, con
  `scripts/postgres/provision-roles.sql` como fuente declarativa.
- Las credenciales vienen de un gestor de secretos.
- Los cambios quedan auditados.
- La aplicación no puede ejecutar `CREATE ROLE` ni modificar privilegios globales.

El `.sql` **no contiene contraseñas**. Se fijan aparte:

```sql
ALTER ROLE atlas_writer WITH PASSWORD '<secreto del gestor>';
ALTER ROLE atlas_reader WITH PASSWORD '<secreto del gestor>';
```

## Por qué no `docker-entrypoint-initdb.d`

Esos scripts corren **solo al crear el volumen por primera vez**. Una base que ya existe
—lo normal en desarrollo— no los vuelve a ver nunca. Por eso el aprovisionamiento es un
comando explícito y reejecutable, y el servicio de Compose vive bajo el perfil `provision`
en lugar de montarse en el arranque de PostgreSQL.

## Migraciones

Las migraciones usan `ADMIN_DATABASE_URL` (o `POSTGRES_MIGRATION_URL` donde se separe).
**Nunca la conexión de lectura.** Flujo:

1. `prisma migrate deploy` con el rol elevado.
2. `yarn db:provision:dev` para que los `GRANT` alcancen a las tablas nuevas.
3. Verificar acceso del escritor y del lector.
4. Ejecutar las pruebas de contrato y de privilegios.

## Documentos relacionados

- [Enrutamiento de lectura y escritura](read-write-routing.md)
- [Pruebas y evidencia](testing-and-evidence.md)
- [Aislamiento por tenant](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/security/tenant-isolation.md)
- [Migraciones](../migrations.md)
