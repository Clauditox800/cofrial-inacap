-- =====================================================================
-- Cofrial SpA - Modelo relacional en 3NF
-- Motor: MySQL 8.0 (Amazon RDS)
-- Dominios: Comercial (E-commerce), CRM, Logística + IoT
-- =====================================================================

CREATE DATABASE IF NOT EXISTS cofrial
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE cofrial;

SET FOREIGN_KEY_CHECKS = 0;
DROP VIEW IF EXISTS v_pedido_total;
DROP TABLE IF EXISTS lectura_telemetria, despacho_pedido, despacho, conductor, camion,
  requerimiento, interaccion, oportunidad, etapa_pipeline,
  historial_pedido, detalle_pedido, pedido, precio_especial, lista_precio,
  producto, categoria, perfil_frio, direccion, comuna, region,
  usuario, cliente, rol;
SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------------
-- Seguridad y clientes
-- ---------------------------------------------------------------------
CREATE TABLE rol (
  id_rol      TINYINT UNSIGNED PRIMARY KEY,
  nombre      VARCHAR(30) NOT NULL UNIQUE          -- ADMIN, VENDEDOR, DESPACHADOR, CLIENTE_B2B, CLIENTE_B2C
);

CREATE TABLE lista_precio (
  id_lista_precio INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre          VARCHAR(60) NOT NULL UNIQUE,
  descuento_pct   DECIMAL(5,2) NOT NULL DEFAULT 0  -- descuento general del convenio
);

CREATE TABLE cliente (
  id_cliente      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  segmento        ENUM('B2B','B2C') NOT NULL,
  rut             VARCHAR(12) NOT NULL UNIQUE,
  nombre          VARCHAR(120) NOT NULL,          -- razón social (B2B) o nombre completo (B2C)
  email           VARCHAR(120) NOT NULL,
  telefono        VARCHAR(20),
  es_prospecto    BOOLEAN NOT NULL DEFAULT FALSE,
  id_lista_precio INT UNSIGNED NULL,
  id_vendedor     INT UNSIGNED NULL,              -- FK a usuario (se agrega más abajo)
  creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cliente_lista FOREIGN KEY (id_lista_precio) REFERENCES lista_precio(id_lista_precio)
);

CREATE TABLE usuario (
  id_usuario    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email         VARCHAR(120) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  nombre        VARCHAR(100) NOT NULL,
  id_rol        TINYINT UNSIGNED NOT NULL,
  id_cliente    INT UNSIGNED NULL,                -- solo para usuarios cliente
  activo        BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_usuario_rol     FOREIGN KEY (id_rol)     REFERENCES rol(id_rol),
  CONSTRAINT fk_usuario_cliente FOREIGN KEY (id_cliente) REFERENCES cliente(id_cliente)
);

ALTER TABLE cliente
  ADD CONSTRAINT fk_cliente_vendedor FOREIGN KEY (id_vendedor) REFERENCES usuario(id_usuario);

CREATE TABLE region (
  id_region TINYINT UNSIGNED PRIMARY KEY,
  nombre    VARCHAR(60) NOT NULL UNIQUE
);

CREATE TABLE comuna (
  id_comuna SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre    VARCHAR(60) NOT NULL,
  id_region TINYINT UNSIGNED NOT NULL,
  UNIQUE (nombre, id_region),
  CONSTRAINT fk_comuna_region FOREIGN KEY (id_region) REFERENCES region(id_region)
);

CREATE TABLE direccion (
  id_direccion INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_cliente   INT UNSIGNED NOT NULL,
  calle        VARCHAR(120) NOT NULL,
  numero       VARCHAR(10) NOT NULL,
  id_comuna    SMALLINT UNSIGNED NOT NULL,
  lat          DECIMAL(9,6),
  lng          DECIMAL(9,6),
  CONSTRAINT fk_direccion_cliente FOREIGN KEY (id_cliente) REFERENCES cliente(id_cliente) ON DELETE CASCADE,
  CONSTRAINT fk_direccion_comuna  FOREIGN KEY (id_comuna)  REFERENCES comuna(id_comuna)
);

-- ---------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------
CREATE TABLE perfil_frio (
  id_perfil_frio TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre         VARCHAR(40) NOT NULL UNIQUE,     -- CONGELADO, REFRIGERADO
  temp_min       DECIMAL(5,2) NOT NULL,
  temp_max       DECIMAL(5,2) NOT NULL,
  CHECK (temp_min < temp_max)
);

CREATE TABLE categoria (
  id_categoria   SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre         VARCHAR(60) NOT NULL UNIQUE,
  id_perfil_frio TINYINT UNSIGNED NOT NULL,
  CONSTRAINT fk_categoria_perfil FOREIGN KEY (id_perfil_frio) REFERENCES perfil_frio(id_perfil_frio)
);

CREATE TABLE producto (
  id_producto  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sku          VARCHAR(20) NOT NULL UNIQUE,
  nombre       VARCHAR(120) NOT NULL,
  descripcion  VARCHAR(500),
  unidad       VARCHAR(10) NOT NULL DEFAULT 'kg',
  precio_lista INT UNSIGNED NOT NULL,             -- CLP por unidad, IVA incluido
  stock        INT UNSIGNED NOT NULL DEFAULT 0,
  imagen_url   VARCHAR(255),
  id_categoria SMALLINT UNSIGNED NOT NULL,
  activo       BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT fk_producto_categoria FOREIGN KEY (id_categoria) REFERENCES categoria(id_categoria)
);

CREATE TABLE precio_especial (
  id_lista_precio INT UNSIGNED NOT NULL,
  id_producto     INT UNSIGNED NOT NULL,
  precio          INT UNSIGNED NOT NULL,
  PRIMARY KEY (id_lista_precio, id_producto),
  CONSTRAINT fk_pe_lista    FOREIGN KEY (id_lista_precio) REFERENCES lista_precio(id_lista_precio) ON DELETE CASCADE,
  CONSTRAINT fk_pe_producto FOREIGN KEY (id_producto)     REFERENCES producto(id_producto) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------
-- Pedidos (E-commerce)
-- ---------------------------------------------------------------------
CREATE TABLE pedido (
  id_pedido    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_cliente   INT UNSIGNED NOT NULL,
  id_direccion INT UNSIGNED NOT NULL,
  canal        ENUM('WEB','CRM') NOT NULL DEFAULT 'WEB',
  estado       ENUM('PENDIENTE','CONFIRMADO','EN_PREPARACION','DESPACHADO','ENTREGADO','CANCELADO')
               NOT NULL DEFAULT 'PENDIENTE',
  fecha        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  observacion  VARCHAR(300),
  INDEX ix_pedido_fecha (fecha),
  CONSTRAINT fk_pedido_cliente   FOREIGN KEY (id_cliente)   REFERENCES cliente(id_cliente),
  CONSTRAINT fk_pedido_direccion FOREIGN KEY (id_direccion) REFERENCES direccion(id_direccion)
);

CREATE TABLE detalle_pedido (
  id_pedido       INT UNSIGNED NOT NULL,
  id_producto     INT UNSIGNED NOT NULL,
  cantidad        INT UNSIGNED NOT NULL CHECK (cantidad > 0),
  precio_unitario INT UNSIGNED NOT NULL,          -- precio congelado al momento de la compra
  PRIMARY KEY (id_pedido, id_producto),
  CONSTRAINT fk_detalle_pedido   FOREIGN KEY (id_pedido)   REFERENCES pedido(id_pedido) ON DELETE CASCADE,
  CONSTRAINT fk_detalle_producto FOREIGN KEY (id_producto) REFERENCES producto(id_producto)
);

CREATE TABLE historial_pedido (
  id_historial INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_pedido    INT UNSIGNED NOT NULL,
  estado       VARCHAR(20) NOT NULL,
  fecha        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  id_usuario   INT UNSIGNED NULL,
  comentario   VARCHAR(300),
  CONSTRAINT fk_hist_pedido  FOREIGN KEY (id_pedido)  REFERENCES pedido(id_pedido) ON DELETE CASCADE,
  CONSTRAINT fk_hist_usuario FOREIGN KEY (id_usuario) REFERENCES usuario(id_usuario)
);

-- El total no se almacena (sería un dato derivado): se calcula con esta vista.
CREATE VIEW v_pedido_total AS
  SELECT p.id_pedido, p.id_cliente, p.canal, p.estado, p.fecha, c.segmento,
         SUM(d.cantidad * d.precio_unitario) AS total
  FROM pedido p
  JOIN cliente c        ON c.id_cliente = p.id_cliente
  JOIN detalle_pedido d ON d.id_pedido  = p.id_pedido
  GROUP BY p.id_pedido, p.id_cliente, p.canal, p.estado, p.fecha, c.segmento;

-- ---------------------------------------------------------------------
-- CRM
-- ---------------------------------------------------------------------
CREATE TABLE etapa_pipeline (
  id_etapa TINYINT UNSIGNED PRIMARY KEY,
  nombre   VARCHAR(40) NOT NULL UNIQUE,
  orden    TINYINT UNSIGNED NOT NULL,
  es_cierre BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE oportunidad (
  id_oportunidad INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_cliente     INT UNSIGNED NOT NULL,
  id_vendedor    INT UNSIGNED NOT NULL,
  id_etapa       TINYINT UNSIGNED NOT NULL,
  titulo         VARCHAR(120) NOT NULL,
  monto_estimado INT UNSIGNED NOT NULL DEFAULT 0,
  fecha_creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_cierre   DATE NULL,
  CONSTRAINT fk_op_cliente  FOREIGN KEY (id_cliente)  REFERENCES cliente(id_cliente) ON DELETE CASCADE,
  CONSTRAINT fk_op_vendedor FOREIGN KEY (id_vendedor) REFERENCES usuario(id_usuario),
  CONSTRAINT fk_op_etapa    FOREIGN KEY (id_etapa)    REFERENCES etapa_pipeline(id_etapa)
);

CREATE TABLE interaccion (
  id_interaccion INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_cliente     INT UNSIGNED NOT NULL,
  id_usuario     INT UNSIGNED NOT NULL,
  tipo           ENUM('LLAMADA','CORREO','REUNION','VISITA','NOTA') NOT NULL,
  descripcion    VARCHAR(500) NOT NULL,
  fecha          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_int_cliente FOREIGN KEY (id_cliente) REFERENCES cliente(id_cliente) ON DELETE CASCADE,
  CONSTRAINT fk_int_usuario FOREIGN KEY (id_usuario) REFERENCES usuario(id_usuario)
);

CREATE TABLE requerimiento (
  id_requerimiento   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_cliente         INT UNSIGNED NULL,
  nombre_contacto    VARCHAR(100) NOT NULL,
  email_contacto     VARCHAR(120) NOT NULL,
  mensaje            VARCHAR(1000) NOT NULL,
  categoria_ia       ENUM('PEDIDO','RECLAMO','COTIZACION','CONSULTA','OTRO') NOT NULL DEFAULT 'OTRO',
  prioridad_ia       ENUM('ALTA','MEDIA','BAJA') NOT NULL DEFAULT 'MEDIA',
  respuesta_sugerida VARCHAR(1000),
  motor_ia           VARCHAR(30),                 -- 'gemini' o 'reglas'
  estado             ENUM('ABIERTO','EN_GESTION','CERRADO') NOT NULL DEFAULT 'ABIERTO',
  fecha              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_req_cliente FOREIGN KEY (id_cliente) REFERENCES cliente(id_cliente) ON DELETE SET NULL
);

-- ---------------------------------------------------------------------
-- Logística e IoT
-- ---------------------------------------------------------------------
CREATE TABLE camion (
  id_camion    SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  codigo       VARCHAR(10) NOT NULL UNIQUE,       -- camion_id del dispositivo IoT (ej. CAM-001)
  patente      VARCHAR(8) NOT NULL UNIQUE,
  capacidad_kg INT UNSIGNED NOT NULL,
  activo       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE conductor (
  id_conductor SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  rut          VARCHAR(12) NOT NULL UNIQUE,
  nombre       VARCHAR(100) NOT NULL,
  telefono     VARCHAR(20)
);

CREATE TABLE despacho (
  id_despacho    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_camion      SMALLINT UNSIGNED NOT NULL,
  id_conductor   SMALLINT UNSIGNED NOT NULL,
  id_perfil_frio TINYINT UNSIGNED NOT NULL,       -- rango de temperatura que debe mantener la carga
  estado         ENUM('PROGRAMADO','EN_RUTA','FINALIZADO') NOT NULL DEFAULT 'PROGRAMADO',
  fecha_salida   DATETIME NULL,
  fecha_llegada  DATETIME NULL,
  CONSTRAINT fk_desp_camion    FOREIGN KEY (id_camion)      REFERENCES camion(id_camion),
  CONSTRAINT fk_desp_conductor FOREIGN KEY (id_conductor)   REFERENCES conductor(id_conductor),
  CONSTRAINT fk_desp_perfil    FOREIGN KEY (id_perfil_frio) REFERENCES perfil_frio(id_perfil_frio)
);

CREATE TABLE despacho_pedido (
  id_despacho INT UNSIGNED NOT NULL,
  id_pedido   INT UNSIGNED NOT NULL,
  PRIMARY KEY (id_despacho, id_pedido),
  CONSTRAINT fk_dp_despacho FOREIGN KEY (id_despacho) REFERENCES despacho(id_despacho) ON DELETE CASCADE,
  CONSTRAINT fk_dp_pedido   FOREIGN KEY (id_pedido)   REFERENCES pedido(id_pedido)
);

CREATE TABLE lectura_telemetria (
  id_lectura          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_camion           SMALLINT UNSIGNED NOT NULL,
  id_despacho         INT UNSIGNED NULL,
  fecha_hora          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  temp_camara         DECIMAL(5,2) NOT NULL,
  lat                 DECIMAL(9,6) NOT NULL,
  lng                 DECIMAL(9,6) NOT NULL,
  combustible_pct     TINYINT UNSIGNED NOT NULL CHECK (combustible_pct <= 100),
  alerta_ruptura_frio BOOLEAN NOT NULL DEFAULT FALSE,
  INDEX ix_tel_camion_fecha (id_camion, fecha_hora),
  INDEX ix_tel_alerta (alerta_ruptura_frio, fecha_hora),
  CONSTRAINT fk_tel_camion   FOREIGN KEY (id_camion)   REFERENCES camion(id_camion),
  CONSTRAINT fk_tel_despacho FOREIGN KEY (id_despacho) REFERENCES despacho(id_despacho)
);
