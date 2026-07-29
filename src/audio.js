/* Every sound is synthesised at runtime — the game ships no audio files. */

const Audio3D = {
  ctx: null,
  ready: false,
  on: true,

  init() {
    if (this.ctx || !window.AudioContext) return;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);

    const seconds = 2;
    this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate * seconds, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    this.ready = true;
  },

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },

  burst(cut, freq, q, peak, tail) {
    const now = this.ctx.currentTime;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = cut;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(peak, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + tail);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(now);
    source.stop(now + tail + 0.05);
  },

  tone(type, from, to, peak, tail, delay = 0) {
    const now = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, now);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, now + tail);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(peak, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + tail);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + tail + 0.05);
  },

  blip(kind) {
    if (!this.ready || !this.on) return;
    switch (kind) {
      case 'shot':
        this.burst('highpass', 950, 1, 0.5, 0.13);
        this.tone('sine', 190, 50, 0.4, 0.14);
        break;
      case 'boom':
        this.burst('lowpass', 700, 1, 0.75, 0.3);
        this.tone('sine', 130, 38, 0.55, 0.3);
        break;
      case 'dry':
        this.burst('bandpass', 2700, 3, 0.28, 0.06);
        break;
      case 'reload':
        this.burst('bandpass', 1400, 3, 0.3, 0.08);
        this.burst('bandpass', 900, 3, 0.25, 0.1);
        break;
      case 'hit':
        this.tone('square', 880, 420, 0.15, 0.09);
        break;
      case 'headshot':
        this.tone('square', 1500, 700, 0.2, 0.11);
        break;
      case 'swing':
        this.burst('bandpass', 600, 1.4, 0.3, 0.14);
        break;
      case 'build':
        this.tone('square', 320, 520, 0.16, 0.1);
        this.burst('bandpass', 1100, 2, 0.18, 0.1);
        break;
      case 'pickup':
        this.tone('sine', 620, 940, 0.2, 0.14);
        break;
      case 'win':
        [523, 659, 784, 1047].forEach((hz, i) => this.tone('sine', hz, hz, 0.22, 0.5, i * 0.12));
        break;
      case 'lose':
        this.tone('sawtooth', 260, 70, 0.3, 0.8);
        break;
      default:
        break;
    }
  },
};
