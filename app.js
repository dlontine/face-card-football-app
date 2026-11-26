/**
 * Deck Football Companion — Core State Machine & UI Controller
 * Pure Vanilla ES6+ JavaScript (browser-native, GitHub Pages ready)
 */

(() => {
  'use strict';

  const PLAY_CARD_LIMIT = 3;
  const PLAY_CLOCK_DEFAULT = 30;
  const OT_DURATION_SECONDS = 120; // 2 minutes

  // =========================================================================
  // GAME STATE MACHINE
  // =========================================================================
  const state = {
    scoreHome: 0,
    scoreAway: 0,
    possession: 'home', // 'home' | 'away'
    openingReceiver: 'home', // Tracks who received Q1 kickoff so other team gets Q3
    down: 1,
    distance: 10,
    ballOn: 25, // 1–99 during play (0 = Home Goal, 100 = Away Goal)
    lineGain: 35,
    quarter: 1, // 1–4, 5+ = OT
    quarterLengthMinutes: 3, // 3, 5, or 7
    gameTimeRemaining: 180,
    playClockTime: PLAY_CLOCK_DEFAULT,
    playClockExpired: false,

    // Clock runtime
    gameClockRunning: false,
    playClockRunning: false,
    wasGameClockRunningBeforeModal: false,
    wasPlayClockRunningBeforeModal: false,
    activeModals: new Set(),
    gameTimerId: null,
    playTimerId: null,

    // Half-end 3-second warning & special play flags
    finalSecondsWarnedQ2: false,
    finalSecondsWarnedQ4: false,
    isFinalSecondsPlay: false,
    isCelebratingTD: false,

    // Kickoff & Coin Flip context
    kickoffContext: 'opening', // 'opening' | 'halftime' | 'score' | 'overtime'
    kickoffReceivingTeam: 'home',
    openingCoinWinner: null,
    otCoinWinner: null,

    // Preferences & pending workflows
    soundEnabled: true,
    pendingPATPoints: 1,

    // Card buffers
    offenseCards: [],
    defenseCards: [],
    hailMaryOffenseCards: [],
    hailMaryDefenseCards: [],
    puntKickCard: null,
    puntReturnCard: null,
    isSafetyFreeKick: false,
    fgOffenseCards: [],
    fgDefenseCards: [],
    kickReturnCards: [],
  };

  // =========================================================================
  // WEB AUDIO SOUND ENGINE
  // =========================================================================
  let audioCtx = null;

  function getAudioContext() {
    if (!state.soundEnabled) return null;
    if (!audioCtx) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (AudioCtor) audioCtx = new AudioCtor();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function playTone(freq, duration, type = 'sine', volume = 0.09) {
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch {
      // Ignore audio autoplay blocks
    }
  }

  const sfx = {
    whistle() {
      playTone(2350, 0.1, 'triangle', 0.08);
      setTimeout(() => playTone(2550, 0.16, 'triangle', 0.08), 90);
    },
    buzzer() {
      playTone(145, 0.48, 'sawtooth', 0.1);
    },
    score() {
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
        setTimeout(() => playTone(freq, 0.15, 'sine', 0.09), i * 70);
      });
    },
    touchdown() {
      const notes = [
        [392.0, 0, 0.12],
        [523.25, 95, 0.14],
        [659.25, 190, 0.14],
        [783.99, 290, 0.18],
        [1046.5, 420, 0.36],
      ];
      notes.forEach(([freq, delay, dur]) => {
        setTimeout(() => playTone(freq, dur, 'triangle', 0.11), delay);
      });
    },
    victory() {
      const fanfare = [
        [523.25, 0, 0.15],
        [659.25, 130, 0.15],
        [783.99, 260, 0.16],
        [1046.5, 410, 0.22],
        [783.99, 600, 0.14],
        [1046.5, 730, 0.55],
      ];
      fanfare.forEach(([freq, delay, dur]) => {
        setTimeout(() => playTone(freq, dur, 'triangle', 0.11), delay);
      });
    },
    tick() {
      playTone(760, 0.06, 'sine', 0.07);
    },
  };

  // =========================================================================
  // DOM REFERENCES
  // =========================================================================
  const $ = (id) => document.getElementById(id);

  const dom = {
    // Scoreboard & Single Unified Clock
    celebrationCanvas: $('celebrationCanvas'),
    scoreboardPanel: $('scoreboardPanel'),
    tdScoreboardBanner: $('tdScoreboardBanner'),
    tdBannerText: $('tdBannerText'),
    popHome: $('popHome'),
    popAway: $('popAway'),
    teamBlockHome: $('teamBlockHome'),
    teamBlockAway: $('teamBlockAway'),
    scoreHome: $('scoreHome'),
    scoreAway: $('scoreAway'),
    badgeHome: $('badgeHome'),
    badgeAway: $('badgeAway'),
    quarterDisplay: $('quarterDisplay'),
    gameClock: $('gameClock'),
    playClockModule: $('playClockModule'),
    playClock: $('playClock'),
    playClockExpiredFlag: $('playClockExpiredFlag'),
    btnTimeoutToggle: $('btnTimeoutToggle'),
    btnResetPlayClock: $('btnResetPlayClock'),

    // Field & Down
    downTag: $('downTag'),
    locTag: $('locTag'),
    driveIndicator: $('driveIndicator'),
    btnOpenFourthDown: $('btnOpenFourthDown'),
    svgLosGroup: $('svgLosGroup'),
    svgFirstDownGroup: $('svgFirstDownGroup'),
    svgLosText: $('svgLosText'),
    svgToGoZone: $('svgToGoZone'),
    statusText: $('statusText'),

    // Modals
    modalPlayCalc: $('modalPlayCalc'),
    modalFourthDown: $('modalFourthDown'),
    modalFinalSeconds: $('modalFinalSeconds'),
    modalHailMary: $('modalHailMary'),
    modalPunt: $('modalPunt'),
    modalFG: $('modalFG'),
    modalFGMade: $('modalFGMade'),
    modalFGMissed: $('modalFGMissed'),
    modalTDChoice: $('modalTDChoice'),
    modalPATResult: $('modalPATResult'),
    modalOpeningCoinFlip: $('modalOpeningCoinFlip'),
    modalKickoff: $('modalKickoff'),
    modalKickReturn: $('modalKickReturn'),
    modalSafety: $('modalSafety'),
    modalDelayOfGame: $('modalDelayOfGame'),
    modalOvertime: $('modalOvertime'),
    modalQuarterEnd: $('modalQuarterEnd'),
    modalDeal: $('modalDeal'),
    modalScoreAdjust: $('modalScoreAdjust'),
    modalNewGame: $('modalNewGame'),
    modalRules: $('modalRules'),

    // Play Calc
    chipsOffense: $('chipsOffense'),
    chipsDefense: $('chipsDefense'),
    labelOffenseCount: $('labelOffenseCount'),
    labelDefenseCount: $('labelDefenseCount'),
    calcDiffText: $('calcDiffText'),
    calcOutcomeSubtext: $('calcOutcomeSubtext'),
    btnApplyPlayCalc: $('btnApplyPlayCalc'),

    // 4th Down & Final Seconds
    titleFourthDown: $('titleFourthDown'),
    fourthDownDetail: $('fourthDownDetail'),
    finalSecondsKicker: $('finalSecondsKicker'),
    finalSecondsDetail: $('finalSecondsDetail'),

    // Hail Mary
    hailMaryTargetText: $('hailMaryTargetText'),
    hailMaryMathText: $('hailMaryMathText'),
    labelHMOffense: $('labelHMOffense'),
    labelHMDefense: $('labelHMDefense'),
    chipsHMOffense: $('chipsHMOffense'),
    chipsHMDefense: $('chipsHMDefense'),

    // Punt
    puntTitle: $('puntTitle'),
    puntDesc: $('puntDesc'),
    chipsPuntKick: $('chipsPuntKick'),
    chipsPuntReturn: $('chipsPuntReturn'),
    puntNetText: $('puntNetText'),
    puntLandingPreview: $('puntLandingPreview'),

    // Field Goal
    fgTargetText: $('fgTargetText'),
    fgMathText: $('fgMathText'),
    labelFGOffense: $('labelFGOffense'),
    labelFGDefense: $('labelFGDefense'),
    chipsFGOffense: $('chipsFGOffense'),
    chipsFGDefense: $('chipsFGDefense'),
    fgMadeDetail: $('fgMadeDetail'),
    fgMissedDetail: $('fgMissedDetail'),

    // Opening Coin Flip
    openingCoinStatus: $('openingCoinStatus'),
    openingCoinDisc: $('openingCoinDisc'),
    openingCallRow: $('openingCallRow'),
    openingChoiceRow: $('openingChoiceRow'),

    // TD Phases & Kickoff / Return
    tdChoiceDetail: $('tdChoiceDetail'),
    titlePATResult: $('titlePATResult'),
    patResultPrompt: $('patResultPrompt'),
    kickoffKicker: $('kickoffKicker'),
    titleKickoff: $('titleKickoff'),
    kickoffDetail: $('kickoffDetail'),
    kickReturnSubtitle: $('kickReturnSubtitle'),
    labelKickReturnCount: $('labelKickReturnCount'),
    chipsKickReturn: $('chipsKickReturn'),
    kickReturnTotalText: $('kickReturnTotalText'),
    kickReturnSpotText: $('kickReturnSpotText'),

    // Overtime Coin Flip
    otStatusText: $('otStatusText'),
    otCoinDisc: $('otCoinDisc'),
    btnFlipOTCoin: $('btnFlipOTCoin'),
    otChoiceRow: $('otChoiceRow'),

    // Quarter End & Deal
    quarterEndCard: $('quarterEndCard'),
    victoryTrophyWrap: $('victoryTrophyWrap'),
    victoryScoreStrip: $('victoryScoreStrip'),
    victoryColHome: $('victoryColHome'),
    victoryColAway: $('victoryColAway'),
    victoryFinalHome: $('victoryFinalHome'),
    victoryFinalAway: $('victoryFinalAway'),
    quarterEndKicker: $('quarterEndKicker'),
    titleQuarterEnd: $('titleQuarterEnd'),
    quarterEndBody: $('quarterEndBody'),
    btnConfirmQuarterEnd: $('btnConfirmQuarterEnd'),
    dealKicker: $('dealKicker'),
    dealTitle: $('dealTitle'),
    dealBody: $('dealBody'),

    // Score Adjust
    modalHomeScoreVal: $('modalHomeScoreVal'),
    modalAwayScoreVal: $('modalAwayScoreVal'),
  };

  // =========================================================================
  // CELEBRATION ENGINE (SCOREBOARD TD ANIMATION & VICTORY CONFETTI)
  // =========================================================================
  const celebration = {
    rafId: null,
    waveTimerId: null,
    particles: [],
    tdTimeoutId: null,
  };

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function resizeCelebrationCanvas() {
    const canvas = dom.celebrationCanvas;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function spawnConfettiBurst(originX, originY, count, colors, spreadSpeed = 7.5) {
    for (let i = 0; i < count; i += 1) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.35;
      const speed = spreadSpeed * (0.45 + Math.random() * 0.9);
      celebration.particles.push({
        x: originX + (Math.random() - 0.5) * 80,
        y: originY + (Math.random() - 0.5) * 16,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.5,
        gravity: 0.16 + Math.random() * 0.08,
        drag: 0.985,
        w: 5 + Math.random() * 5,
        h: 3 + Math.random() * 4,
        rot: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 0.24,
        color: colors[i % colors.length],
        life: 1,
        decay: 0.011 + Math.random() * 0.008,
      });
    }
  }

  function runConfettiLoop() {
    const canvas = dom.celebrationCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);

    for (let i = celebration.particles.length - 1; i >= 0; i -= 1) {
      const p = celebration.particles[i];
      p.vx *= p.drag;
      p.vy = p.vy * p.drag + p.gravity;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vRot;
      p.life -= p.decay;

      if (p.life <= 0 || p.y > h + 30) {
        celebration.particles.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }

    if (celebration.particles.length > 0) {
      celebration.rafId = requestAnimationFrame(runConfettiLoop);
    } else {
      celebration.rafId = null;
      ctx.clearRect(0, 0, w, h);
    }
  }

  function launchConfetti(mode, team) {
    if (prefersReducedMotion()) return;
    resizeCelebrationCanvas();

    const teamPalette =
      team === 'home'
        ? ['#38bdf8', '#fbbf24', '#22c55e', '#f8fafc']
        : ['#f87171', '#fbbf24', '#22c55e', '#f8fafc'];

    if (mode === 'touchdown') {
      const rect = dom.scoreboardPanel.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height * 0.55;
      spawnConfettiBurst(cx, cy, 46, teamPalette, 7.2);
    } else if (mode === 'victory') {
      stopConfetti();
      resizeCelebrationCanvas();
      const w = window.innerWidth;
      const h = window.innerHeight;
      spawnConfettiBurst(w * 0.25, h * 0.45, 45, teamPalette, 8.8);
      spawnConfettiBurst(w * 0.75, h * 0.45, 45, teamPalette, 8.8);
      let waves = 0;
      celebration.waveTimerId = setInterval(() => {
        waves += 1;
        if (waves > 4) {
          clearInterval(celebration.waveTimerId);
          celebration.waveTimerId = null;
          return;
        }
        const rx = w * (0.2 + Math.random() * 0.6);
        const ry = h * (0.25 + Math.random() * 0.35);
        spawnConfettiBurst(rx, ry, 34, teamPalette, 8.0);
        if (!celebration.rafId) celebration.rafId = requestAnimationFrame(runConfettiLoop);
      }, 650);
    }

    if (!celebration.rafId && celebration.particles.length > 0) {
      celebration.rafId = requestAnimationFrame(runConfettiLoop);
    }
  }

  function stopConfetti() {
    if (celebration.waveTimerId) {
      clearInterval(celebration.waveTimerId);
      celebration.waveTimerId = null;
    }
    if (celebration.rafId) {
      cancelAnimationFrame(celebration.rafId);
      celebration.rafId = null;
    }
    celebration.particles = [];
    const canvas = dom.celebrationCanvas;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  function triggerScoreboardTD(team, onComplete) {
    clearTimeout(celebration.tdTimeoutId);
    const board = dom.scoreboardPanel;
    const teamBlock = team === 'home' ? dom.teamBlockHome : dom.teamBlockAway;
    const popEl = team === 'home' ? dom.popHome : dom.popAway;

    board.classList.remove('td-celebrate-home', 'td-celebrate-away');
    dom.teamBlockHome.classList.remove('is-scoring');
    dom.teamBlockAway.classList.remove('is-scoring');
    dom.popHome.classList.remove('is-active');
    dom.popAway.classList.remove('is-active');
    dom.tdScoreboardBanner.classList.remove('is-active');

    void board.offsetWidth; // Force reflow to restart CSS keyframes

    dom.tdBannerText.textContent = `${team === 'home' ? 'HOME' : 'AWAY'} TOUCHDOWN!`;
    board.classList.add(team === 'home' ? 'td-celebrate-home' : 'td-celebrate-away');
    teamBlock.classList.add('is-scoring');
    popEl.classList.add('is-active');
    dom.tdScoreboardBanner.classList.add('is-active');

    sfx.touchdown();
    launchConfetti('touchdown', team);

    const delayMs = prefersReducedMotion() ? 220 : 1150;
    if (onComplete) {
      state.isCelebratingTD = true;
      pauseGameClock();
      pausePlayClock();
    }

    celebration.tdTimeoutId = setTimeout(() => {
      board.classList.remove('td-celebrate-home', 'td-celebrate-away');
      teamBlock.classList.remove('is-scoring');
      popEl.classList.remove('is-active');
      dom.tdScoreboardBanner.classList.remove('is-active');
      state.isCelebratingTD = false;
      if (onComplete) onComplete();
    }, delayMs);
  }

  function clearVictoryModalState() {
    dom.quarterEndCard.classList.remove('is-victory', 'victory-home', 'victory-away');
    dom.victoryTrophyWrap.hidden = true;
    dom.victoryScoreStrip.hidden = true;
    dom.victoryColHome.classList.remove('is-winner');
    dom.victoryColAway.classList.remove('is-winner');
  }

  // =========================================================================
  // UTILITIES
  // =========================================================================
  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  function formatGameClock(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function formatPlayClock(seconds) {
    return `:${String(seconds).padStart(2, '0')}`;
  }

  function ordinalDown(down) {
    return ['1st', '2nd', '3rd', '4th'][down - 1] || `${down}th`;
  }

  function teamLabel(team) {
    return team === 'home' ? 'Home' : 'Away';
  }

  function setStatus(message) {
    dom.statusText.textContent = message;
  }

  function computeDistance() {
    const isHome = state.possession === 'home';
    const raw = isHome ? state.lineGain - state.ballOn : state.ballOn - state.lineGain;
    state.distance = Math.max(0, raw);
    return state.distance;
  }

  function resetFirstDownMarkers() {
    const isHome = state.possession === 'home';
    state.down = 1;
    state.lineGain = isHome ? Math.min(100, state.ballOn + 10) : Math.max(0, state.ballOn - 10);
    computeDistance();
  }

  function formatSpotLabel(yard, possession) {
    if (yard === 50) return '50';
    if (yard < 50) return possession === 'home' ? `Own ${yard}` : `Opp ${yard}`;
    const oppYard = 100 - yard;
    return possession === 'home' ? `Opp ${oppYard}` : `Own ${oppYard}`;
  }

  function getYardsToEndzone() {
    return state.possession === 'home' ? 100 - state.ballOn : state.ballOn;
  }

  function getFGTargetDistance() {
    return getYardsToEndzone() + 10;
  }

  // =========================================================================
  // SYNCHRONIZED CLOCK ENGINE (SINGLE TIMEOUT CONTROL)
  // =========================================================================
  function renderClocks() {
    dom.gameClock.textContent = formatGameClock(state.gameTimeRemaining);
    dom.quarterDisplay.textContent = state.quarter <= 4 ? `Q${state.quarter}` : state.quarter === 5 ? 'OT' : `OT${state.quarter - 4}`;

    const anyRunning = state.gameClockRunning || state.playClockRunning;
    dom.btnTimeoutToggle.textContent = anyRunning ? 'Timeout' : 'Start Clock';
    dom.btnTimeoutToggle.classList.toggle('is-running', anyRunning);

    dom.playClock.textContent = formatPlayClock(state.playClockTime);
    dom.playClockExpiredFlag.hidden = !state.playClockExpired;

    dom.playClockModule.classList.toggle('is-expired', state.playClockExpired);
    dom.playClockModule.classList.toggle(
      'is-warning',
      !state.playClockExpired && state.playClockTime <= 5 && state.playClockTime > 0
    );
  }

  function startGameClock() {
    if (state.gameClockRunning || state.gameTimeRemaining <= 0) return;
    state.gameClockRunning = true;
    clearInterval(state.gameTimerId);
    state.gameTimerId = setInterval(() => {
      if (state.gameTimeRemaining > 0) {
        state.gameTimeRemaining -= 1;
        renderClocks();

        // Check 3-second warning in Q2 (Half) or Q4 (End of Regulation)
        if (state.gameTimeRemaining === 3) {
          if (state.quarter === 2 && !state.finalSecondsWarnedQ2) {
            state.finalSecondsWarnedQ2 = true;
            openFinalSecondsModal();
            return;
          }
          if (state.quarter === 4 && !state.finalSecondsWarnedQ4) {
            state.finalSecondsWarnedQ4 = true;
            openFinalSecondsModal();
            return;
          }
        }
      }

      if (state.gameTimeRemaining <= 0) {
        pauseGameClock();
        pausePlayClock();
        sfx.buzzer();
        handleQuarterExpired();
      }
    }, 1000);
    renderClocks();
  }

  function pauseGameClock() {
    state.gameClockRunning = false;
    clearInterval(state.gameTimerId);
    state.gameTimerId = null;
    renderClocks();
  }

  function startPlayClock() {
    if (state.playClockRunning) return;
    if (state.playClockTime <= 0) {
      state.playClockTime = PLAY_CLOCK_DEFAULT;
    }
    state.playClockExpired = false;
    state.playClockRunning = true;
    clearInterval(state.playTimerId);
    state.playTimerId = setInterval(() => {
      if (state.playClockTime > 0) {
        state.playClockTime -= 1;
        if (state.playClockTime <= 3 && state.playClockTime > 0) {
          sfx.tick();
        }
        renderClocks();
      }
      if (state.playClockTime <= 0) {
        pausePlayClock();
        pauseGameClock();
        state.playClockExpired = true;
        renderClocks();
        sfx.buzzer();
        openDelayOfGameModal();
      }
    }, 1000);
    renderClocks();
  }

  function pausePlayClock() {
    state.playClockRunning = false;
    clearInterval(state.playTimerId);
    state.playTimerId = null;
    renderClocks();
  }

  function resetPlayClock(autoStart = false) {
    pausePlayClock();
    state.playClockTime = PLAY_CLOCK_DEFAULT;
    state.playClockExpired = false;
    renderClocks();
    if (autoStart) startPlayClock();
  }

  function setQuarterLength(minutes, resetClock = true) {
    state.quarterLengthMinutes = minutes;
    if (resetClock && state.quarter <= 4) {
      pauseGameClock();
      state.gameTimeRemaining = minutes * 60;
    }
    syncQuarterLengthButtons();
    renderClocks();
  }

  function syncQuarterLengthButtons() {
    document.querySelectorAll('#quarterLengthSelector .seg-btn, #quarterLengthPills .seg-btn').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.mins) === state.quarterLengthMinutes);
    });
  }

  // =========================================================================
  // MODAL MANAGER (AUTO-PAUSES BOTH CLOCKS)
  // =========================================================================
  function openModal(modalEl) {
    if (state.activeModals.size === 0) {
      state.wasGameClockRunningBeforeModal = state.gameClockRunning;
      state.wasPlayClockRunningBeforeModal = state.playClockRunning;
      pauseGameClock();
      pausePlayClock();
    }
    state.activeModals.add(modalEl.id);
    modalEl.classList.add('active');
  }

  function closeModal(modalEl, resumePreviousClocks = true) {
    if (modalEl.classList.contains('active')) {
      modalEl.classList.remove('active');
      state.activeModals.delete(modalEl.id);
    }
    if (state.activeModals.size === 0 && resumePreviousClocks) {
      if (state.wasGameClockRunningBeforeModal && state.gameTimeRemaining > 0) startGameClock();
      if (state.wasPlayClockRunningBeforeModal && !state.playClockExpired) startPlayClock();
    }
  }

  // =========================================================================
  // FIELD & SCOREBOARD RENDERER
  // =========================================================================
  function renderFieldAndScoreboard() {
    dom.scoreHome.textContent = String(state.scoreHome);
    dom.scoreAway.textContent = String(state.scoreAway);
    dom.modalHomeScoreVal.textContent = String(state.scoreHome);
    dom.modalAwayScoreVal.textContent = String(state.scoreAway);

    const isHome = state.possession === 'home';
    dom.teamBlockHome.classList.toggle('is-offense', isHome);
    dom.teamBlockAway.classList.toggle('is-offense', !isHome);
    dom.badgeHome.textContent = isHome ? 'Offense' : 'Defense';
    dom.badgeAway.textContent = isHome ? 'Defense' : 'Offense';
    dom.driveIndicator.textContent = isHome ? 'Home Drive →' : '← Away Drive';
    dom.svgLosText.textContent = isHome ? 'LOS →' : '← LOS';

    const clampedBall = clamp(state.ballOn, 1, 99);
    const losX = 100 + clampedBall * 10;
    const gainYard = clamp(state.lineGain, 0, 100);
    const gainX = 100 + gainYard * 10;

    dom.svgLosGroup.setAttribute('transform', `translate(${losX}, 0)`);
    dom.svgFirstDownGroup.setAttribute('transform', `translate(${gainX}, 0)`);

    const zoneX = Math.min(losX, gainX);
    const zoneW = Math.max(0, Math.abs(gainX - losX));
    dom.svgToGoZone.setAttribute('x', String(zoneX));
    dom.svgToGoZone.setAttribute('width', String(zoneW));

    const yardsToGo = computeDistance();
    const isGoalToGo = (isHome && state.lineGain >= 100) || (!isHome && state.lineGain <= 0);
    const toGoLabel = isGoalToGo || yardsToGo <= 0 ? 'Goal' : String(yardsToGo);

    dom.downTag.textContent = `${ordinalDown(state.down)} & ${toGoLabel}`;
    dom.locTag.textContent = `${formatSpotLabel(clampedBall, state.possession)} · ${isHome ? 'Driving Right →' : '← Driving Left'}`;
    dom.btnOpenFourthDown.hidden = state.down !== 4;

    renderClocks();
  }

  // =========================================================================
  // CORE FOOTBALL RESOLUTION ENGINE
  // =========================================================================
  function switchPossession(newBallOn = null) {
    state.possession = state.possession === 'home' ? 'away' : 'home';
    if (newBallOn !== null) {
      state.ballOn = clamp(newBallOn, 1, 99);
    }
    resetFirstDownMarkers();
    renderFieldAndScoreboard();
  }

  function openDealPrompt(kicker, title, body) {
    dom.dealKicker.textContent = kicker;
    dom.dealTitle.textContent = title;
    dom.dealBody.textContent = body;
    openModal(dom.modalDeal);
  }

  function openFourthDownModal() {
    const isHome = state.possession === 'home';
    const yardsToGo = computeDistance();
    const isGoalToGo = (isHome && state.lineGain >= 100) || (!isHome && state.lineGain <= 0);
    const toGoLabel = isGoalToGo || yardsToGo <= 0 ? 'Goal' : String(yardsToGo);
    const fgTarget = getFGTargetDistance();

    dom.titleFourthDown.textContent = `4th & ${toGoLabel}`;
    dom.fourthDownDetail.textContent = `Ball on ${formatSpotLabel(state.ballOn, state.possession)} · Field Goal Target: ${fgTarget} Yards`;
    openModal(dom.modalFourthDown);
  }

  function applyPlayYardage(netYards, options = {}) {
    if (state.isCelebratingTD) return;
    const isHome = state.possession === 'home';
    const nextBallOn = isHome ? state.ballOn + netYards : state.ballOn - netYards;

    // 1. Safety Check
    if ((isHome && nextBallOn <= 0) || (!isHome && nextBallOn >= 100)) {
      sfx.buzzer();
      if (isHome) state.scoreAway += 2;
      else state.scoreHome += 2;
      state.ballOn = isHome ? 20 : 80;
      renderFieldAndScoreboard();
      setStatus(`Safety! ${isHome ? 'Away' : 'Home'} scores +2 points.`);
      openModal(dom.modalSafety);
      return;
    }

    // 2. Touchdown Check
    if ((isHome && nextBallOn >= 100) || (!isHome && nextBallOn <= 0)) {
      const scoringTeam = state.possession;
      if (isHome) state.scoreHome += 6;
      else state.scoreAway += 6;
      state.ballOn = isHome ? 99 : 1;
      renderFieldAndScoreboard();
      setStatus(`Touchdown ${teamLabel(scoringTeam)}! (+6)`);
      triggerScoreboardTD(scoringTeam, () => openTouchdownPhase1());
      return;
    }

    state.ballOn = clamp(nextBallOn, 1, 99);

    // 3. First Down Check
    const reachedFirstDown = isHome ? state.ballOn >= state.lineGain : state.ballOn <= state.lineGain;
    if (reachedFirstDown || options.autoFirstDown) {
      sfx.score();
      resetFirstDownMarkers();
      renderFieldAndScoreboard();
      setStatus(`${netYards >= 0 ? '+' : ''}${netYards} yds — 1st & 10 at ${formatSpotLabel(state.ballOn, state.possession)}.`);
      openDealPrompt(
        'First Down Achieved',
        '1st & 10',
        'Deal +7 cards to Offense and +5 cards to Defense. Hold unused cards (12-card maximum).'
      );
      return;
    }

    // 4. Down Progression
    if (state.down < 4) {
      state.down += 1;
      sfx.whistle();
      renderFieldAndScoreboard();
      setStatus(
        `${netYards >= 0 ? '+' : ''}${netYards} yds. ${ordinalDown(state.down)} & ${state.distance} at ${formatSpotLabel(
          state.ballOn,
          state.possession
        )}.`
      );

      // Automatically prompt Punt / Field Goal / Go For It on 4th down!
      if (state.down === 4) {
        openFourthDownModal();
      } else {
        startGameClock();
        resetPlayClock(true);
      }
    } else {
      sfx.buzzer();
      switchPossession();
      setStatus(`Turnover on downs! ${teamLabel(state.possession)} takes over.`);
      openDealPrompt(
        '4th Down Stop',
        'Turnover on Downs',
        'Offense stopped on 4th down. Deal 8 cards to the new Offense and 5 cards to Defense.'
      );
    }
  }

  function enforceOffensiveJokerPenalty() {
    sfx.score();
    const isHome = state.possession === 'home';
    state.ballOn = isHome ? Math.min(99, state.ballOn + 15) : Math.max(1, state.ballOn - 15);
    resetFirstDownMarkers();
    renderFieldAndScoreboard();
    setStatus(`King + Joker Penalty: +15 yds & 1st Down at ${formatSpotLabel(state.ballOn, state.possession)}.`);
    openDealPrompt(
      'King + Joker Penalty',
      '+15 Yards & 1st Down',
      '15-yard penalty enforced with an automatic 1st Down. Deal +7 cards to Offense and +5 cards to Defense.'
    );
  }

  // =========================================================================
  // FINAL 3 SECONDS (Q2 & Q4) + HAIL MARY DYNAMIC
  // =========================================================================
  function openFinalSecondsModal() {
    const periodName = state.quarter === 2 ? '1st Half (Q2)' : 'Regulation (Q4)';
    const fgTarget = getFGTargetDistance();
    const tdDist = getYardsToEndzone();
    dom.finalSecondsKicker.textContent = `0:03 Left in ${periodName}`;
    dom.finalSecondsDetail.textContent = `Ball on ${formatSpotLabel(state.ballOn, state.possession)} · FG Target: ${fgTarget} yds · Endzone: ${tdDist} yds away.`;
    openModal(dom.modalFinalSeconds);
  }

  function openHailMaryModal() {
    state.hailMaryOffenseCards = [];
    state.hailMaryDefenseCards = [];
    renderHailMaryUI();
    openModal(dom.modalHailMary);
  }

  function evaluateHailMary() {
    const target = getYardsToEndzone();
    const hasOffJoker = state.hailMaryOffenseCards.some((c) => c.type === 'joker');
    const hasOffQueen = state.hailMaryOffenseCards.some((c) => c.type === 'queen');
    const hasDefJoker = state.hailMaryDefenseCards.some((c) => c.type === 'joker');

    if (hasDefJoker) {
      return {
        outcome: 'int',
        text: 'Defense Joker — INTERCEPTED in the endzone!',
      };
    }

    if (hasOffJoker) {
      return {
        outcome: 'td',
        text: 'Offense Joker — MIRACLE HAIL MARY TOUCHDOWN!',
      };
    }

    let offRaw = 0;
    state.hailMaryOffenseCards.forEach((c) => {
      if (c.type === 'ace') offRaw += hasOffQueen ? 11 : 1;
      else offRaw += Number(c.val);
    });
    const offBomb = offRaw * 2;

    let defSum = 0;
    state.hailMaryDefenseCards.forEach((c) => {
      defSum += Number(c.val);
    });

    const net = offBomb - defSum;
    const isTD = state.hailMaryOffenseCards.length > 0 && net >= target;

    return {
      outcome: isTD ? 'td' : 'incomplete',
      net,
      text: `Off (${offRaw} × 2 = ${offBomb}) − Def (${defSum}) = ${net} yds (${isTD ? 'TOUCHDOWN!' : `Needs ${target} yds`})`,
    };
  }

  function renderHailMaryUI() {
    dom.hailMaryTargetText.textContent = `${getYardsToEndzone()} Yards`;
    dom.labelHMOffense.textContent = `Offense Bomb (${state.hailMaryOffenseCards.length}/3)`;
    dom.labelHMDefense.textContent = `Defense Prevent (${state.hailMaryDefenseCards.length}/2)`;

    renderCardTokens(dom.chipsHMOffense, state.hailMaryOffenseCards, (idx) => {
      state.hailMaryOffenseCards.splice(idx, 1);
      renderHailMaryUI();
    });
    renderCardTokens(dom.chipsHMDefense, state.hailMaryDefenseCards, (idx) => {
      state.hailMaryDefenseCards.splice(idx, 1);
      renderHailMaryUI();
    });

    const result = evaluateHailMary();
    dom.hailMaryMathText.textContent = result.text;
  }

  // =========================================================================
  // QUARTER END, HALFTIME & OVERTIME (TIED AFTER Q4 ONLY, 2:00 + COIN FLIP)
  // =========================================================================
  function handleQuarterExpired() {
    state.isFinalSecondsPlay = false;
    clearVictoryModalState();

    if (state.quarter === 2) {
      // Halftime
      dom.quarterEndKicker.textContent = 'End of 1st Half';
      dom.titleQuarterEnd.textContent = 'Halftime';
      dom.quarterEndBody.textContent =
        'Discard both hands and reshuffle the entire 54-card deck before the 2nd-half kickoff.';
      dom.btnConfirmQuarterEnd.textContent = 'Reshuffle & Start Q3 Kickoff';
      openModal(dom.modalQuarterEnd);
      return;
    }

    if (state.quarter >= 4) {
      if (state.scoreHome === state.scoreAway) {
        // Tied after Q4 (or still tied after OT) -> Overtime Coin Flip!
        openOvertimeCoinFlipModal();
      } else {
        // Not tied -> Game Final Victory Celebration!
        const winnerTeam = state.scoreHome > state.scoreAway ? 'home' : 'away';
        const winnerName = teamLabel(winnerTeam);
        dom.quarterEndCard.classList.add('is-victory', winnerTeam === 'home' ? 'victory-home' : 'victory-away');
        dom.victoryTrophyWrap.hidden = false;
        dom.victoryScoreStrip.hidden = false;
        dom.victoryFinalHome.textContent = String(state.scoreHome);
        dom.victoryFinalAway.textContent = String(state.scoreAway);
        dom.victoryColHome.classList.toggle('is-winner', winnerTeam === 'home');
        dom.victoryColAway.classList.toggle('is-winner', winnerTeam === 'away');

        dom.quarterEndKicker.textContent = 'Game Final · Champions';
        dom.titleQuarterEnd.textContent = `${winnerName} Wins!`;
        dom.quarterEndBody.textContent = `${winnerName} claims the victory in Deck Football!`;
        dom.btnConfirmQuarterEnd.textContent = 'Start New Game';

        sfx.victory();
        openModal(dom.modalQuarterEnd);
        launchConfetti('victory', winnerTeam);
      }
      return;
    }

    // End of Q1 or Q3
    dom.quarterEndKicker.textContent = `End of Q${state.quarter}`;
    dom.titleQuarterEnd.textContent = `Quarter ${state.quarter} Complete`;
    dom.quarterEndBody.textContent = `Begin Quarter ${state.quarter + 1} with current hands and ball spot.`;
    dom.btnConfirmQuarterEnd.textContent = `Start Q${state.quarter + 1}`;
    openModal(dom.modalQuarterEnd);
  }

  function openOvertimeCoinFlipModal() {
    state.otCoinWinner = null;
    dom.otCoinDisc.textContent = 'COIN';
    dom.otCoinDisc.classList.remove('is-flipping');
    dom.otStatusText.textContent = `Tied ${state.scoreHome}–${state.scoreAway}! Flip the coin to decide first possession for the 2:00 Overtime period.`;
    dom.btnFlipOTCoin.hidden = false;
    dom.otChoiceRow.hidden = true;
    openModal(dom.modalOvertime);
  }

  function startOvertimeWithReceiver(receivingTeam) {
    closeModal(dom.modalOvertime, false);
    state.quarter += 1;
    state.gameTimeRemaining = OT_DURATION_SECONDS; // Strictly 2:00
    resetPlayClock(false);
    renderFieldAndScoreboard();
    openKickoffModal('overtime', receivingTeam);
  }

  // =========================================================================
  // PLAY CALCULATOR (v4 ALWAYS ACTIVE; OFF ACE = 1 WITHOUT QUEEN, 11 WITH Q)
  // =========================================================================
  function evaluatePlayCalculator() {
    const hasOffJoker = state.offenseCards.some((c) => c.type === 'joker');
    const hasOffKing = state.offenseCards.some((c) => c.type === 'king');
    const hasOffQueen = state.offenseCards.some((c) => c.type === 'queen');

    const hasDefJoker = state.defenseCards.some((c) => c.type === 'joker');
    const hasDefKing = state.defenseCards.some((c) => c.type === 'king');
    const hasDefAce = state.defenseCards.some((c) => c.type === 'ace');

    // Offense King + Joker -> Offensive Penalty (+15y & Auto 1st Down)
    if (hasOffJoker && hasOffKing) {
      return {
        outcome: 'penalty',
        net: 15,
        displayText: '+15 Yds & 1st Down',
        subtext: 'Offense King + Joker played! Enforce +15y penalty & automatic 1st Down.',
        ctaText: 'Enforce +15y Penalty & 1st Down',
      };
    }

    // Defense King + Joker -> Turnover unless Offense plays King
    if (hasDefJoker && hasDefKing && !hasOffKing) {
      return {
        outcome: 'turnover',
        net: 0,
        displayText: 'Turnover',
        subtext: 'Defense King + Joker! No Offensive King to protect the ball.',
        ctaText: 'Confirm Turnover',
      };
    }

    // Offense sum (v4: Ace & Solo Joker = 11 with Queen, else 1)
    let offSum = 0;
    state.offenseCards.forEach((c) => {
      if (c.type === 'ace' || c.type === 'joker') {
        offSum += hasOffQueen ? 11 : 1;
      } else {
        offSum += Number(c.val);
      }
    });

    // Defense sum (v4: Ace & Solo Joker = 11)
    let defSum = 0;
    state.defenseCards.forEach((c) => {
      if (c.type === 'ace' || c.type === 'joker') {
        defSum += 11;
      } else {
        defSum += Number(c.val);
      }
    });

    const rawDiff = offSum - defSum;
    let net = rawDiff;
    const defSackCap = hasDefAce || hasDefJoker ? -10 : -5;
    if (rawDiff < 0) {
      net = Math.max(defSackCap, rawDiff);
    }

    let subtext = `Offense ${offSum} − Defense ${defSum} = ${net >= 0 ? '+' : ''}${net} yds`;
    if (hasDefJoker && hasDefKing && hasOffKing) {
      subtext = `Turnover blocked by Offense K! ${subtext}`;
    } else if (rawDiff < 0 && net !== rawDiff) {
      subtext += ` (Clamped at ${defSackCap}y)`;
    }

    return {
      outcome: 'yards',
      net,
      displayText: `${net >= 0 ? '+' : ''}${net} Yards`,
      subtext,
      ctaText: 'Apply Play to Field',
    };
  }

  function renderPlayCalcUI() {
    dom.labelOffenseCount.textContent = `Offense (${state.offenseCards.length}/${PLAY_CARD_LIMIT})`;
    dom.labelDefenseCount.textContent = `Defense (${state.defenseCards.length}/${PLAY_CARD_LIMIT})`;

    renderCardTokens(dom.chipsOffense, state.offenseCards, (idx) => {
      state.offenseCards.splice(idx, 1);
      renderPlayCalcUI();
    });
    renderCardTokens(dom.chipsDefense, state.defenseCards, (idx) => {
      state.defenseCards.splice(idx, 1);
      renderPlayCalcUI();
    });

    const result = evaluatePlayCalculator();
    dom.calcDiffText.textContent = result.displayText;
    dom.calcDiffText.classList.toggle('is-negative', result.outcome === 'turnover' || result.net < 0);
    dom.calcDiffText.classList.toggle('is-positive', result.outcome === 'penalty' || result.net > 0);
    dom.calcOutcomeSubtext.textContent = result.subtext;
    dom.btnApplyPlayCalc.textContent = result.ctaText;
    dom.btnApplyPlayCalc.className =
      result.outcome === 'penalty'
        ? 'btn-amber-full'
        : result.outcome === 'turnover'
          ? 'btn-danger-full'
          : 'btn-primary-full';
  }

  function renderCardTokens(container, cards, onRemove) {
    container.innerHTML = '';
    if (cards.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'selected-empty';
      empty.textContent = 'None';
      container.appendChild(empty);
      return;
    }
    cards.forEach((card, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'card-token';
      btn.textContent = `${card.label} ×`;
      btn.addEventListener('click', () => onRemove(idx));
      container.appendChild(btn);
    });
  }

  // =========================================================================
  // PUNT MODAL LOGIC
  // =========================================================================
  function getPuntKickYards(card) {
    if (!card) return 0;
    if (card.val === 'JOKER') return null;
    if (card.label.includes('Face')) return 45;
    if (card.label.includes('Ace')) return 50;
    return Number(card.val) * 5;
  }

  function openPuntModal(isSafety = false) {
    state.isSafetyFreeKick = isSafety;
    state.puntKickCard = null;
    state.puntReturnCard = null;

    if (isSafety) {
      dom.puntTitle.textContent = 'Safety Free Kick (Own 20)';
      dom.puntDesc.textContent = 'Conceding team kicks from own 20 using punt rules.';
    } else {
      dom.puntTitle.textContent = '4th Down Punt';
      dom.puntDesc.textContent = 'Val × 5y, Face = 45y, Ace = 50y. Defense plays 1 return card.';
    }

    renderPuntUI();
    openModal(dom.modalPunt);
  }

  function renderPuntUI() {
    renderCardTokens(dom.chipsPuntKick, state.puntKickCard ? [state.puntKickCard] : [], () => {
      state.puntKickCard = null;
      renderPuntUI();
    });
    renderCardTokens(dom.chipsPuntReturn, state.puntReturnCard ? [state.puntReturnCard] : [], () => {
      state.puntReturnCard = null;
      renderPuntUI();
    });

    if (state.puntKickCard && state.puntKickCard.val === 'JOKER') {
      dom.puntNetText.textContent = 'Muffed Punt!';
      dom.puntNetText.className = 'result-value-md is-negative';
      dom.puntLandingPreview.textContent = 'Joker drawn — immediate turnover at LOS.';
      return;
    }

    const kickYards = getPuntKickYards(state.puntKickCard);
    const returnYards = state.puntReturnCard ? Number(state.puntReturnCard.val) : 0;
    const net = Math.max(0, kickYards - returnYards);

    dom.puntNetText.textContent = `${net} Net Yards`;
    dom.puntNetText.className = 'result-value-md';

    if (!state.puntKickCard) {
      dom.puntLandingPreview.textContent = 'Select a punt card (defaults to 35y if none picked).';
      return;
    }

    const isHome = state.possession === 'home';
    const rawLanding = isHome ? state.ballOn + net : state.ballOn - net;
    const isTouchback = (isHome && rawLanding >= 100) || (!isHome && rawLanding <= 0);
    const nextPoss = isHome ? 'away' : 'home';

    dom.puntLandingPreview.textContent = isTouchback
      ? `Touchback! ${teamLabel(nextPoss)} starts at Own 20.`
      : `Kick ${kickYards}y − Ret ${returnYards}y · ${teamLabel(nextPoss)} at ${formatSpotLabel(clamp(rawLanding, 1, 99), nextPoss)}.`;
  }

  // =========================================================================
  // FIELD GOAL MODAL LOGIC (MANUAL PHYSICAL CARDS ONLY)
  // =========================================================================
  function openFieldGoalModal() {
    state.fgOffenseCards = [];
    state.fgDefenseCards = [];
    renderFGUI();
    openModal(dom.modalFG);
  }

  function renderFGUI() {
    dom.labelFGOffense.textContent = `Offense Kick (${state.fgOffenseCards.length}/8)`;
    dom.labelFGDefense.textContent = `Defense Block (${state.fgDefenseCards.length}/2)`;

    renderCardTokens(dom.chipsFGOffense, state.fgOffenseCards, (idx) => {
      state.fgOffenseCards.splice(idx, 1);
      renderFGUI();
    });
    renderCardTokens(dom.chipsFGDefense, state.fgDefenseCards, (idx) => {
      state.fgDefenseCards.splice(idx, 1);
      renderFGUI();
    });

    const target = getFGTargetDistance();
    dom.fgTargetText.textContent = `${target} Yards`;

    const offSum = state.fgOffenseCards.reduce((sum, c) => sum + Number(c.val), 0);
    const isBlocked = state.fgDefenseCards.some((c) => c.val === 'JOKER');
    const defSum = state.fgDefenseCards.reduce((sum, c) => (c.val === 'JOKER' ? sum : sum + Number(c.val)), 0);
    const net = offSum - defSum;

    dom.fgMathText.textContent = isBlocked
      ? `Offense (${offSum}) · Blocked by Defense Joker!`
      : `Offense (${offSum}) − Defense (${defSum}) = ${net} Net (${net > target ? 'GOOD' : `Needs > ${target}`})`;
  }

  // =========================================================================
  // TOUCHDOWN 3-PHASE WORKFLOW & UNIFIED KICKOFF / PHYSICAL RETURN
  // =========================================================================
  function openTouchdownPhase1() {
    dom.tdChoiceDetail.textContent = `${teamLabel(state.possession)} scored! Choose your Point After Touchdown attempt:`;
    openModal(dom.modalTDChoice);
  }

  function openTouchdownPhase2(points) {
    state.pendingPATPoints = points;
    closeModal(dom.modalTDChoice, false);
    dom.titlePATResult.textContent = points === 1 ? '1-Point Kick' : '2-Point Try';
    dom.patResultPrompt.textContent =
      points === 1 ? 'Was the flipped card 4 or higher (Good)?' : 'Did Offense beat Defense on the 1-card snap?';
    openModal(dom.modalPATResult);
  }

  function openOpeningCoinFlipModal() {
    state.openingCoinWinner = null;
    dom.openingCoinDisc.textContent = 'COIN';
    dom.openingCoinDisc.classList.remove('is-flipping');
    dom.openingCoinStatus.innerHTML =
      '<strong class="away-text">Away</strong> calls the coin toss in the air. Pick Heads or Tails to flip:';
    dom.openingCallRow.hidden = false;
    dom.openingChoiceRow.hidden = true;
    openModal(dom.modalOpeningCoinFlip);
  }

  function resolveOpeningCoinCall(awayCall) {
    dom.openingCallRow.hidden = true;
    dom.openingCoinDisc.classList.remove('is-flipping');
    void dom.openingCoinDisc.offsetWidth;
    dom.openingCoinDisc.classList.add('is-flipping');
    dom.openingCoinDisc.textContent = '...';
    dom.openingCoinStatus.textContent = `Away called ${awayCall}! Flipping coin...`;
    sfx.whistle();

    setTimeout(() => {
      const flipResult = Math.random() < 0.5 ? 'Heads' : 'Tails';
      const awayWon = flipResult === awayCall;
      state.openingCoinWinner = awayWon ? 'away' : 'home';
      dom.openingCoinDisc.textContent = flipResult.toUpperCase();
      dom.openingCoinStatus.textContent = `It's ${flipResult}! ${teamLabel(state.openingCoinWinner)} wins the toss. Choose to Receive First or Defer to the 2nd Half:`;
      dom.openingChoiceRow.hidden = false;
    }, 650);
  }

  function openKickoffModal(context, receivingTeam) {
    state.kickoffContext = context;
    state.kickoffReceivingTeam = receivingTeam;

    if (context === 'opening') {
      dom.kickoffKicker.textContent = 'Start of Game';
      dom.titleKickoff.textContent = 'Opening Kickoff';
    } else if (context === 'halftime') {
      dom.kickoffKicker.textContent = 'Start of 2nd Half (Q3)';
      dom.titleKickoff.textContent = '2nd Half Kickoff';
    } else if (context === 'overtime') {
      dom.kickoffKicker.textContent = 'Overtime (2:00)';
      dom.titleKickoff.textContent = 'Overtime Kickoff';
    } else {
      dom.kickoffKicker.textContent = 'Step 3 of 3 · Kickoff';
      dom.titleKickoff.textContent = 'Kickoff to Opponent';
    }

    updateKickoffCopy();
    openModal(dom.modalKickoff);
  }

  function updateKickoffCopy() {
    dom.kickoffDetail.textContent = `${teamLabel(state.kickoffReceivingTeam)} receives the kickoff. Choose Touchback (Own 25) or input 4 drawn return cards.`;
  }

  function finishKickoffPlacement(yardSpot, kickerTitle, bodyText) {
    const rec = state.kickoffReceivingTeam;
    if (state.kickoffContext === 'opening') {
      state.openingReceiver = rec;
    }
    state.possession = rec;
    state.ballOn = clamp(yardSpot, 1, 99);
    resetFirstDownMarkers();
    renderFieldAndScoreboard();
    setStatus(bodyText);
    openDealPrompt(
      kickerTitle,
      `${teamLabel(rec)} · 1st & 10`,
      `${bodyText} Deal 8 cards to ${teamLabel(rec)} (Offense) and 5 cards to Defense.`
    );
  }

  function renderKickReturnUI() {
    dom.labelKickReturnCount.textContent = `Return Cards (${state.kickReturnCards.length}/4)`;
    renderCardTokens(dom.chipsKickReturn, state.kickReturnCards, (idx) => {
      state.kickReturnCards.splice(idx, 1);
      renderKickReturnUI();
    });

    const total = state.kickReturnCards.reduce((sum, c) => sum + Number(c.val), 0);
    dom.kickReturnTotalText.textContent = `${total} Yards`;

    if (total === 0) {
      dom.kickReturnSpotText.textContent = 'Tap up to 4 physical cards drawn from the deck.';
    } else {
      const rec = state.kickoffReceivingTeam;
      const spotYard = rec === 'home' ? clamp(total, 1, 99) : clamp(100 - total, 1, 99);
      dom.kickReturnSpotText.textContent = `${teamLabel(rec)} will start 1st & 10 at ${formatSpotLabel(spotYard, rec)}.`;
    }
  }

  // =========================================================================
  // NEW GAME RESET HELPER
  // =========================================================================
  function startFreshGame(mins) {
    stopConfetti();
    clearVictoryModalState();
    pauseGameClock();
    pausePlayClock();

    state.scoreHome = 0;
    state.scoreAway = 0;
    state.possession = 'home';
    state.openingReceiver = 'home';
    state.ballOn = 25;
    state.down = 1;
    state.lineGain = 35;
    state.distance = 10;
    state.quarter = 1;
    state.quarterLengthMinutes = mins;
    state.gameTimeRemaining = mins * 60;
    state.playClockTime = PLAY_CLOCK_DEFAULT;
    state.playClockExpired = false;
    state.finalSecondsWarnedQ2 = false;
    state.finalSecondsWarnedQ4 = false;
    state.isFinalSecondsPlay = false;
    state.isCelebratingTD = false;

    syncQuarterLengthButtons();
    renderFieldAndScoreboard();
    openOpeningCoinFlipModal();
  }

  // =========================================================================
  // EVENT LISTENERS
  // =========================================================================
  function bindEvents() {
    // Sound toggle (speaker emoji)
    $('btnToggleSound').addEventListener('click', (e) => {
      state.soundEnabled = !state.soundEnabled;
      const label = state.soundEnabled ? 'Sound On' : 'Sound Off';
      e.currentTarget.setAttribute('aria-pressed', String(state.soundEnabled));
      e.currentTarget.setAttribute('aria-label', label);
      e.currentTarget.title = label;
      e.currentTarget.textContent = state.soundEnabled ? '🔊' : '🔇';
    });

    // Quarter length segmented control (Header)
    document.querySelectorAll('#quarterLengthSelector .seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mins = Number(btn.dataset.mins);
        setQuarterLength(mins, true);
        setStatus(`Quarter length set to ${mins} minutes.`);
      });
    });

    // SINGLE Unified Timeout / Start Clock button
    dom.btnTimeoutToggle.addEventListener('click', () => {
      const anyRunning = state.gameClockRunning || state.playClockRunning;
      if (anyRunning) {
        pauseGameClock();
        pausePlayClock();
        setStatus('Timeout called — clocks paused.');
      } else {
        startGameClock();
        if (!state.playClockExpired) {
          if (state.playClockTime > 0 && state.playClockTime < PLAY_CLOCK_DEFAULT) {
            startPlayClock();
          } else {
            resetPlayClock(true);
          }
        }
        setStatus('Clocks running.');
      }
    });

    dom.btnResetPlayClock.addEventListener('click', () => {
      resetPlayClock(state.gameClockRunning);
      setStatus('Play clock reset to :30.');
    });

    // Contextual 4th Down trigger (only visible on 4th down)
    dom.btnOpenFourthDown.addEventListener('click', () => openFourthDownModal());

    // Situation Actions (Turnover & 1st & 10)
    $('btnTriggerTurnover').addEventListener('click', () => {
      sfx.buzzer();
      switchPossession();
      setStatus(`Turnover! ${teamLabel(state.possession)} takes over.`);
      openDealPrompt(
        'Change of Possession',
        'Turnover',
        'Defense takes over at the spot. Deal 8 cards to the new Offense and 5 cards to Defense.'
      );
    });

    $('btnForceFirstDown').addEventListener('click', () => {
      sfx.score();
      resetFirstDownMarkers();
      renderFieldAndScoreboard();
      setStatus(`Chains reset to 1st & 10 at ${formatSpotLabel(state.ballOn, state.possession)}.`);
      openDealPrompt('First Down Reset', '1st & 10', 'Deal +7 cards to Offense and +5 cards to Defense (12-card max).');
    });

    // Quick Yardage (-10 to +15)
    document.querySelectorAll('.btn-yard').forEach((btn) => {
      btn.addEventListener('click', () => applyPlayYardage(Number(btn.dataset.yard)));
    });

    // ================= PLAY CALC MODAL =================
    $('btnOpenPlayCalc').addEventListener('click', () => {
      state.offenseCards = [];
      state.defenseCards = [];
      renderPlayCalcUI();
      openModal(dom.modalPlayCalc);
    });
    $('btnClosePlayCalc').addEventListener('click', () => closeModal(dom.modalPlayCalc, true));

    document.querySelectorAll('#keysOffense .btn-key-sm').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (state.offenseCards.length >= PLAY_CARD_LIMIT) return;
        state.offenseCards.push({
          type: btn.dataset.type,
          val: btn.dataset.val,
          label: btn.textContent,
        });
        renderPlayCalcUI();
      });
    });

    document.querySelectorAll('#keysDefense .btn-key-sm').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (state.defenseCards.length >= PLAY_CARD_LIMIT) return;
        state.defenseCards.push({
          type: btn.dataset.type,
          val: btn.dataset.val,
          label: btn.textContent,
        });
        renderPlayCalcUI();
      });
    });

    $('btnClearOffense').addEventListener('click', () => {
      state.offenseCards = [];
      renderPlayCalcUI();
    });
    $('btnClearDefense').addEventListener('click', () => {
      state.defenseCards = [];
      renderPlayCalcUI();
    });

    dom.btnApplyPlayCalc.addEventListener('click', () => {
      const result = evaluatePlayCalculator();
      closeModal(dom.modalPlayCalc, false);

      if (result.outcome === 'penalty') {
        enforceOffensiveJokerPenalty();
        return;
      }
      if (result.outcome === 'turnover') {
        sfx.buzzer();
        switchPossession();
        setStatus(`Defense King + Joker Turnover! ${teamLabel(state.possession)} takes over.`);
        openDealPrompt(
          'King + Joker Steal',
          'Turnover',
          'Defense stole the ball! Deal 8 cards to the new Offense and 5 cards to Defense.'
        );
        return;
      }
      applyPlayYardage(result.net);
    });

    // ================= 4TH DOWN DECISION MODAL =================
    $('btnFourthGoForIt').addEventListener('click', () => {
      closeModal(dom.modalFourthDown, false);
      startGameClock();
      resetPlayClock(true);
      setStatus(`Going for it on 4th & ${state.distance}!`);
    });
    $('btnFourthPunt').addEventListener('click', () => {
      closeModal(dom.modalFourthDown, false);
      openPuntModal(false);
    });
    $('btnFourthFG').addEventListener('click', () => {
      closeModal(dom.modalFourthDown, false);
      openFieldGoalModal();
    });

    // ================= FINAL 3 SECONDS & HAIL MARY =================
    $('btnFinalSecondsFG').addEventListener('click', () => {
      state.isFinalSecondsPlay = true;
      closeModal(dom.modalFinalSeconds, false);
      openFieldGoalModal();
    });
    $('btnFinalSecondsHailMary').addEventListener('click', () => {
      state.isFinalSecondsPlay = true;
      closeModal(dom.modalFinalSeconds, false);
      openHailMaryModal();
    });
    $('btnFinalSecondsNormal').addEventListener('click', () => {
      state.isFinalSecondsPlay = false;
      closeModal(dom.modalFinalSeconds, false);
      startGameClock();
      startPlayClock();
    });

    $('btnCloseHailMary').addEventListener('click', () => {
      state.isFinalSecondsPlay = false;
      closeModal(dom.modalHailMary, true);
    });

    document.querySelectorAll('#keysHMOffense .btn-key-sm').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (state.hailMaryOffenseCards.length >= 3) return;
        state.hailMaryOffenseCards.push({ type: btn.dataset.type, val: btn.dataset.val, label: btn.textContent });
        renderHailMaryUI();
      });
    });

    document.querySelectorAll('#keysHMDefense .btn-key-sm').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (state.hailMaryDefenseCards.length >= 2) return;
        state.hailMaryDefenseCards.push({ type: btn.dataset.type, val: btn.dataset.val, label: btn.textContent });
        renderHailMaryUI();
      });
    });

    $('btnClearHMOffense').addEventListener('click', () => {
      state.hailMaryOffenseCards = [];
      renderHailMaryUI();
    });
    $('btnClearHMDefense').addEventListener('click', () => {
      state.hailMaryDefenseCards = [];
      renderHailMaryUI();
    });

    $('btnResolveHailMary').addEventListener('click', () => {
      const result = evaluateHailMary();
      closeModal(dom.modalHailMary, false);
      state.gameTimeRemaining = 0; // Final play of the half/game expires the clock
      renderClocks();

      if (result.outcome === 'td') {
        const scoringTeam = state.possession;
        if (scoringTeam === 'home') state.scoreHome += 6;
        else state.scoreAway += 6;
        state.ballOn = scoringTeam === 'home' ? 99 : 1;
        renderFieldAndScoreboard();
        setStatus(`HAIL MARY TOUCHDOWN! ${teamLabel(scoringTeam)} scores at the buzzer (+6)!`);
        triggerScoreboardTD(scoringTeam, () => openTouchdownPhase1());
      } else {
        sfx.buzzer();
        const msg =
          result.outcome === 'int'
            ? 'Hail Mary INTERCEPTED by Defense Joker as time expires!'
            : 'Hail Mary batted down incomplete as time expires!';
        setStatus(msg);
        handleQuarterExpired();
      }
    });

    // ================= PUNT MODAL =================
    $('btnClosePunt').addEventListener('click', () => closeModal(dom.modalPunt, true));

    $('btnPuntDrawDeck').addEventListener('click', () => {
      const isJoker = Math.random() < 2 / 54;
      if (isJoker) {
        state.puntKickCard = { val: 'JOKER', label: 'Joker (Muff)' };
      } else {
        const options = [
          { val: 2, label: '2 (10y)' },
          { val: 3, label: '3 (15y)' },
          { val: 4, label: '4 (20y)' },
          { val: 5, label: '5 (25y)' },
          { val: 6, label: '6 (30y)' },
          { val: 7, label: '7 (35y)' },
          { val: 8, label: '8 (40y)' },
          { val: 9, label: '9 (45y)' },
          { val: 10, label: '10 (50y)' },
          { val: 10, label: 'Face (45y)' },
          { val: 11, label: 'Ace (50y)' },
        ];
        state.puntKickCard = options[Math.floor(Math.random() * options.length)];
      }
      renderPuntUI();
    });

    document.querySelectorAll('#keysPuntKick .btn-key-sm').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.puntKickCard = { val: btn.dataset.val, label: btn.dataset.label };
        renderPuntUI();
      });
    });

    document.querySelectorAll('#keysPuntReturn .btn-key-sm').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.puntReturnCard = { val: btn.dataset.val, label: btn.dataset.label };
        renderPuntUI();
      });
    });

    $('btnClearPuntReturn').addEventListener('click', () => {
      state.puntReturnCard = null;
      renderPuntUI();
    });

    $('btnExecutePunt').addEventListener('click', () => {
      closeModal(dom.modalPunt, false);

      if (state.puntKickCard && state.puntKickCard.val === 'JOKER') {
        sfx.buzzer();
        switchPossession();
        setStatus('Muffed punt! Joker drawn — turnover at LOS.');
        openDealPrompt('Muffed Punt', 'Turnover at Spot', 'Deal 8 cards to the new Offense and 5 cards to Defense.');
        return;
      }

      const kickYards = state.puntKickCard ? getPuntKickYards(state.puntKickCard) : 35;
      const returnYards = state.puntReturnCard ? Number(state.puntReturnCard.val) : 0;
      const net = Math.max(0, kickYards - returnYards);
      const isHome = state.possession === 'home';

      let landing = isHome ? state.ballOn + net : state.ballOn - net;
      let touchback = false;
      if (isHome && landing >= 100) {
        landing = 80;
        touchback = true;
      } else if (!isHome && landing <= 0) {
        landing = 20;
        touchback = true;
      }

      sfx.whistle();
      switchPossession(landing);
      const detail = touchback
        ? 'Punt touchback to Own 20.'
        : `Punt netted ${net} yds. Ball at ${formatSpotLabel(state.ballOn, state.possession)}.`;
      setStatus(detail);
      openDealPrompt(
        touchback ? 'Punt Touchback' : 'Punt Resolved',
        touchback ? 'Touchback (Own 20)' : 'Change of Possession',
        `${detail} Deal 8 cards to new Offense and 5 cards to Defense.`
      );
    });

    // ================= FIELD GOAL MODAL =================
    $('btnCloseFG').addEventListener('click', () => {
      state.isFinalSecondsPlay = false;
      closeModal(dom.modalFG, true);
    });

    $('btnClearFGOffense').addEventListener('click', () => {
      state.fgOffenseCards = [];
      renderFGUI();
    });
    $('btnClearFGDefense').addEventListener('click', () => {
      state.fgDefenseCards = [];
      renderFGUI();
    });

    document.querySelectorAll('#keysFGOffense .btn-key-sm').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (state.fgOffenseCards.length >= 8) return;
        state.fgOffenseCards.push({ val: btn.dataset.val, label: btn.dataset.label });
        renderFGUI();
      });
    });

    document.querySelectorAll('#keysFGDefense .btn-key-sm').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (state.fgDefenseCards.length >= 2) return;
        state.fgDefenseCards.push({ val: btn.dataset.val, label: btn.dataset.label });
        renderFGUI();
      });
    });

    $('btnResolveFG').addEventListener('click', () => {
      closeModal(dom.modalFG, false);
      const isHome = state.possession === 'home';
      const target = getFGTargetDistance();
      const offSum = state.fgOffenseCards.reduce((sum, c) => sum + Number(c.val), 0);
      const isBlocked = state.fgDefenseCards.some((c) => c.val === 'JOKER');
      const defSum = state.fgDefenseCards.reduce((sum, c) => (c.val === 'JOKER' ? sum : sum + Number(c.val)), 0);
      const net = offSum - defSum;

      if (state.isFinalSecondsPlay) {
        state.gameTimeRemaining = 0;
        renderClocks();
      }

      if (!isBlocked && net > target) {
        sfx.score();
        if (isHome) state.scoreHome += 3;
        else state.scoreAway += 3;
        renderFieldAndScoreboard();
        dom.fgMadeDetail.textContent = `${teamLabel(state.possession)} scores +3! Net ${net} yds cleared the ${target}-yard target.`;
        $('btnFGProceedKickoff').textContent = state.isFinalSecondsPlay ? 'End Half / Regulation' : 'Proceed to Kickoff';
        setStatus(`Field Goal Good (+3) from ${target} yards.`);
        openModal(dom.modalFGMade);
      } else {
        sfx.buzzer();
        dom.fgMissedDetail.textContent = isBlocked
          ? 'Kick blocked by Defense Joker!'
          : `Kick came up short (${net} net yds; needed > ${target}).`;
        $('btnConfirmFGMissed').textContent = state.isFinalSecondsPlay ? 'End Half / Regulation' : 'Switch Possession & Deal';
        setStatus(isBlocked ? 'Field Goal blocked by Joker!' : `Field Goal missed (${net} vs ${target} yds).`);
        openModal(dom.modalFGMissed);
      }
    });

    $('btnFGProceedKickoff').addEventListener('click', () => {
      closeModal(dom.modalFGMade, false);
      if (state.isFinalSecondsPlay) {
        handleQuarterExpired();
      } else {
        const receiving = state.possession === 'home' ? 'away' : 'home';
        openKickoffModal('score', receiving);
      }
    });

    $('btnConfirmFGMissed').addEventListener('click', () => {
      closeModal(dom.modalFGMissed, false);
      if (state.isFinalSecondsPlay) {
        handleQuarterExpired();
      } else {
        switchPossession();
        openDealPrompt(
          'Missed Field Goal',
          'Change of Possession',
          `Defense takes over at ${formatSpotLabel(state.ballOn, state.possession)}. Deal 8 cards to new Offense and 5 cards to Defense.`
        );
      }
    });

    // ================= 3-PHASE TOUCHDOWN FLOW =================
    $('btnSelectPAT1').addEventListener('click', () => openTouchdownPhase2(1));
    $('btnSelectPAT2').addEventListener('click', () => openTouchdownPhase2(2));

    function finishPATPhase(succeeded) {
      closeModal(dom.modalPATResult, false);
      if (succeeded) {
        sfx.score();
        if (state.possession === 'home') state.scoreHome += state.pendingPATPoints;
        else state.scoreAway += state.pendingPATPoints;
        renderFieldAndScoreboard();
        setStatus(`PAT Good (+${state.pendingPATPoints})!`);
      } else {
        sfx.buzzer();
        setStatus('PAT failed.');
      }

      if (state.isFinalSecondsPlay || state.gameTimeRemaining <= 0) {
        handleQuarterExpired();
      } else {
        const receiving = state.possession === 'home' ? 'away' : 'home';
        openKickoffModal('score', receiving);
      }
    }

    $('btnConfirmPATSuccess').addEventListener('click', () => finishPATPhase(true));
    $('btnConfirmPATFail').addEventListener('click', () => finishPATPhase(false));

    // ================= OPENING COIN FLIP =================
    $('btnCallHeads').addEventListener('click', () => resolveOpeningCoinCall('Heads'));
    $('btnCallTails').addEventListener('click', () => resolveOpeningCoinCall('Tails'));

    $('btnOpeningReceive').addEventListener('click', () => {
      const winner = state.openingCoinWinner || 'away';
      closeModal(dom.modalOpeningCoinFlip, false);
      openKickoffModal('opening', winner);
    });

    $('btnOpeningDefer').addEventListener('click', () => {
      const winner = state.openingCoinWinner || 'away';
      const receiver = winner === 'home' ? 'away' : 'home';
      closeModal(dom.modalOpeningCoinFlip, false);
      openKickoffModal('opening', receiver);
    });

    // ================= KICKOFF & PHYSICAL 4-CARD RETURN =================
    $('btnKickoffTouchback').addEventListener('click', () => {
      closeModal(dom.modalKickoff, false);
      const rec = state.kickoffReceivingTeam;
      const spot = rec === 'home' ? 25 : 75;
      finishKickoffPlacement(spot, 'Touchback', `Touchback! ${teamLabel(rec)} starts at Own 25.`);
    });

    $('btnKickoffReturn').addEventListener('click', () => {
      closeModal(dom.modalKickoff, false);
      state.kickReturnCards = [];
      dom.kickReturnSubtitle.textContent = `${teamLabel(state.kickoffReceivingTeam)} return · Tap up to 4 physical cards drawn`;
      renderKickReturnUI();
      openModal(dom.modalKickReturn);
    });

    $('btnCloseKickReturn').addEventListener('click', () => {
      closeModal(dom.modalKickReturn, false);
      openModal(dom.modalKickoff);
    });

    document.querySelectorAll('#keysKickReturn .btn-key-sm').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (state.kickReturnCards.length >= 4) return;
        state.kickReturnCards.push({ val: btn.dataset.val, label: btn.dataset.label });
        renderKickReturnUI();
      });
    });

    $('btnClearKickReturn').addEventListener('click', () => {
      state.kickReturnCards = [];
      renderKickReturnUI();
    });

    $('btnApplyKickReturn').addEventListener('click', () => {
      const total = state.kickReturnCards.reduce((sum, c) => sum + Number(c.val), 0);
      if (total <= 0) return;
      closeModal(dom.modalKickReturn, false);
      const rec = state.kickoffReceivingTeam;
      const spot = rec === 'home' ? clamp(total, 1, 99) : clamp(100 - total, 1, 99);
      finishKickoffPlacement(
        spot,
        'Kick Return',
        `Returned ${total} yards! ${teamLabel(rec)} starts at ${formatSpotLabel(spot, rec)}.`
      );
    });

    // ================= OVERTIME COIN FLIP =================
    $('btnFlipOTCoin').addEventListener('click', () => {
      dom.btnFlipOTCoin.hidden = true;
      dom.otCoinDisc.classList.remove('is-flipping');
      void dom.otCoinDisc.offsetWidth; // Reflow to restart animation
      dom.otCoinDisc.classList.add('is-flipping');
      sfx.whistle();

      setTimeout(() => {
        const homeWins = Math.random() < 0.5;
        state.otCoinWinner = homeWins ? 'home' : 'away';
        dom.otCoinDisc.textContent = homeWins ? 'HOME' : 'AWAY';
        dom.otStatusText.textContent = `${teamLabel(state.otCoinWinner)} wins the toss! Choose to Receive First or Defer.`;
        dom.otChoiceRow.hidden = false;
      }, 650);
    });

    $('btnOTReceive').addEventListener('click', () => {
      startOvertimeWithReceiver(state.otCoinWinner || 'home');
    });

    $('btnOTDefer').addEventListener('click', () => {
      const other = (state.otCoinWinner || 'home') === 'home' ? 'away' : 'home';
      startOvertimeWithReceiver(other);
    });

    // ================= SAFETY, DELAY, DEAL & QUARTER END =================
    $('btnProceedSafetyKick').addEventListener('click', () => {
      closeModal(dom.modalSafety, false);
      openPuntModal(true);
    });

    $('btnEnforceDelayPenalty').addEventListener('click', () => {
      closeModal(dom.modalDelayOfGame, false);
      const isHome = state.possession === 'home';
      state.ballOn = isHome ? Math.max(1, state.ballOn - 5) : Math.min(99, state.ballOn + 5);
      resetPlayClock(false);
      renderFieldAndScoreboard();
      sfx.buzzer();
      setStatus('Delay of Game (-5 yds). Clocks stopped; play clock reset to :30.');
    });

    $('btnWaveOffDelay').addEventListener('click', () => {
      closeModal(dom.modalDelayOfGame, false);
      resetPlayClock(false);
      setStatus('Delay of Game waived off. Play clock reset to :30.');
    });

    $('btnResumeAfterDeal').addEventListener('click', () => {
      closeModal(dom.modalDeal, false);
      sfx.whistle();
      startGameClock();
      resetPlayClock(true);
    });

    dom.btnConfirmQuarterEnd.addEventListener('click', () => {
      stopConfetti();
      clearVictoryModalState();
      closeModal(dom.modalQuarterEnd, false);

      // Game Final -> New Game
      if (state.quarter >= 4 && state.scoreHome !== state.scoreAway) {
        startFreshGame(state.quarterLengthMinutes);
        return;
      }

      // Halftime -> Q3 + 2nd Half Kickoff (to team that kicked off Q1)
      if (state.quarter === 2) {
        state.quarter = 3;
        state.gameTimeRemaining = state.quarterLengthMinutes * 60;
        resetPlayClock(false);
        renderFieldAndScoreboard();
        const secondHalfReceiver = state.openingReceiver === 'home' ? 'away' : 'home';
        openKickoffModal('halftime', secondHalfReceiver);
        return;
      }

      // Standard Quarter Advance (Q1 -> Q2 or Q3 -> Q4)
      state.quarter += 1;
      state.gameTimeRemaining = state.quarterLengthMinutes * 60;
      resetPlayClock(false);
      renderFieldAndScoreboard();
      setStatus(`Quarter ${state.quarter} ready.`);
    });

    // ================= SCORE ADJUST, NEW GAME & RULES =================
    $('btnOpenScoreModal').addEventListener('click', () => {
      renderFieldAndScoreboard();
      openModal(dom.modalScoreAdjust);
    });
    $('btnCloseScoreModal').addEventListener('click', () => closeModal(dom.modalScoreAdjust, true));

    document.querySelectorAll('[data-add-home]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pts = Number(btn.dataset.addHome);
        state.scoreHome = Math.max(0, state.scoreHome + pts);
        renderFieldAndScoreboard();
        if (pts === 6) triggerScoreboardTD('home');
      });
    });

    document.querySelectorAll('[data-add-away]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pts = Number(btn.dataset.addAway);
        state.scoreAway = Math.max(0, state.scoreAway + pts);
        renderFieldAndScoreboard();
        if (pts === 6) triggerScoreboardTD('away');
      });
    });

    $('btnFlipPossessionManual').addEventListener('click', () => {
      switchPossession();
      setStatus(`Possession switched to ${teamLabel(state.possession)}.`);
    });

    $('btnNextQuarterModal').addEventListener('click', () => {
      closeModal(dom.modalScoreAdjust, false);
      handleQuarterExpired();
    });

    $('btnResetGame').addEventListener('click', () => {
      syncQuarterLengthButtons();
      openModal(dom.modalNewGame);
    });
    $('btnCloseNewGameModal').addEventListener('click', () => closeModal(dom.modalNewGame, true));

    document.querySelectorAll('#quarterLengthPills .seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#quarterLengthPills .seg-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    $('btnApplyQuarterLenOnly').addEventListener('click', () => {
      const activeBtn = document.querySelector('#quarterLengthPills .seg-btn.active');
      const mins = activeBtn ? Number(activeBtn.dataset.mins) : 3;
      setQuarterLength(mins, true);
      closeModal(dom.modalNewGame, false);
      setStatus(`Quarter clock updated to ${mins} minutes.`);
    });

    $('btnConfirmResetNewGame').addEventListener('click', () => {
      const activeBtn = document.querySelector('#quarterLengthPills .seg-btn.active');
      const mins = activeBtn ? Number(activeBtn.dataset.mins) : 3;
      closeModal(dom.modalNewGame, false);
      startFreshGame(mins);
    });

    $('btnOpenRules').addEventListener('click', () => openModal(dom.modalRules));
    $('btnCloseRules').addEventListener('click', () => closeModal(dom.modalRules, true));

    // Escape key closes dismissible modals
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const dismissible = [
        dom.modalRules,
        dom.modalNewGame,
        dom.modalScoreAdjust,
        dom.modalPlayCalc,
        dom.modalPunt,
        dom.modalFG,
        dom.modalHailMary,
      ];
      for (const modal of dismissible) {
        if (modal.classList.contains('active')) {
          closeModal(modal, true);
          break;
        }
      }
    });

    window.addEventListener('resize', resizeCelebrationCanvas);
  }

  // =========================================================================
  // INIT
  // =========================================================================
  bindEvents();
  syncQuarterLengthButtons();
  renderFieldAndScoreboard();
  // Launch Opening Coin Flip (Away calls Heads/Tails) to start the match
  openOpeningCoinFlipModal();
})();
