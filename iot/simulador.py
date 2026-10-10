"""
Simulador de telemetría de un camión frigorífico de Cofrial SpA.

Cada contenedor Docker representa un camión. Cada INTERVALO segundos envía a la API:
  camion_id (str), temp_camara (float), lat / long (float), combustible_pct (int), alerta_ruptura_frio (bool)

La temperatura sigue el punto de consigna del perfil de frío con ruido. Con cierta probabilidad se
produce una falla (puerta abierta o falla del compresor): la temperatura sube hasta salir de rango
y luego se recupera. Solo usa la biblioteca estándar de Python.
"""
import hashlib
import hmac
import json
import math
import os
import random
import sys
import time
import urllib.error
import urllib.request

CAMION_ID = os.environ.get("CAMION_ID", "CAM-001")
API_URL = os.environ.get("API_URL", "http://localhost:3000/api/telemetria")
IOT_SECRET = os.environ.get("IOT_SECRET", "")
PERFIL = os.environ.get("PERFIL", "CONGELADO").upper()
RUTA = os.environ.get("RUTA", "villarrica").lower()
INTERVALO = float(os.environ.get("INTERVALO", "5"))
PROB_FALLA = float(os.environ.get("PROB_FALLA", "0.02"))  # probabilidad por lectura de iniciar una falla

PERFILES = {
    "CONGELADO": {"consigna": -18.0, "min": -25.0, "max": -15.0},
    "REFRIGERADO": {"consigna": 2.5, "min": 0.0, "max": 5.0},
}

# Rutas reales de reparto desde la planta en Temuco (lat, long).
RUTAS = {
    "villarrica": [(-38.7397, -72.5984), (-38.9050, -72.4500), (-39.0700, -72.3300), (-39.2857, -72.2279)],
    "angol": [(-38.7397, -72.5984), (-38.5297, -72.4363), (-38.2329, -72.3328), (-37.7959, -72.7164)],
    "imperial": [(-38.7397, -72.5984), (-38.7300, -72.7800), (-38.7447, -72.9505), (-38.7111, -73.1647)],
    "pucon": [(-38.7397, -72.5984), (-38.9853, -72.6436), (-39.2857, -72.2279), (-39.2724, -71.9776)],
    "lautaro": [(-38.7397, -72.5984), (-38.6400, -72.5100), (-38.5297, -72.4363), (-38.4500, -72.3800)],
}

TOKEN = hmac.new(IOT_SECRET.encode(), CAMION_ID.encode(), hashlib.sha256).hexdigest()


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {CAMION_ID} {msg}", flush=True)


class Camion:
    def __init__(self):
        self.perfil = PERFILES.get(PERFIL, PERFILES["CONGELADO"])
        self.ruta = RUTAS.get(RUTA, RUTAS["villarrica"])
        self.temp = self.perfil["consigna"] + random.uniform(-1, 1)
        self.combustible = random.uniform(70, 100)
        self.avance = random.uniform(0, 1)  # 0 = planta, 1 = destino
        self.sentido = 1
        self.falla = 0  # lecturas restantes de la falla en curso

    def posicion(self):
        """Interpola la posición sobre la ruta según el avance."""
        tramos = len(self.ruta) - 1
        x = self.avance * tramos
        i = min(int(x), tramos - 1)
        f = x - i
        (la1, lo1), (la2, lo2) = self.ruta[i], self.ruta[i + 1]
        return la1 + (la2 - la1) * f, lo1 + (lo2 - lo1) * f

    def paso(self):
        # Movimiento: ida y vuelta por la ruta.
        self.avance += self.sentido * random.uniform(0.004, 0.01)
        if self.avance >= 1 or self.avance <= 0:
            self.sentido *= -1
            self.avance = min(max(self.avance, 0), 1)
            if self.avance == 0 and self.combustible < 40:
                self.combustible = 100.0  # recarga en la planta
        self.combustible = max(5.0, self.combustible - random.uniform(0.05, 0.2))

        # Temperatura: vuelve a la consigna salvo durante una falla.
        if self.falla == 0 and random.random() < PROB_FALLA:
            self.falla = random.randint(8, 20)
            log("FALLA simulada: puerta abierta / compresor detenido")
        if self.falla > 0:
            self.temp += random.uniform(0.6, 1.4)
            self.falla -= 1
        else:
            self.temp += (self.perfil["consigna"] - self.temp) * 0.25 + random.gauss(0, 0.25)

        lat, lng = self.posicion()
        alerta = not (self.perfil["min"] <= self.temp <= self.perfil["max"])
        return {
            "camion_id": CAMION_ID,
            "temp_camara": round(self.temp, 2),
            "lat": round(lat + random.gauss(0, 0.0005), 6),
            "long": round(lng + random.gauss(0, 0.0005), 6),
            "combustible_pct": int(math.floor(self.combustible)),
            "alerta_ruptura_frio": alerta,
        }


def enviar(lectura):
    req = urllib.request.Request(
        API_URL,
        data=json.dumps(lectura).encode(),
        headers={"Content-Type": "application/json", "X-Device-Token": TOKEN},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read() or b"{}")


def main():
    if not IOT_SECRET:
        log("ERROR: falta IOT_SECRET")
        sys.exit(1)
    camion = Camion()
    log(f"iniciado · perfil {PERFIL} · ruta {RUTA} · cada {INTERVALO}s → {API_URL}")
    espera = INTERVALO
    while True:
        lectura = camion.paso()
        try:
            r = enviar(lectura)
            marca = "ALERTA" if r.get("alerta_ruptura_frio") else "ok"
            log(f"{lectura['temp_camara']:>6.2f} °C · comb {lectura['combustible_pct']:>3}% · {marca}")
            espera = INTERVALO
        except urllib.error.HTTPError as e:
            log(f"API respondió {e.code}: {e.read().decode(errors='ignore')[:200]}")
        except Exception as e:  # red caída: reintento con espera creciente
            espera = min(espera * 2, 60)
            log(f"sin conexión ({e}); reintento en {espera:.0f}s")
        time.sleep(espera)


if __name__ == "__main__":
    main()
