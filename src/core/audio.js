// Полностью процедурный звук на WebAudio: никаких файлов, всё синтезируется.

// Насколько вперёд секвенсор расписывает ноты. Больше — устойчивее к
// просадкам кадра, меньше — быстрее реагирует на смену трека.
const LOOKAHEAD = 0.18;

const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const hz = (name) => {
  const m = /^([A-G])(#?)(-?\d)$/.exec(name);
  const semi = NOTE[m[1]] + (m[2] ? 1 : 0) + (+m[3] + 1) * 12;
  return 440 * Math.pow(2, (semi - 69) / 12);
};

class Audio {
  constructor() {
    this.ready = false;
    this.muted = false;
    // громкость, которую крутит игрок: 0..1. Мастер-шина никогда не выходит за
    // 0.9 — на единице синтез начинает клиппить на пиках попаданий.
    this.volume = 1;
    // Уровни шин. Замер в бою показал 0,054 RMS у эффектов против 0,006 у
    // музыки — разница в девять раз, музыку в схватке просто не слышно.
    // Подняты обе, но музыка сильнее: за сжатием на выходе место для этого есть.
    this.sfxVol = 0.68;
    this.musicVol = 0.62;
    this._track = null;
    this._step = 0;
    this._nextStep = 0;   // момент следующей доли на часах звука
    // Напряжение 0..1: музыка обязана слышать, что происходит. Меняется плавно
    // — резкий скачок читается сбоем, а не нарастанием.
    this._intensity = 0;
    this._intensityTo = 0;
    this._pending = null;   // тема, ждущая своей очереди за затуханием
    this._swapAt = 0;
  }

  init() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this._target();

    // ── Сжатие на выходе
    //
    // Замер: в гуще боя пик на выходе был 0,26 при доступной единице, а клиппинг
    // не случался ни разу за 176 кадров. То есть игра звучала вчетверо тише,
    // чем могла, — и старое замечание «на единице синтез начинает клиппить»
    // числами не подтвердилось.
    //
    // Поднять уровень напрямую было бы неверно: всплески в бою складываются, и
    // редкий залп из пяти попаданий сразу упёрся бы в потолок. Сжатие держит
    // пики, а тихие места остаются на месте — так поднимается средний уровень,
    // а не только громкость.
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 14;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.18;
    this.master.connect(this.comp).connect(this.ctx.destination);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = this.sfxVol;
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0;

    // общий ревер — делает мир объёмным
    this.verb = this.ctx.createConvolver();
    this.verb.buffer = this._impulse(1.7, 2.6);
    this.verbGain = this.ctx.createGain();
    this.verbGain.gain.value = 0.22;
    this.verb.connect(this.verbGain).connect(this.master);

    this.sfxBus.connect(this.master); this.sfxBus.connect(this.verb);
    this.musicBus.connect(this.master); this.musicBus.connect(this.verb);

    this.noiseBuf = this._noise(1.0);
    this.ready = true;
  }

  resume() { if (this.ready && this.ctx.state === 'suspended') this.ctx.resume(); }

  _impulse(dur, decay) {
    const sr = this.ctx.sampleRate, len = (sr * dur) | 0;
    const buf = this.ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  _noise(dur) {
    const sr = this.ctx.sampleRate, len = (sr * dur) | 0;
    const buf = this.ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** Базовый тон-генератор. */
  tone({ freq = 440, to = null, type = 'square', dur = 0.15, gain = 0.3, attack = 0.005,
         bus = null, detune = 0, delay = 0, at = null, filter = null, q = 1 } = {}) {
    if (!this.ready || this.silent) return;
    // `at` — абсолютный момент на часах звука. Им пользуется музыка: доля,
    // рассчитанная от кадра, гуляет на 7–17 мс при шаге в 190, и это слышно.
    const t = at != null ? Math.max(at, this.ctx.currentTime) : this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = type; o.detune.value = detune;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    let node = o;
    if (filter) {
      const f = this.ctx.createBiquadFilter();
      f.type = filter.type || 'lowpass';
      f.frequency.setValueAtTime(filter.freq, t);
      if (filter.to) f.frequency.exponentialRampToValueAtTime(Math.max(60, filter.to), t + dur);
      f.Q.value = q;
      node.connect(f); node = f;
    }
    node.connect(g).connect(bus || this.sfxBus);
    o.start(t); o.stop(t + dur + 0.02);
  }

  /** Шумовой удар — шаги, взрывы, шелест. */
  noise({ dur = 0.2, gain = 0.3, freq = 1200, to = 200, type = 'lowpass', q = 1, delay = 0, at = null, bus = null } = {}) {
    if (!this.ready || this.silent) return;
    const t = at != null ? Math.max(at, this.ctx.currentTime) : this.ctx.currentTime + delay;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf; s.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, to), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(bus || this.sfxBus);
    s.start(t); s.stop(t + dur + 0.02);
  }

  // ---------- библиотека эффектов ----------
  play(name, v = 1) {
    if (!this.ready) return;
    switch (name) {
      case 'swing':  this.noise({ dur: 0.16, gain: 0.16 * v, freq: 3400, to: 700, type: 'bandpass', q: 1.4 }); break;
      case 'hit':    this.noise({ dur: 0.14, gain: 0.3 * v, freq: 1800, to: 180, q: 0.7 });
                     this.tone({ freq: 220, to: 70, type: 'square', dur: 0.11, gain: 0.16 * v }); break;
      case 'crit':   this.noise({ dur: 0.2, gain: 0.34 * v, freq: 4200, to: 300, type: 'bandpass', q: 2 });
                     this.tone({ freq: 900, to: 200, type: 'sawtooth', dur: 0.18, gain: 0.16 * v }); break;
      case 'hurt':   this.tone({ freq: 300, to: 90, type: 'sawtooth', dur: 0.22, gain: 0.22 * v, filter: { freq: 1400, to: 400 } }); break;
      case 'die':    this.tone({ freq: 180, to: 50, type: 'square', dur: 0.5, gain: 0.2 * v });
                     this.noise({ dur: 0.4, gain: 0.2 * v, freq: 900, to: 90 }); break;
      case 'coin':   this.tone({ freq: hz('E6'), type: 'square', dur: 0.07, gain: 0.14 * v });
                     this.tone({ freq: hz('B6'), type: 'square', dur: 0.13, gain: 0.13 * v, delay: 0.06 }); break;
      case 'pickup': this.tone({ freq: hz('C5'), to: hz('G5'), type: 'triangle', dur: 0.16, gain: 0.2 * v }); break;
      case 'potion': this.tone({ freq: 400, to: 1200, type: 'sine', dur: 0.3, gain: 0.2 * v });
                     this.noise({ dur: 0.25, gain: 0.08 * v, freq: 2600, to: 900, type: 'bandpass', q: 3 }); break;
      case 'level':  ['C5', 'E5', 'G5', 'C6'].forEach((n, i) =>
                       this.tone({ freq: hz(n), type: 'triangle', dur: 0.5, gain: 0.2 * v, delay: i * 0.09 })); break;
      case 'quest':  ['G4', 'C5', 'E5'].forEach((n, i) =>
                       this.tone({ freq: hz(n), type: 'square', dur: 0.35, gain: 0.13 * v, delay: i * 0.08 })); break;
      case 'ui':     this.tone({ freq: 700, type: 'square', dur: 0.04, gain: 0.07 * v }); break;
      case 'uiBig':  this.tone({ freq: 380, to: 620, type: 'square', dur: 0.09, gain: 0.11 * v }); break;
      case 'deny':   this.tone({ freq: 200, to: 120, type: 'square', dur: 0.16, gain: 0.14 * v }); break;
      case 'buy':    this.tone({ freq: hz('A5'), type: 'square', dur: 0.06, gain: 0.12 * v });
                     this.tone({ freq: hz('E6'), type: 'square', dur: 0.14, gain: 0.11 * v, delay: 0.07 }); break;
      case 'dash':   this.noise({ dur: 0.22, gain: 0.18 * v, freq: 900, to: 2800, type: 'bandpass', q: 1.2 }); break;
      case 'cast':   this.tone({ freq: 300, to: 1400, type: 'sine', dur: 0.25, gain: 0.18 * v });
                     this.tone({ freq: 600, to: 2100, type: 'sine', dur: 0.25, gain: 0.09 * v, delay: 0.03 }); break;
      case 'bolt':   this.tone({ freq: 1200, to: 300, type: 'sawtooth', dur: 0.2, gain: 0.12 * v, filter: { freq: 2400, to: 500 } }); break;
      case 'portal': this.tone({ freq: 120, to: 900, type: 'sine', dur: 0.9, gain: 0.2 * v });
                     this.noise({ dur: 0.9, gain: 0.13 * v, freq: 300, to: 3000, type: 'bandpass', q: 2 }); break;
      case 'door':   this.noise({ dur: 0.35, gain: 0.2 * v, freq: 500, to: 90, q: 0.6 }); break;
      case 'boss':   this.tone({ freq: 90, to: 42, type: 'sawtooth', dur: 1.6, gain: 0.26 * v, filter: { freq: 700, to: 120 } });
                     this.noise({ dur: 1.4, gain: 0.18 * v, freq: 200, to: 60 }); break;
      case 'chest':  this.noise({ dur: 0.2, gain: 0.16 * v, freq: 2200, to: 500, type: 'bandpass', q: 2 });
                     ['C5', 'G5', 'C6'].forEach((n, i) => this.tone({ freq: hz(n), type: 'triangle', dur: 0.4, gain: 0.14 * v, delay: 0.1 + i * 0.07 })); break;
      case 'step':   this.noise({ dur: 0.06, gain: 0.05 * v, freq: 900, to: 240, q: 0.8 }); break;

      // ── Кузня, руны и стихии
      //
      // Раньше эти события занимали чужие звуки, и подмена сбивала с толку:
      // ковка звучала покупкой в лавке, разбор — открытием сундука, переплавка
      // и слияние рун — повышением уровня. Хуже всего было в заточке: срыв
      // играл `hurt` («по мне попали»), а гибель оружия — `die` («кто-то
      // умер»). Игрок слышал не то, что произошло.
      case 'forge':   // молот по наковальне: два удара и звон металла
        this.noise({ dur: 0.09, gain: 0.26 * v, freq: 2600, to: 340, type: 'bandpass', q: 1.1 });
        this.tone({ freq: 320, to: 120, type: 'square', dur: 0.1, gain: 0.16 * v });
        this.noise({ dur: 0.1, gain: 0.22 * v, freq: 2200, to: 300, type: 'bandpass', q: 1.1, delay: 0.13 });
        this.tone({ freq: 280, to: 110, type: 'square', dur: 0.12, gain: 0.15 * v, delay: 0.13 });
        this.tone({ freq: hz('E6'), type: 'triangle', dur: 0.7, gain: 0.1 * v, delay: 0.16,
                    filter: { freq: 5200, to: 2400 } }); break;
      case 'sharpen': // точильный камень: два прохода вверх и чистый звон
        this.noise({ dur: 0.22, gain: 0.14 * v, freq: 900, to: 5200, type: 'bandpass', q: 2.4 });
        this.noise({ dur: 0.18, gain: 0.12 * v, freq: 1100, to: 6000, type: 'bandpass', q: 2.4, delay: 0.2 });
        this.tone({ freq: hz('B6'), type: 'sine', dur: 0.55, gain: 0.12 * v, delay: 0.36 }); break;
      case 'sharpenFail': // проход, сорвавшийся в глухой стук
        this.noise({ dur: 0.16, gain: 0.15 * v, freq: 1200, to: 3000, type: 'bandpass', q: 2.2 });
        this.noise({ dur: 0.3, gain: 0.2 * v, freq: 700, to: 90, q: 0.7, delay: 0.15 });
        this.tone({ freq: 160, to: 60, type: 'sawtooth', dur: 0.34, gain: 0.16 * v, delay: 0.15,
                    filter: { freq: 600, to: 160 } }); break;
      case 'shatterItem': // металл не выдержал: треск и осколки врассыпную
        this.noise({ dur: 0.1, gain: 0.3 * v, freq: 5000, to: 900, type: 'bandpass', q: 1.6 });
        this.tone({ freq: 420, to: 70, type: 'square', dur: 0.2, gain: 0.18 * v });
        for (let i = 0; i < 5; i++) {
          this.noise({ dur: 0.07, gain: (0.1 - i * 0.015) * v, freq: 3600 - i * 400, to: 800,
                       type: 'bandpass', q: 3, delay: 0.12 + i * 0.06 });
        } break;
      case 'salvage': // разбор: глухой хруст и осыпь материалов
        this.noise({ dur: 0.14, gain: 0.24 * v, freq: 1400, to: 200, q: 0.9 });
        this.tone({ freq: 200, to: 80, type: 'square', dur: 0.16, gain: 0.13 * v });
        for (let i = 0; i < 4; i++) {
          this.noise({ dur: 0.05, gain: 0.07 * v, freq: 2400, to: 700, type: 'bandpass', q: 2.6, delay: 0.14 + i * 0.05 });
        } break;
      case 'fuse':    // две руны сходятся в одну
        // Первый вариант заканчивался взлётом вверх и по замеру выходил почти
        // тем же «level», который и заменял: та же форма, тот же ход. Теперь
        // звук именно сходится — два тона съезжаются к одному и гаснут вниз,
        // а не расцветают фанфарой.
        this.tone({ freq: 430, to: 700, type: 'sine', dur: 0.4, gain: 0.13 * v, detune: -26 });
        this.tone({ freq: 1180, to: 700, type: 'sine', dur: 0.4, gain: 0.13 * v, detune: 26 });
        this.tone({ freq: 700, to: 350, type: 'triangle', dur: 0.45, gain: 0.13 * v, delay: 0.38,
                    filter: { freq: 2400, to: 700 } });
        // шорох — в начало, как щелчок соприкосновения: в конце он тянул
        // спектр вверх и звук снова выходил похожим на фанфару
        this.noise({ dur: 0.1, gain: 0.07 * v, freq: 3800, to: 900, type: 'bandpass', q: 3 });
        break;
      case 'acid':    // разъедание: шипение с низким подпором
        this.noise({ dur: 0.5, gain: 0.16 * v, freq: 5200, to: 1400, type: 'bandpass', q: 0.8 });
        this.tone({ freq: 140, to: 90, type: 'sawtooth', dur: 0.45, gain: 0.08 * v,
                    filter: { freq: 500, to: 200 } }); break;
      case 'steam':   // пар: выброс снизу вверх
        this.noise({ dur: 0.55, gain: 0.2 * v, freq: 700, to: 4800, type: 'bandpass', q: 0.9 });
        this.tone({ freq: 220, to: 900, type: 'sine', dur: 0.4, gain: 0.07 * v }); break;
    }
  }

  // ---------- музыка ----------
  /** Простой пошаговый секвенсор: аккордовая подложка + арпеджио + бас. */
  /**
   * Сменить тему — через тишину, а не встык.
   *
   * Прежняя смена не затухала вовсе: замер показал громкость шины 0,34 до,
   * во время и после — `setTargetAtTime` к той же величине ничего не делает.
   * Темы просто наступали друг на друга: 0,14 секунды обе ставили ноты в
   * пределах окна упреждения, а подложка старой темы держится `stepTime × 15`,
   * то есть до трёх секунд, и аккорд леса звенел под боссовой темой в чужой
   * тональности.
   *
   * Теперь шина уходит в ноль, тема меняется в тишине и возвращается. Старые
   * ноты при этом доигрывают под затухание — так честнее, чем обрывать их.
   */
  setTrack(track, opts = {}) {
    if (!this.ready || !track) return;
    const out = opts.fadeOut ?? 0.55;
    if (this._pending) { if (this._pending.id === track.id) return; }
    else if (this._track && this._track.id === track.id) return;
    if (!this._track) { this._begin(track, opts.fadeIn); return; }

    this._pending = track;
    this._pendingIn = opts.fadeIn;
    this._swapAt = this.ctx.currentTime + out;
    const g = this.musicBus.gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setValueAtTime(Math.max(0.0001, g.value), this.ctx.currentTime);
    g.linearRampToValueAtTime(0.0001, this._swapAt);
  }

  /** Начать тему с тишины. */
  _begin(track, fadeIn) {
    this._track = track;
    this._pending = null;
    this._swapAt = 0;
    this._step = 0;
    this._nextStep = 0;
    const g = this.musicBus.gain;
    const now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(0.0001, now);
    g.linearRampToValueAtTime(this.silent ? 0.0001 : this.musicVol, now + (fadeIn ?? 0.5));
  }

  stopMusic() {
    if (!this.ready) return;
    this._track = null;
    this._pending = null;
    this._swapAt = 0;
    this.musicBus.gain.cancelScheduledValues(this.ctx.currentTime);
    this.musicBus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
  }

  /**
   * Тик секвенсора.
   *
   * Доли расписываются **вперёд по часам звука**, а не отсчитываются от кадров.
   * Прежний способ (`this._timer -= dt`) давал разбег в 7,4 мс по медиане и до
   * 17,4 в худшем случае при шаге в 190 — на слух это заметная неровность, а
   * при просадке кадра доля просто съезжала. Теперь кадр только спрашивает
   * «что успело настать», а время нот считает сам звук.
   */
  update() {
    if (!this.ready || !this._track || this.silent) return;
    const now = this.ctx.currentTime;
    // Смена темы дозрела — подхватываем новую с тишины.
    if (this._pending && now >= this._swapAt) this._begin(this._pending, this._pendingIn);
    const t = this._track;
    // Вкладка была свёрнута или страница подвисла — не наверстываем сотни
    // пропущенных долей, а подхватываем такт с ближайшей.
    if (this._nextStep < now - 0.25 || this._nextStep === 0) this._nextStep = now + 0.02;
    // напряжение подтягивается к цели: примерно секунда на полный ход
    const k = 0.04;
    this._intensity += (this._intensityTo - this._intensity) * k;
    while (this._nextStep < now + LOOKAHEAD) {
      this._emit(this._step++, this._nextStep);
      this._nextStep += t.stepTime;
    }
  }

  /**
   * Насколько горячо сейчас: 0 — покой, 1 — бой с боссом.
   *
   * Игра зовёт это каждый кадр; сама величина ползёт к цели медленно, около
   * секунды на полный ход. Музыка, дёргающаяся вместе с каждым забежавшим
   * гоблином, звучит сломанной, а не тревожной.
   */
  setIntensity(v) {
    this._intensityTo = Math.max(0, Math.min(1, v || 0));
  }

  /** Одна доля на заданный момент. */
  _emit(s, at) {
    const t = this._track;
    const bars = t.chords.length;
    const bar = ((s / 16) | 0) % bars;
    const chord = t.chords[bar];
    const beat = s % 16;

    if (beat === 0) {
      // подложка: длинный аккорд
      chord.forEach((n, i) =>
        this.tone({ freq: hz(n), type: 'triangle', dur: t.stepTime * 15,
                    gain: 0.05 - i * 0.008, bus: this.musicBus,
                    attack: 0.6, filter: { freq: 900, to: 500 }, at }));
    }
    if (beat % 4 === 0) {
      this.tone({ freq: hz(t.bass[bar % t.bass.length]), type: t.bassWave || 'sine',
                  dur: t.stepTime * 3, gain: 0.1, bus: this.musicBus, attack: 0.02,
                  filter: { freq: 420, to: 180 }, at });
    }
    // Арпеджио и перкуссия идут по **сквозному** номеру доли, а не по её месту в
    // такте. Раньше `arp[beat % len]` перезапускал рисунок каждый такт, и длина
    // рисунка ни на что не влияла. Теперь длина, взаимно простая с тактом,
    // уводит рисунок в сдвиг — петля перестаёт совпадать сама с собой.
    const a = t.arp[s % t.arp.length];
    if (a !== null && a !== undefined) {
      const n = chord[a % chord.length];
      const oct = 12 * (1 + ((a / chord.length) | 0));
      this.tone({ freq: hz(n) * Math.pow(2, oct / 12) / 2, type: t.leadWave || 'square',
                  dur: t.stepTime * 1.6, gain: 0.045, bus: this.musicBus, attack: 0.01,
                  filter: { freq: 2600, to: 900 }, detune: 4, at });
    }
    if (t.perc && t.perc[s % t.perc.length]) {
      this.noise({ dur: 0.07, gain: 0.05, freq: 3000, to: 700, type: 'bandpass', q: 1.5, bus: this.musicBus, at });
    }

    // ── слои напряжения
    //
    // Не громкость, а плотность: в бою добавляется пульс на долю и подголосок
    // октавой ниже. Прибавлять громкость было бы проще, но громче — не значит
    // тревожнее; тревожнее — когда музыке становится тесно.
    const q = this._intensity;
    if (q > 0.12 && beat % 4 === 0) {
      this.noise({ dur: 0.09, gain: 0.04 * q, freq: 260, to: 70, q: 0.8, bus: this.musicBus, at });
    }
    if (q > 0.45 && beat % 2 === 0) {
      const n = chord[(beat >> 1) % chord.length];
      this.tone({ freq: hz(n) / 2, type: 'sawtooth', dur: t.stepTime * 1.2,
                  gain: 0.03 * (q - 0.45) / 0.55, bus: this.musicBus, attack: 0.01,
                  filter: { freq: 700, to: 260 }, at });
    }
  }

  /**
   * Ползунки музыки и эффектов — раздельно.
   *
   * Замер показал, что в бою эффекты идут вдевятеро громче музыки. Свести это
   * одним числом на всех нельзя: кому-то нужен звон попаданий, кому-то музыка,
   * и правильного ответа тут нет — есть только предпочтение. Поэтому вместо
   * подобранного мной баланса даны две ручки.
   */
  setMusicVolume(v) {
    this.musicVol = Math.max(0, Math.min(1, v));
    if (!this.ready) return;
    // подстраиваем только если тема играет: иначе затопчем затухание
    if (this._track && !this._pending) {
      this.musicBus.gain.setTargetAtTime(this.silent ? 0 : this.musicVol, this.ctx.currentTime, 0.08);
    }
  }

  setSfxVolume(v) {
    this.sfxVol = Math.max(0, Math.min(1, v));
    if (!this.ready) return;
    this.sfxBus.gain.setTargetAtTime(this.sfxVol, this.ctx.currentTime, 0.05);
  }

  _target() { return this.muted ? 0 : this.volume * 0.9; }

  _apply() {
    if (!this.ready) return;
    this.master.gain.setTargetAtTime(this._target(), this.ctx.currentTime, 0.1);
  }

  /**
   * Выключатель и ползунок — разные вещи и живут порознь: снять глушение должно
   * возвращать ту громкость, что игрок выставил, а не единицу.
   */
  setMuted(m) { this.muted = m; this._apply(); }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    this._apply();
  }

  /** Молчит ли звук вообще — глушением или ползунком в нуле. */
  get silent() { return this.muted || this.volume <= 0.001; }
}

export const audio = new Audio();

// Треки для биомов — разные лады дают разное настроение.
// Треки для биомов — разные лады дают разное настроение.
//
// ── Почему прогрессии по восемь аккордов, а рисунки — некруглой длины
//
// Замер показал, что петля длилась 8–17 секунд: четыре аккорда по шестнадцать
// долей. Лес повторялся сорок девять раз за десять минут, боссовая тема —
// семьдесят два, а бой с боссом длится 15–39 секунд, то есть игрок слышит одно
// и то же по нескольку раз за схватку.
//
// Две правки. Прогрессии удлинены вдвое — вторая половина уводит в
// параллельные ступени и возвращается. И длина арпеджио взята **не кратной
// шестнадцати**: рисунок теперь сдвигается относительно такта и совпадает сам
// с собой только через наименьшее общее кратное. Гармония при этом не страдает
// — арпеджио всегда берёт ноты текущего аккорда, в какой бы фазе ни находилось.

export const TRACKS = {
  city: {
    id: 'city', stepTime: 0.17,
    chords: [['C4', 'E4', 'G4'], ['A3', 'C4', 'E4'], ['F3', 'A3', 'C4'], ['G3', 'B3', 'D4'],
             ['E3', 'G3', 'B3'], ['A3', 'C4', 'E4'], ['D4', 'F4', 'A4'], ['G3', 'B3', 'D4']],
    bass: ['C2', 'A1', 'F1', 'G1', 'E1', 'A1', 'D2', 'G1'],
    arp: [0, null, 2, null, 1, null, 2, null, 0, null, 1, null],
    perc: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    leadWave: 'triangle',
  },
  forest: {
    id: 'forest', stepTime: 0.19,
    chords: [['D4', 'F4', 'A4'], ['C4', 'E4', 'G4'], ['B3', 'D4', 'F4'], ['G3', 'B3', 'D4'],
             ['F3', 'A3', 'C4'], ['C4', 'E4', 'G4'], ['A3', 'C4', 'E4'], ['D4', 'F4', 'A4']],
    bass: ['D2', 'C2', 'B1', 'G1', 'F1', 'C2', 'A1', 'D2'],
    arp: [0, 2, null, 1, null, 2, 0, null, 1, null, 2, null, 0, 1, null, 2, null, 1, null, 2],
    leadWave: 'square',
  },
  swamp: {
    id: 'swamp', stepTime: 0.23,
    chords: [['A3', 'C4', 'E4'], ['G3', 'A#3', 'D4'], ['F3', 'A3', 'C4'], ['E3', 'G3', 'B3'],
             ['D3', 'F3', 'A3'], ['A3', 'C4', 'E4'], ['A#3', 'D4', 'F4'], ['E3', 'G3', 'B3']],
    bass: ['A1', 'G1', 'F1', 'E1', 'D1', 'A1', 'A#1', 'E1'],
    arp: [0, null, null, 1, null, 2, null, null, 1, null, 0, null, null, 2],
    leadWave: 'sine', bassWave: 'sawtooth',
  },
  frost: {
    id: 'frost', stepTime: 0.21,
    chords: [['E4', 'G4', 'B4'], ['C4', 'E4', 'G4'], ['D4', 'F#4', 'A4'], ['B3', 'D4', 'F#4'],
             ['G3', 'B3', 'D4'], ['E4', 'G4', 'B4'], ['A3', 'C4', 'E4'], ['B3', 'D4', 'F#4']],
    bass: ['E2', 'C2', 'D2', 'B1', 'G1', 'E2', 'A1', 'B1'],
    arp: [2, null, 1, 0, null, 1, 2, null, 0, null, 2, 1, null, 0, null, 1, 2, null],
    leadWave: 'triangle',
  },
  ember: {
    id: 'ember', stepTime: 0.155,
    chords: [['D4', 'F4', 'A4'], ['A#3', 'D4', 'F4'], ['C4', 'E4', 'G4'], ['A3', 'C#4', 'E4'],
             ['G3', 'A#3', 'D4'], ['D4', 'F4', 'A4'], ['F3', 'A3', 'C4'], ['A3', 'C#4', 'E4']],
    bass: ['D2', 'A#1', 'C2', 'A1', 'G1', 'D2', 'F1', 'A1'],
    arp: [0, 1, 2, 1, 0, 2, 1, 2, 0, 1, 2, 1, 0, 2],
    perc: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1],
    leadWave: 'sawtooth', bassWave: 'square',
  },
  dungeon: {
    id: 'dungeon', stepTime: 0.26,
    chords: [['A3', 'C4', 'E4'], ['F3', 'A3', 'C4'], ['G3', 'A#3', 'D4'], ['E3', 'G3', 'B3'],
             ['D3', 'F3', 'A3'], ['A3', 'C4', 'E4'], ['F3', 'A3', 'C4'], ['E3', 'G#3', 'B3']],
    bass: ['A1', 'F1', 'G1', 'E1', 'D1', 'A1', 'F1', 'E1'],
    arp: [0, null, null, null, 2, null, null, 1, null, null, 0, null, null, null],
    leadWave: 'sine',
  },
  // Пролом: лад с пониженной второй и тритоном — он не «злой», он неверный.
  // Именно этого биом и просит: земля здесь не горит и не мёрзнет, она
  // разошлась. Шаг медленный, арпеджио редкое и длиной 26 — расходится с тактом
  // сильнее всех прочих тем.
  breach: {
    id: 'breach', stepTime: 0.245,
    chords: [['D4', 'F4', 'A4'], ['D#4', 'G4', 'A#4'], ['C4', 'D#4', 'G4'], ['A3', 'C4', 'D#4'],
             ['G#3', 'C4', 'D#4'], ['D4', 'F4', 'G#4'], ['A#3', 'D4', 'F4'], ['A3', 'C4', 'E4']],
    bass: ['D1', 'D#1', 'C1', 'A1', 'G#1', 'D1', 'A#1', 'A1'],
    arp: [0, null, null, 2, null, 1, null, null, 2, null, 0, null, null, 1, null, null, 2, null, null, 0, null, 1, null, null, 2, null],
    perc: [1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0],
    leadWave: 'sine', bassWave: 'sawtooth',
  },

  boss: {
    id: 'boss', stepTime: 0.13,
    chords: [['D4', 'F4', 'A4'], ['D4', 'F4', 'A#4'], ['C4', 'E4', 'G4'], ['A3', 'C4', 'E4'],
             ['A#3', 'D4', 'F4'], ['D4', 'F4', 'A4'], ['G3', 'A#3', 'D4'], ['A3', 'C#4', 'E4']],
    bass: ['D1', 'D1', 'C1', 'A1', 'A#1', 'D1', 'G1', 'A1'],
    arp: [0, 0, 1, 2, 0, 1, 0, 2, 1, 0, 2, 1, 0, 2, 1, 2, 0, 1, 2, 1, 0, 2],
    perc: [1, 0, 0, 1, 1, 0, 1, 0, 1, 0, 0, 1, 1, 0],
    leadWave: 'sawtooth', bassWave: 'square',
  },
};
