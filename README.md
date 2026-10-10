# Cofrial SpA · Prototipo Hito 2

Este es el ecosistema de transformación digital de Cofrial SpA. Corre sobre AWS Academy e incluye:

| Componente | Dónde corre | Ruta |
| --- | --- | --- |
| E-commerce B2B/B2C con carrito y órdenes | EC2 App | `http://IP/` |
| CRM (pipeline, clientes, pedidos, despachos, requerimientos IA) | EC2 App | `http://IP/crm` |
| Dashboard BI en vivo (ventas × cadena de frío) | EC2 App | `http://IP/dashboard` |
| API de telemetría IoT | EC2 App | `POST /api/telemetria` |
| 5 camiones simulados (Docker) | EC2 IoT | `iot/` |
| Base de datos relacional 3NF | Amazon RDS MySQL 8.0 | `database/schema.sql` |
| IA (clasificación de requerimientos y asistente) | Google Gemini, capa gratuita (con respaldo por reglas) | `app/src/services/ia.js` |

```
cofrial/
├── database/schema.sql          Modelo 3NF (23 tablas + vista v_pedido_total)
├── app/                         Backend Node.js/Express + front-end (HTML, Bootstrap, Chart.js, Leaflet)
│   ├── src/                     API: auth, catálogo, pedidos, CRM, telemetría, BI, IA
│   ├── public/                  Tienda, login, mis pedidos, CRM, dashboard
│   └── scripts/init-db.js       Crea el esquema y carga datos de demostración
├── iot/                         Simulador Python + Dockerfile + docker-compose (5 camiones)
├── infra/aws/                   Script AWS CLI que crea VPC, subredes, SG, RDS y EC2
├── infra/scripts/               Instalación en las EC2 (Node, PM2, Nginx, Docker)
└── docker-compose.local.yml     Todo el sistema en tu PC, sin AWS (para practicar)
```

## Usuarios de prueba

Todos usan la contraseña `Cofrial2026`.

| Rol | Correo | Qué puede hacer |
| --- | --- | --- |
| Administrador | admin@cofrial.cl | Todo |
| Vendedor | vendedor@cofrial.cl | CRM, pedidos telefónicos, dashboard |
| Despachador | despacho@cofrial.cl | Despachos, flota y dashboard |
| Cliente B2B | compras@hospitalsur.cl | Comprar con precios del Convenio Salud |
| Cliente B2C | maria.gonzalez@correo.cl | Comprar a precio de lista |

---

## 1. Probar en tu computador (opcional, recomendado antes de AWS)

Necesitas Docker con el servicio activo.

```bash
cd cofrial
docker compose -f docker-compose.local.yml up -d --build
docker compose -f docker-compose.local.yml exec app node scripts/init-db.js
```

Abre http://localhost:3000. Para apagar todo: `docker compose -f docker-compose.local.yml down`.

---

## 2. Desplegar en AWS Academy

### 2.1 Crear la infraestructura

**Opción A: script automático.** Abre el Learner Lab, presiona *Start Lab* y abre la terminal *AWS CLI*. Sube la carpeta `infra/aws` y ejecuta:

```bash
export DB_PASSWORD='ClaveSegura2026'          # clave del usuario admin de RDS
export MI_IP="$(curl -s https://checkip.amazonaws.com)/32"   # o la IP pública de tu casa/INACAP
bash crear-infraestructura.sh
```

El script tarda unos 15 minutos, casi todo esperando a RDS. Al final muestra la IP de la app, la IP del nodo IoT y el endpoint de RDS, y los deja guardados en `recursos.env`.

> Si corres el script en la terminal del Learner Lab, `MI_IP` toma la IP del laboratorio y no la tuya. Para conectarte por SSH desde tu PC, usa tu propia IP (búscala en https://checkip.amazonaws.com).

**Opción B: consola web.** Si prefieres hacerlo a mano, crea estos recursos en este orden. Son los mismos que crea el script y los que describe el informe.

1. **VPC** `cofrial-vpc` con CIDR 10.0.0.0/16. Activa *DNS hostnames*.
2. **Subredes:**
   - pública A 10.0.1.0/24 (us-east-1a)
   - pública B 10.0.2.0/24 (us-east-1b)
   - privada A 10.0.11.0/24 (us-east-1a)
   - privada B 10.0.12.0/24 (us-east-1b)

   En las dos públicas activa *Auto-assign public IPv4*.
3. **Internet Gateway** asociado a la VPC. Crea una tabla de rutas con `0.0.0.0/0 → IGW` y asóciala solo a las subredes públicas.
4. **Security Groups:**
   - `sg-web`: 80 y 443 desde 0.0.0.0/0; 22 desde tu IP; 80 desde `sg-iot`.
   - `sg-iot`: 22 desde tu IP.
   - `sg-rds`: 3306 desde `sg-web`.
5. **RDS:**
   - Crea un *DB subnet group* con las dos subredes privadas.
   - Crea la base: MySQL 8.0, plantilla *Free tier/Dev*, `db.t3.micro`, 20 GB, usuario `admin`, nombre inicial de base `cofrial`.
   - En la configuración: *Public access = No*, SG `sg-rds`, backups de 7 días y cifrado activado.
6. **EC2 App:**
   - Ubuntu 24.04, `t3.small`, llave `vockey`, subred pública A, SG `sg-web`.
   - En *Advanced network*, IP privada `10.0.1.10`.
   - Asóciale una **Elastic IP**.
7. **EC2 IoT:** Ubuntu 24.04, `t3.micro`, llave `vockey`, subred pública B, SG `sg-iot`.

### 2.2 Instalar la aplicación (EC2 App)

Descarga `labsuser.pem` desde *AWS Details* en el Learner Lab. Luego, desde tu PC:

```bash
chmod 400 labsuser.pem
scp -i labsuser.pem -r cofrial ubuntu@IP_APP:~
ssh -i labsuser.pem ubuntu@IP_APP
```

Dentro de la EC2:

```bash
cd ~/cofrial
bash infra/scripts/setup-app.sh           # 1ª vez: instala todo y crea app/.env
nano app/.env                             # DB_HOST = endpoint de RDS, DB_PASSWORD, JWT_SECRET, IOT_SECRET, GEMINI_API_KEY
cd app && npm run db:init && cd ..        # crea las tablas en RDS y carga los datos de prueba
bash infra/scripts/setup-app.sh           # 2ª vez: levanta PM2 + Nginx
```

Abre `http://IP_APP` en el navegador.

### 2.3 Levantar los camiones IoT (EC2 IoT)

```bash
scp -i labsuser.pem -r cofrial/iot cofrial/infra ubuntu@IP_IOT:~/cofrial/
ssh -i labsuser.pem ubuntu@IP_IOT
cd ~/cofrial
bash infra/scripts/setup-iot.sh           # 1ª vez: instala Docker y crea iot/.env
nano iot/.env                             # API_URL=http://10.0.1.10/api/telemetria ; IOT_SECRET igual al de la app
bash infra/scripts/setup-iot.sh           # 2ª vez: construye y levanta los 5 contenedores
sudo docker compose -f iot/docker-compose.yml logs -f   # ver la telemetría en vivo
```

> Si `scp` no crea la carpeta destino, primero ejecuta `ssh ... mkdir -p cofrial`.

### 2.4 Activar la IA (gratis)

1. Crea una clave en https://aistudio.google.com/apikey con tu cuenta de Google.
2. Pégala en `GEMINI_API_KEY` dentro de `app/.env`.
3. Reinicia el backend con `pm2 restart cofrial`.

Para comprobarlo, `curl http://localhost/api/salud` debe mostrar `"ia":"gemini"`. Sin clave, el sistema sigue funcionando con el clasificador por reglas.

### 2.5 Al terminar cada sesión del Learner Lab

AWS Academy apaga las instancias cuando termina la sesión. Al volver a abrirla, todo se levanta solo:

- PM2 vuelve a iniciar el backend.
- Docker reinicia los contenedores.
- La IP elástica mantiene la misma URL.

Solo debes esperar que RDS esté en estado *Available*.

---

## 3. Guion para la defensa en vivo (≈10 minutos)

1. **Arquitectura (1 min):** muestra en la consola de AWS la VPC, las 2 EC2 y el RDS. Abre el SG de RDS para mostrar que solo acepta conexiones desde `sg-web`.
2. **E-commerce B2C (2 min):**
   - Abre la tienda sin sesión y agrega productos al carrito.
   - Inicia sesión como `maria.gonzalez@correo.cl` y confirma la orden.
   - Muestra la orden en *Mis pedidos*.
3. **E-commerce B2B (1 min):**
   - Cierra sesión y entra como `compras@hospitalsur.cl`.
   - Muestra el precio de convenio, con el precio de lista tachado.
   - Haz un pedido por volumen.
4. **CRM (2 min):**
   - Entra como `vendedor@cofrial.cl`.
   - En **Pedidos**, confirma las órdenes recién creadas y pásalas a preparación.
   - En **Pipeline**, arrastra una oportunidad a *Ganado*.
   - Crea un prospecto nuevo y regístrale una llamada.
5. **IA (1 min):**
   - En la tienda, envía este mensaje desde *Contáctanos*: *"El pedido llegó descongelado y es para pacientes, necesito reposición urgente"*.
   - La IA lo clasifica como RECLAMO con prioridad ALTA.
   - Muéstralo en **Requerimientos IA** del CRM.
   - Prueba también el asistente 💬 preguntando "¿cuánto cuesta el salmón?".
6. **IoT + despacho (2 min):**
   - En la EC2 IoT, muestra `docker compose ps` y los logs.
   - Como `despacho@cofrial.cl`, en **Despachos**, asigna los pedidos en preparación a un camión libre (por ejemplo, CAM-006) y luego márcalo *Entregado*. El cliente verá el cambio en *Mis pedidos*.
   - Los camiones CAM-001 a CAM-005 ya están en ruta con pedidos de prueba y son los que envían telemetría.
7. **Dashboard (1 min):**
   - Muestra los KPIs, el mapa con los camiones moviéndose y la temperatura en vivo.
   - Muestra la tabla **Pedidos en riesgo**, que cruza la venta con la ruptura de frío del camión que la transporta.
   - Para forzar una falla en vivo:

     ```bash
     sudo docker compose -f iot/docker-compose.yml stop cam-002
     sudo docker run --rm --network host -e CAMION_ID=CAM-002 -e PERFIL=CONGELADO -e RUTA=angol \
       -e API_URL=http://10.0.1.10/api/telemetria -e IOT_SECRET=<tu secreto> -e PROB_FALLA=1 cofrial-sensor:1.0
     ```

     Detenlo con Ctrl+C y vuelve a levantar `cam-002` con `docker compose ... start cam-002`.

## 4. API de telemetría

```http
POST /api/telemetria
X-Device-Token: HMAC-SHA256(IOT_SECRET, camion_id)
Content-Type: application/json

{ "camion_id": "CAM-001", "temp_camara": -17.85, "lat": -38.7397, "long": -72.5984,
  "combustible_pct": 82, "alerta_ruptura_frio": false }
```

La API vuelve a calcular `alerta_ruptura_frio` con el rango del perfil de frío del despacho en curso (congelado de −25 a −15 °C, refrigerado de 0 a 5 °C). Para ver el token de un camión: `npm run token -- CAM-001`.
