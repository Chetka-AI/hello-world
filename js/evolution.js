/*
 * Trainer — neuroewolucja populacji sieci neuronowych.
 * Cała populacja żyje w jednym świecie i rywalizuje o ten sam pokarm.
 * Po każdym pokoleniu następuje selekcja, krzyżowanie i mutacja.
 */
(function (global) {
  'use strict';

  const OUTPUTS = 2;

  class Trainer {
    constructor(config) {
      this.cfg = config;
      this.rng = new RNG(config.seed);

      // świat tworzymy najpierw — definiuje liczbę wejść sieci (sensory)
      this.world = new World(config, this.rng);
      this.recurrent = !!config.recurrent;

      // budowa układu warstw: [liczba_sensorów, hidden..., 2]
      this.layout = [this.world.inputSize];
      for (let i = 0; i < config.hiddenLayers; i++) this.layout.push(config.hiddenSize);
      this.layout.push(OUTPUTS);

      this.population = [];
      for (let i = 0; i < config.population; i++) {
        this.population.push(new NeuralNet(this.layout, config.activation, this.recurrent).randomize(this.rng));
      }

      this.gen = 1;
      this.done = false;
      this.history = [];      // statystyki na pokolenie
      this.bestEver = { fitness: -Infinity, genome: null, gen: 0 };

      this.world.reset(this.population);
    }

    // jeden krok bieżącego pokolenia
    tick() { return this.world.tick(); }

    generationOver() {
      return this.world.step >= this.cfg.steps || this.world.aliveCount() === 0;
    }

    // zbierz wyniki, zapisz historię i przygotuj kolejne pokolenie.
    // zwraca true, gdy cały trening dobiegł końca.
    finishGeneration() {
      const cells = this.world.cells;
      const fitness = cells.map((c) => this.world.fitnessOf(c));

      let best = -Infinity, worst = Infinity, sum = 0, totalFood = 0, bestIdx = 0;
      for (let i = 0; i < fitness.length; i++) {
        const f = fitness[i];
        sum += f;
        totalFood += cells[i].foodEaten;
        if (f > best) { best = f; bestIdx = i; }
        if (f < worst) worst = f;
      }
      const avg = sum / fitness.length;
      const diversity = this._diversity();

      this.history.push({
        gen: this.gen,
        best: round2(best),
        avg: round2(avg),
        worst: round2(worst),
        totalFood,
        diversity: round3(diversity),
      });

      if (best > this.bestEver.fitness) {
        this.bestEver = { fitness: best, genome: this.population[bestIdx].genome.slice(), gen: this.gen };
      }

      if (this.gen >= this.cfg.generations) {
        this.done = true;
        return true;
      }

      this.population = this._evolve(fitness);
      this.gen++;
      this.world.reset(this.population);
      return false;
    }

    // ---- operacje genetyczne ----
    _evolve(fitness) {
      const cfg = this.cfg;
      const popSize = this.population.length;
      const ranked = this.population
        .map((net, i) => ({ net, f: fitness[i] }))
        .sort((a, b) => b.f - a.f);

      const next = [];
      const eliteCount = Math.max(1, Math.floor(popSize * cfg.elitism));
      for (let i = 0; i < eliteCount && i < ranked.length; i++) {
        next.push(ranked[i].net.clone()); // elita przechodzi bez zmian
      }

      while (next.length < popSize) {
        const a = this._tournament(ranked);
        const b = this._tournament(ranked);
        const child = this._crossover(a, b);
        this._mutate(child);
        next.push(child);
      }
      return next;
    }

    _tournament(ranked, k = 3) {
      let best = null;
      for (let i = 0; i < k; i++) {
        const pick = ranked[this.rng.int(ranked.length)];
        if (!best || pick.f > best.f) best = pick;
      }
      return best.net;
    }

    _crossover(a, b) {
      const child = new NeuralNet(this.layout, this.cfg.activation, this.recurrent);
      const ga = a.genome, gb = b.genome, gc = child.genome;
      for (let i = 0; i < gc.length; i++) {
        gc[i] = this.rng.next() < 0.5 ? ga[i] : gb[i];
      }
      return child;
    }

    _mutate(net) {
      const g = net.genome;
      const rate = this.cfg.mutRate;
      const strength = this.cfg.mutStrength;
      for (let i = 0; i < g.length; i++) {
        if (this.rng.next() < rate) g[i] += this.rng.gauss() * strength;
      }
    }

    // średnie odchylenie standardowe genomów (miara różnorodności)
    _diversity() {
      const pop = this.population;
      const n = pop.length;
      if (n === 0) return 0;
      const len = pop[0].genome.length;
      let acc = 0;
      for (let d = 0; d < len; d++) {
        let mean = 0;
        for (let i = 0; i < n; i++) mean += pop[i].genome[d];
        mean /= n;
        let varr = 0;
        for (let i = 0; i < n; i++) { const x = pop[i].genome[d] - mean; varr += x * x; }
        acc += Math.sqrt(varr / n);
      }
      return acc / len;
    }
  }

  function round2(x) { return Math.round(x * 100) / 100; }
  function round3(x) { return Math.round(x * 1000) / 1000; }

  global.Trainer = Trainer;
})(window);
