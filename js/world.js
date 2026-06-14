/*
 * Świat symulacji: toroidalna mapa, pokarm w stałych miejscach (regeneruje się
 * tam, gdzie został zjedzony) oraz komórki sterowane sieciami neuronowymi.
 *
 * Sensory komórki (5 wejść sieci):
 *   0: bliskość najbliższego pokarmu (0..1)
 *   1: sin(kąt do pokarmu względem kierunku ruchu)
 *   2: cos(kąt do pokarmu względem kierunku ruchu)
 *   3: poziom energii (0..1)
 *   4: stała = 1 (dodatkowy bias wejściowy)
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
    sensorRange: 130,
  };

  class World {
    constructor(config, rng) {
      this.cfg = config;
      this.rng = rng;
      this.size = config.worldSize;
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

    // Nowe pokolenie: ustaw komórki z podanych mózgów, odśwież pokarm.
    reset(brains) {
      this.step = 0;
      for (const f of this.foods) { f.available = true; f.timer = 0; }
      this.cells = brains.map((brain) => ({
        brain,
        x: this.rng.range(0, this.size),
        y: this.rng.range(0, this.size),
        heading: this.rng.range(0, Math.PI * 2),
        energy: C.startEnergy,
        alive: true,
        foodEaten: 0,
        age: 0,
      }));
      return this;
    }

    aliveCount() {
      let n = 0;
      for (const c of this.cells) if (c.alive) n++;
      return n;
    }

    // Najbliższy dostępny pokarm dla danej komórki.
    _nearestFood(cell) {
      let best = null, bestD = Infinity;
      for (const f of this.foods) {
        if (!f.available) continue;
        const dx = f.x - cell.x;
        const dy = f.y - cell.y;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = f; }
      }
      return best ? { food: best, dist: Math.sqrt(bestD) } : null;
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

        // --- sensory ---
        const near = this._nearestFood(cell);
        let closeness = 0, relSin = 0, relCos = 0;
        if (near) {
          closeness = Math.max(0, 1 - near.dist / C.sensorRange);
          const angTo = Math.atan2(near.food.y - cell.y, near.food.x - cell.x);
          let rel = angTo - cell.heading;
          // normalizacja do -PI..PI
          while (rel > Math.PI) rel -= Math.PI * 2;
          while (rel < -Math.PI) rel += Math.PI * 2;
          relSin = Math.sin(rel);
          relCos = Math.cos(rel);
        }
        const energyN = cell.energy / C.maxEnergy;

        // --- decyzja sieci ---
        const out = cell.brain.forward([closeness, relSin, relCos, energyN, 1]);
        const turn = out[0] * C.maxTurn;
        const speed = Math.max(0, out[1]) * C.maxSpeed; // tylko ruch naprzód

        // --- ruch (mapa toroidalna) ---
        cell.heading += turn;
        cell.x = (cell.x + Math.cos(cell.heading) * speed + size) % size;
        cell.y = (cell.y + Math.sin(cell.heading) * speed + size) % size;

        // --- jedzenie ---
        if (near && near.dist <= eatDist) {
          // szybkie potwierdzenie po faktycznym ruchu
          const f = near.food;
          const dx = f.x - cell.x, dy = f.y - cell.y;
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
