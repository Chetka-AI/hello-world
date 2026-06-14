/*
 * Świat symulacji: toroidalna mapa, pokarm w stałych miejscach (regeneruje się
 * tam, gdzie został zjedzony) oraz komórki sterowane sieciami neuronowymi.
 *
 * Wejścia sieci (sensory):
 *   - wzrok kierunkowy (retina): `visionSectors` sektorów w polu widzenia,
 *     każdy zwraca bliskość (0..1) najbliższego pokarmu w danym sektorze,
 *   - poziom energii (0..1),
 *   - własna prędkość (0..1)  [propriocepcja],
 *   - stała = 1 (bias wejściowy).
 *
 * Wyjścia sieci (2):
 *   0: skręt  (-1..1)
 *   1: prędkość (-1..1 -> mapowane na 0..maxSpeed)
 */
(function (global) {
  'use strict';

  // Stałe fizyczne symulacji
  const C = {
    cellRadius: 4,
    foodRadius: 3,
    maxSpeed: 2.4,
    maxTurn: 0.35,
    maxEnergy: 100,
    startEnergy: 70,
    metabolism: 0.10,   // koszt energii za sam krok
    moveCost: 0.06,     // dodatkowy koszt proporcjonalny do prędkości
    foodEnergy: 32,
    sensorRange: 150,
    fov: Math.PI * 1.5, // pole widzenia (270°)
  };

  // najkrótsza różnica na osi toroidalnej (-size/2 .. size/2)
  function wrapDelta(d, size) {
    if (d > size * 0.5) d -= size;
    else if (d < -size * 0.5) d += size;
    return d;
  }
  function normAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  class World {
    constructor(config, rng) {
      this.cfg = config;
      this.rng = rng;
      this.size = config.worldSize;
      this.visionSectors = config.visionSectors;
      // liczba wejść sieci = sektory wzroku + energia + prędkość + bias
      this.inputSize = this.visionSectors + 3;
      this.foods = [];
      this.cells = [];
      this.step = 0;
      this._initFood();
    }

    // Pokarm rozmieszczany RAZ — te same miejsca przez cały trening.
    _initFood() {
      const margin = 12;
      for (let i = 0; i < this.cfg.foodCount; i++) {
        this.foods.push({
          x: this.rng.range(margin, this.size - margin),
          y: this.rng.range(margin, this.size - margin),
          available: true,
          timer: 0,
        });
      }
    }

    // Nowe pokolenie: ustaw komórki z podanych mózgów, odśwież pokarm i pamięć.
    reset(brains) {
      this.step = 0;
      for (const f of this.foods) { f.available = true; f.timer = 0; }
      this.cells = brains.map((brain) => {
        brain.resetState(); // wyzeruj pamięć rekurencyjną
        return {
          brain,
          x: this.rng.range(0, this.size),
          y: this.rng.range(0, this.size),
          heading: this.rng.range(0, Math.PI * 2),
          energy: C.startEnergy,
          speed: 0,
          alive: true,
          foodEaten: 0,
          age: 0,
        };
      });
      return this;
    }

    aliveCount() {
      let n = 0;
      for (const c of this.cells) if (c.alive) n++;
      return n;
    }

    // Najbliższy dostępny pokarm (dystans toroidalny) — do wykrywania jedzenia.
    _nearestFood(cell) {
      const size = this.size;
      let best = null, bestD = Infinity;
      for (const f of this.foods) {
        if (!f.available) continue;
        const dx = wrapDelta(f.x - cell.x, size);
        const dy = wrapDelta(f.y - cell.y, size);
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = f; }
      }
      return best ? { food: best, dist: Math.sqrt(bestD) } : null;
    }

    // Wzrok kierunkowy: bliskość najbliższego pokarmu w każdym sektorze FOV.
    _sense(cell) {
      const size = this.size;
      const sectors = this.visionSectors;
      const half = C.fov / 2;
      const vision = new Array(sectors).fill(0);

      for (const f of this.foods) {
        if (!f.available) continue;
        const dx = wrapDelta(f.x - cell.x, size);
        const dy = wrapDelta(f.y - cell.y, size);
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > C.sensorRange) continue;
        const rel = normAngle(Math.atan2(dy, dx) - cell.heading);
        if (rel < -half || rel > half) continue; // poza polem widzenia
        let idx = Math.floor(((rel + half) / C.fov) * sectors);
        if (idx >= sectors) idx = sectors - 1;
        if (idx < 0) idx = 0;
        const closeness = 1 - dist / C.sensorRange;
        if (closeness > vision[idx]) vision[idx] = closeness;
      }

      // propriocepcja + bias
      vision.push(cell.energy / C.maxEnergy);
      vision.push(cell.speed / C.maxSpeed);
      vision.push(1);
      return vision;
    }

    // Jeden krok symulacji.
    tick() {
      const size = this.size;
      const eatDist = C.cellRadius + C.foodRadius + 2;
      const eatDist2 = eatDist * eatDist;

      // regeneracja pokarmu w tych samych miejscach
      for (const f of this.foods) {
        if (!f.available) {
          if (--f.timer <= 0) f.available = true;
        }
      }

      for (const cell of this.cells) {
        if (!cell.alive) continue;
        cell.age++;

        // --- decyzja sieci na podstawie sensorów ---
        const inputs = this._sense(cell);
        const out = cell.brain.forward(inputs);
        const turn = out[0] * C.maxTurn;
        const speed = Math.max(0, out[1]) * C.maxSpeed; // tylko ruch naprzód
        cell.speed = speed;

        // --- ruch (mapa toroidalna) ---
        cell.heading += turn;
        cell.x = (cell.x + Math.cos(cell.heading) * speed + size) % size;
        cell.y = (cell.y + Math.sin(cell.heading) * speed + size) % size;

        // --- jedzenie (toroidalnie) ---
        const near = this._nearestFood(cell);
        if (near && near.dist <= eatDist) {
          const f = near.food;
          const dx = wrapDelta(f.x - cell.x, size);
          const dy = wrapDelta(f.y - cell.y, size);
          if (dx * dx + dy * dy <= eatDist2 && f.available) {
            f.available = false;
            f.timer = this.cfg.foodRegen;
            cell.energy = Math.min(C.maxEnergy, cell.energy + C.foodEnergy);
            cell.foodEaten++;
          }
        }

        // --- metabolizm ---
        cell.energy -= C.metabolism + speed * C.moveCost;
        if (cell.energy <= 0) { cell.energy = 0; cell.alive = false; }
      }

      this.step++;
      return this.aliveCount();
    }

    // Fitness komórki: zjedzony pokarm + drobny bonus za przeżycie.
    fitnessOf(cell) {
      return cell.foodEaten + cell.age * 0.0005;
    }
  }

  World.CONST = C;
  global.World = World;
})(window);
