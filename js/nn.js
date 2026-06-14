/*
 * Sieć neuronowa dla agentów ALife.
 *
 * Obsługuje dwa tryby:
 *   - feed-forward (klasyczna),
 *   - rekurencyjna (Elman) — każda warstwa ukryta otrzymuje z powrotem własne
 *     aktywacje z poprzedniego kroku, co daje komórce pamięć krótkotrwałą.
 *
 * Wagi (w tym rekurencyjne) i biasy są spłaszczone do jednego wektora
 * ("genomu"), dzięki czemu neuroewolucja może je krzyżować i mutować.
 *
 * Układ genomu (po kolei dla warstw l = 1..L-1, neuron po neuronie):
 *   [wagi wejściowe (inN)] [wagi rekurencyjne (outN, tylko warstwy ukryte)] [bias]
 */
(function (global) {
  'use strict';

  const ACTIVATIONS = {
    tanh: (x) => Math.tanh(x),
    sigmoid: (x) => 1 / (1 + Math.exp(-x)),
    relu: (x) => (x > 0 ? x : 0),
  };

  class NeuralNet {
    /**
     * @param {number[]} layout      np. [10, 8, 2] — wejścia, ukryte..., wyjścia
     * @param {string}   activation  'tanh' | 'sigmoid' | 'relu'
     * @param {boolean}  recurrent   czy warstwy ukryte mają sprzężenie zwrotne
     */
    constructor(layout, activation = 'tanh', recurrent = false) {
      this.layout = layout.slice();
      this.activation = activation;
      this.recurrent = recurrent;
      this.act = ACTIVATIONS[activation] || ACTIVATIONS.tanh;
      this.genomeSize = NeuralNet.genomeSizeFor(layout, recurrent);
      this.genome = new Float32Array(this.genomeSize);
      this.resetState();
    }

    static genomeSizeFor(layout, recurrent) {
      let n = 0;
      const L = layout.length;
      for (let l = 1; l < L; l++) {
        n += layout[l - 1] * layout[l]; // wagi wejściowe
        n += layout[l];                 // biasy
        const isHidden = l < L - 1;
        if (recurrent && isHidden) n += layout[l] * layout[l]; // wagi rekurencyjne
      }
      return n;
    }

    // zerowanie pamięci (wywoływane na początku każdego pokolenia)
    resetState() {
      this.state = [];
      for (let l = 1; l < this.layout.length - 1; l++) {
        this.state.push(new Float32Array(this.layout[l]));
      }
      return this;
    }

    // inicjalizacja w skali Xaviera — łagodny start dla ewolucji
    randomize(rng) {
      const g = this.genome;
      const L = this.layout.length;
      let ptr = 0;
      for (let l = 1; l < L; l++) {
        const inN = this.layout[l - 1];
        const outN = this.layout[l];
        const isHidden = l < L - 1;
        const rec = this.recurrent && isHidden;
        const fanIn = inN + (rec ? outN : 0);
        const scale = Math.sqrt(1 / fanIn);
        for (let o = 0; o < outN; o++) {
          for (let i = 0; i < inN; i++) g[ptr++] = rng.gauss() * scale;
          if (rec) for (let i = 0; i < outN; i++) g[ptr++] = rng.gauss() * scale * 0.5;
          g[ptr++] = 0; // bias startowy = 0
        }
      }
      return this;
    }

    setGenome(arr) {
      this.genome = arr instanceof Float32Array ? arr : Float32Array.from(arr);
      return this;
    }

    /**
     * Propagacja w przód (jeden krok czasu).
     * @param {number[]|Float32Array} inputs
     * @returns {number[]} wyjścia (warstwa wyjściowa zawsze tanh -> -1..1)
     */
    forward(inputs) {
      const g = this.genome;
      const layout = this.layout;
      const L = layout.length;
      let cur = inputs;
      let ptr = 0;
      let hiddenIdx = 0;

      for (let l = 1; l < L; l++) {
        const inN = layout[l - 1];
        const outN = layout[l];
        const isOutput = l === L - 1;
        const rec = this.recurrent && !isOutput;
        const prev = rec ? this.state[hiddenIdx] : null;
        const next = new Array(outN);

        for (let o = 0; o < outN; o++) {
          let sum = 0;
          for (let i = 0; i < inN; i++) sum += cur[i] * g[ptr++];
          if (rec) for (let i = 0; i < outN; i++) sum += prev[i] * g[ptr++];
          sum += g[ptr++]; // bias
          next[o] = isOutput ? Math.tanh(sum) : this.act(sum);
        }

        if (!isOutput) {
          // zapisz nowy stan tej warstwy ukrytej do następnego kroku
          this.state[hiddenIdx] = Float32Array.from(next);
          hiddenIdx++;
        }
        cur = next;
      }
      return cur;
    }

    clone() {
      const nn = new NeuralNet(this.layout, this.activation, this.recurrent);
      nn.genome = this.genome.slice();
      return nn;
    }
  }

  NeuralNet.ACTIVATIONS = ACTIVATIONS;
  global.NeuralNet = NeuralNet;
})(window);
