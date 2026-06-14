/*
 * Warstwa UI: panel sterowania, przełączanie widoków, renderowanie świata
 * na canvasie oraz prezentacja analizy z wykresami.
 */
(function (global) {
  'use strict';

  // mapowanie suwaków -> pola konfiguracji (+ formatowanie etykiety)
  const PARAMS = [
    { id: 'hiddenLayers', fmt: (v) => v },
    { id: 'hiddenSize', fmt: (v) => v },
    { id: 'population', fmt: (v) => v },
    { id: 'generations', fmt: (v) => v },
    { id: 'steps', fmt: (v) => v },
    { id: 'mutRate', fmt: (v) => Number(v).toFixed(2) },
    { id: 'mutStrength', fmt: (v) => Number(v).toFixed(2) },
    { id: 'elitism', fmt: (v) => Number(v).toFixed(2) },
    { id: 'worldSize', fmt: (v) => v },
    { id: 'foodCount', fmt: (v) => v },
    { id: 'foodRegen', fmt: (v) => v },
    { id: 'speed', fmt: (v) => v + '×' },
  ];

  function $(id) { return document.getElementById(id); }

  function bindControls() {
    for (const p of PARAMS) {
      const input = $('p-' + p.id);
      const out = $('o-' + p.id);
      if (!input || !out) continue;
      const update = () => { out.textContent = p.fmt(input.value); };
      input.addEventListener('input', update);
      update();
    }
  }

  function readConfig() {
    const num = (id) => Number($('p-' + id).value);
    return {
      hiddenLayers: num('hiddenLayers'),
      hiddenSize: num('hiddenSize'),
      activation: $('p-activation').value,
      population: num('population'),
      generations: num('generations'),
      steps: num('steps'),
      mutRate: num('mutRate'),
      mutStrength: num('mutStrength'),
      elitism: num('elitism'),
      worldSize: num('worldSize'),
      foodCount: num('foodCount'),
      foodRegen: num('foodRegen'),
      seed: num('seed'),
    };
  }

  function switchView(name) {
    document.querySelectorAll('.tab').forEach((t) =>
      t.classList.toggle('is-active', t.dataset.view === name));
    document.querySelectorAll('.view').forEach((v) =>
      v.classList.toggle('is-active', v.dataset.view === name));
  }

  // ---------- Renderowanie świata ----------
  class WorldRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.displaySize = 0;
    }

    _fit(worldSize) {
      const wrap = this.canvas.parentElement;
      const avail = Math.min(wrap.clientWidth - 16, wrap.clientHeight - 16);
      const size = Math.max(120, Math.floor(avail));
      if (size === this.displaySize) return;
      this.displaySize = size;
      const dpr = global.devicePixelRatio || 1;
      this.canvas.style.width = size + 'px';
      this.canvas.style.height = size + 'px';
      this.canvas.width = Math.floor(size * dpr);
      this.canvas.height = Math.floor(size * dpr);
      this.dpr = dpr;
    }

    render(world) {
      this._fit(world.size);
      const ctx = this.ctx;
      const scale = (this.displaySize / world.size) * this.dpr;
      const px = this.canvas.width;

      ctx.clearRect(0, 0, px, px);

      // pokarm
      for (const f of world.foods) {
        const x = f.x * scale, y = f.y * scale;
        if (f.available) {
          ctx.fillStyle = '#36d399';
          ctx.beginPath();
          ctx.arc(x, y, World.CONST.foodRadius * scale, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // miejsce regeneracji — przygaszony pierścień
          ctx.strokeStyle = 'rgba(54,211,153,0.25)';
          ctx.lineWidth = 1 * this.dpr;
          ctx.beginPath();
          ctx.arc(x, y, World.CONST.foodRadius * scale, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // komórki
      const r = World.CONST.cellRadius * scale;
      for (const c of world.cells) {
        if (!c.alive) continue;
        const x = c.x * scale, y = c.y * scale;
        const e = c.energy / World.CONST.maxEnergy; // 0..1
        const hue = 0 + e * 130; // czerwony (głód) -> zielony (syty)
        ctx.fillStyle = `hsl(${hue}, 75%, 55%)`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        // wskaźnik kierunku
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 1 * this.dpr;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(c.heading) * r * 1.8, y + Math.sin(c.heading) * r * 1.8);
        ctx.stroke();
      }
    }
  }

  // ---------- Statystyki na żywo ----------
  function renderStats(trainer) {
    const last = trainer.history[trainer.history.length - 1];
    $('s-gen').textContent = trainer.gen;
    $('s-step').textContent = trainer.world.step;
    $('s-alive').textContent = trainer.world.aliveCount();
    $('s-best').textContent = last ? last.best : Math.round(trainer.bestEver.fitness > 0 ? trainer.bestEver.fitness : 0);
  }

  function setProgress(trainer) {
    const total = trainer.cfg.generations * trainer.cfg.steps;
    const cur = (trainer.gen - 1) * trainer.cfg.steps + trainer.world.step;
    $('train-progress').value = Math.min(1, cur / total);
  }

  // ---------- Analiza ----------
  function renderAnalysis(trainer) {
    const h = trainer.history;
    if (!h.length) return;
    $('analysis-empty').classList.add('hidden');
    $('analysis-content').classList.remove('hidden');

    const xs = h.map((d) => d.gen);
    const bestArr = h.map((d) => d.best);
    const avgArr = h.map((d) => d.avg);
    const worstArr = h.map((d) => d.worst);
    const foodArr = h.map((d) => d.totalFood);
    const divArr = h.map((d) => d.diversity);

    // karty podsumowania
    const finalBest = bestArr[bestArr.length - 1];
    const startAvg = avgArr[0];
    const finalAvg = avgArr[avgArr.length - 1];
    const improvement = startAvg !== 0 ? ((finalAvg - startAvg) / Math.abs(startAvg) * 100) : finalAvg * 100;
    const summary = [
      { val: trainer.bestEver.fitness.toFixed(1), key: 'najlepszy fitness (pok. ' + trainer.bestEver.gen + ')' },
      { val: finalBest.toFixed(1), key: 'best ostatniego pok.' },
      { val: finalAvg.toFixed(1), key: 'średni ostatniego pok.' },
      { val: (improvement >= 0 ? '+' : '') + improvement.toFixed(0) + '%', key: 'wzrost średniej' },
    ];
    $('summary-grid').innerHTML = summary.map((s) =>
      `<div class="summary-card"><div class="sc-val">${s.val}</div><div class="sc-key">${s.key}</div></div>`
    ).join('');

    Charts.lineChart($('chart-fitness'), xs, [
      { data: worstArr, color: '#ff9f43', width: 1.5 },
      { data: avgArr, color: '#4f9cff', width: 2 },
      { data: bestArr, color: '#36d399', width: 2.5 },
    ]);
    Charts.lineChart($('chart-food'), xs, [{ data: foodArr, color: '#4f9cff', width: 2 }]);
    Charts.lineChart($('chart-diversity'), xs, [{ data: divArr, color: '#ff9f43', width: 2 }]);
  }

  global.UI = {
    $, bindControls, readConfig, switchView,
    WorldRenderer, renderStats, setProgress, renderAnalysis,
  };
})(window);
