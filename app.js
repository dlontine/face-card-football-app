/**
 * Deck Football Companion — Core State Machine & UI Controller
 * Pure Vanilla ES6+ JavaScript (browser-native, GitHub Pages ready)
 */

(() => {
  'use strict';

  const HAND_LIMIT = 12;
  const PLAY_CARD_LIMIT = 3;
  const FRESH_DRIVE_OFFENSE = 8;
  const FRESH_DRIVE_DEFENSE = 5;
  const FIRST_DOWN_OFFENSE_ADD = 7;
  const FIRST_DOWN_DEFENSE_ADD = 5;
  const PLAY_CLOCK_DEFAULT = 30;

  // =========================================================================
  // GAME STATE MACHINE
  // =========================================================================
  const state = {
    scoreHome: 0,
    scoreAway: 0,
    possession: 'home', // 'home' | 'away'
    down: 1,
    distance: 10,
    ballOn: 20, // 1–99 during play (0 = Home Goal, 100 = Away Goal)
    lineGain: 30,
    quarter: 1, // 1–4
    quarterLengthMinutes: 5, // 3, 5, or 7
    gameTimeRemaining: 300,
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

    // Hand tracking
    offenseHandCount: FRESH_DRIVE_OFFENSE,
    defenseHandCount: FRESH_DRIVE_DEFENSE,

    // Preferences & pending workflows
    soundEnabled: true,
    aceMode: 'standard', // 'standard' (Ace = 11) | 'v4' (Off Ace = 11 w/ Q else 5)
    pendingDealType: null, // 'fresh' | 'firstdown' | null
    pendingPATPoints: 1,

    // Play Calc buffers
    offenseCards: [],
    defenseCards: [],

    // Punt buffers
    puntKickCard: null,
    puntReturnCard: null,
    isSafetyFreeKick: false,

    // Field Goal buffers
    fgOffenseCards: [],
    fgDefenseCards: [],
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

  function playTone(freq, duration, type = 'sine', volume = 0.1) {
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
      // Ignore audio autoplay restrictions
    }
  }

  const sfx = {
    whistle() {
      playTone(2350, 0.11, 'triangle', 0.08);
      setTimeout(() => playTone(2550, 0.18, 'triangle', 0.08), 95);
    },
    buzzer() {
      playTone(145, 0.52, 'sawtooth', 0.11);
    },
    score() {
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
        setTimeout(() => playTone(freq, 0.16, 'sine', 0.1), i * 75);
      });
    },
    tick() {
      playTone(760, 0.07, 'sine', 0.08);
    },
  };

  // =========================================================================
  // DOM REFERENCES
  // =========================================================================
  const $ = (id) => document.getElementById(id);

  const dom = {
    // Scoreboard
    teamBlockHome: $('teamBlockHome'),
    teamBlockAway: $('teamBlockAway'),
    scoreHome: $('scoreHome'),
    scoreAway: $('scoreAway'),
    badgeHome: $('badgeHome'),
    badgeAway: $('badgeAway'),
    quarterDisplay: $('quarterDisplay'),
    qtrBadgeTime: $('qtrBadgeTime'),

    // Clocks
    gameClockLabel: $('gameClockLabel'),
    gameClock: $('gameClock'),
    btnToggleGameClock: $('btnToggleGameClock'),
    playClockModule: $('playClockModule'),
    playClock: $('playClock'),
    playClockExpiredFlag: $('playClockExpiredFlag'),
    btnStartPlayClock: $('btnStartPlayClock'),
    btnPausePlayClock: $('btnPausePlayClock'),
    btnResetPlayClock: $('btnResetPlayClock'),

    // Field & Down
    downTag: $('downTag'),
    locTag: $('locTag'),
    driveIndicator: $('driveIndicator'),
    ballOnNumeric: $('ballOnNumeric'),
    svgLosGroup: $('svgLosGroup'),
    svgFirstDownGroup: $('svgFirstDownGroup'),
    svgLosText: $('svgLosText'),
    svgToGoZone: $('svgToGoZone'),
    ballScrubber: $('ballScrubber'),
    scrubberYardVal: $('scrubberYardVal'),

    // Hand Tracker
    offenseHandCount: $('offenseHandCount'),
    defenseHandCount: $('defenseHandCount'),
    offenseHandBar: $('offenseHandBar'),
    defenseHandBar: $('defenseHandBar'),
    offenseHandNote: $('offenseHandNote'),
    defenseHandNote: $('defenseHandNote'),

    // Status
    statusText: $('statusText'),

    // Modals
    modalPlayCalc: $('modalPlayCalc'),
    modalPunt: $('modalPunt'),
    modalFG: $('modalFG'),
    modalFGMade: $('modalFGMade'),
    modalFGMissed: $('modalFGMissed'),
    modalTD: $('modalTD'),
    modalSafety: $('modalSafety'),
    modalDelayOfGame: $('modalDelayOfGame'),
    modalQuarterEnd: $('modalQuarterEnd'),
    modalDeal: $('modalDeal'),
    modalScoreAdjust: $('modalScoreAdjust'),
    modalNewGame: $('modalNewGame'),
    modalRules: $('modalRules'),

    // Play Calc controls
    inputOffenseSum: $('inputOffenseSum'),
    inputDefenseSum: $('inputDefenseSum'),
    chipsOffense: $('chipsOffense'),
    chipsDefense: $('chipsDefense'),
    labelOffenseCount: $('labelOffenseCount'),
    labelDefenseCount: $('labelDefenseCount'),
    btnOffAceKey: $('btnOffAceKey'),
    calcDiffText: $('calcDiffText'),
    calcOutcomeSubtext: $('calcOutcomeSubtext'),
    btnApplyPlayCalc: $('btnApplyPlayCalc'),

    // Punt controls
    puntTitle: $('puntTitle'),
    puntDesc: $('puntDesc'),
    chipsPuntKick: $('chipsPuntKick'),
    chipsPuntReturn: $('chipsPuntReturn'),
    puntNetText: $('puntNetText'),
    puntLandingPreview: $('puntLandingPreview'),

    // Field Goal controls
    fgTargetText: $('fgTargetText'),
    fgMathText: $('fgMathText'),
    chipsFGOffense: $('chipsFGOffense'),
    chipsFGDefense: $('chipsFGDefense'),
    fgMadeDetail: $('fgMadeDetail'),
    fgMissedDetail: $('fgMissedDetail'),

    // Touchdown & PAT
    patConfirmBox: $('patConfirmBox'),
    patPromptText: $('patPromptText'),
    kickoffBox: $('kickoffBox'),

    // Quarter End & Deal
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

  // =========================================================================
  // SYNCHRONIZED CLOCK ENGINE
  // =========================================================================
  function renderClocks() {
    const formattedGame = formatGameClock(state.gameTimeRemaining);
    dom.gameClock.textContent = formattedGame;
    dom.qtrBadgeTime.textContent = formattedGame;
    dom.quarterDisplay.textContent = state.quarter <= 4 ? `Q${state.quarter}` : `OT${state.quarter - 4}`;
    dom.gameClockLabel.textContent = `Quarter Clock (${state.quarterLengthMinutes} min)`;
    dom.btnToggleGameClock.textContent = state.gameClockRunning ? 'Pause' : 'Start';

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
      }
      if (state.gameTimeRemaining <= 0) {
        pauseGameClock();
        pausePlayClock();
        sfx.buzzer();
        openQuarterEndModal();
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
    if (resetClock) {
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
  // MODAL MANAGER (SYNCHRONIZED AUTO-PAUSE)
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
      if (state.wasGameClockRunningBeforeModal) startGameClock();
      if (state.wasPlayClockRunningBeforeModal && !state.playClockExpired) startPlayClock();
    }
  }

  // =========================================================================
  // HAND TRACKER RENDER & LOGIC
  // =========================================================================
  function renderHandTracker() {
    dom.offenseHandCount.textContent = String(state.offenseHandCount);
    dom.defenseHandCount.textContent = String(state.defenseHandCount);

    const offPct = (state.offenseHandCount / HAND_LIMIT) * 100;
    const defPct = (state.defenseHandCount / HAND_LIMIT) * 100;

    dom.offenseHandBar.style.width = `${offPct}%`;
    dom.defenseHandBar.style.width = `${defPct}%`;

    dom.offenseHandBar.classList.toggle('is-at-limit', state.offenseHandCount >= HAND_LIMIT);
    dom.offenseHandBar.classList.toggle('is-empty', state.offenseHandCount === 0);
    dom.defenseHandBar.classList.toggle('is-at-limit', state.defenseHandCount >= HAND_LIMIT);
    dom.defenseHandBar.classList.toggle('is-empty', state.defenseHandCount === 0);

    updateHandNote(dom.offenseHandNote, state.offenseHandCount, 'Offense');
    updateHandNote(dom.defenseHandNote, state.defenseHandCount, 'Defense');
  }

  function updateHandNote(el, count, side) {
    el.classList.remove('is-warning', 'is-danger');
    if (count === 0) {
      el.textContent = `Empty Hand Rule: ${side} plays 0 cards`;
      el.classList.add('is-danger');
    } else if (count >= HAND_LIMIT) {
      el.textContent = 'At 12-card limit (discard any excess)';
      el.classList.add('is-warning');
    } else {
      el.textContent = `Play up to ${Math.min(PLAY_CARD_LIMIT, count)} cards this snap`;
    }
  }

  function applyDealToHandCounts(type) {
    if (type === 'fresh') {
      state.offenseHandCount = FRESH_DRIVE_OFFENSE;
      state.defenseHandCount = FRESH_DRIVE_DEFENSE;
    } else if (type === 'firstdown') {
      state.offenseHandCount = Math.min(HAND_LIMIT, state.offenseHandCount + FIRST_DOWN_OFFENSE_ADD);
      state.defenseHandCount = Math.min(HAND_LIMIT, state.defenseHandCount + FIRST_DOWN_DEFENSE_ADD);
    }
    renderHandTracker();
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

    // Highlight zone between LOS and 1st Down line
    const zoneX = Math.min(losX, gainX);
    const zoneW = Math.max(0, Math.abs(gainX - losX));
    dom.svgToGoZone.setAttribute('x', String(zoneX));
    dom.svgToGoZone.setAttribute('width', String(zoneW));

    dom.ballScrubber.value = String(clampedBall);
    dom.scrubberYardVal.textContent = `${clampedBall} yd`;
    dom.ballOnNumeric.textContent = `Yard ${clampedBall}`;

    const yardsToGo = computeDistance();
    const isGoalToGo = (isHome && state.lineGain >= 100) || (!isHome && state.lineGain <= 0);
    const toGoLabel = isGoalToGo || yardsToGo <= 0 ? 'Goal' : String(yardsToGo);

    dom.downTag.textContent = `${ordinalDown(state.down)} & ${toGoLabel}`;
    dom.locTag.textContent = `Ball on ${formatSpotLabel(clampedBall, state.possession)} · ${
      isHome ? 'Driving Right →' : '← Driving Left'
    }`;

    renderClocks();
    renderHandTracker();
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

  function openDealPrompt(kicker, title, body, dealType) {
    state.pendingDealType = dealType;
    dom.dealKicker.textContent = kicker;
    dom.dealTitle.textContent = title;
    dom.dealBody.textContent = body;
    openModal(dom.modalDeal);
  }

  function applyPlayYardage(netYards, options = {}) {
    const isHome = state.possession === 'home';
    const nextBallOn = isHome ? state.ballOn + netYards : state.ballOn - netYards;

    // 1. Safety Check (pushed into own endzone)
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

    // 2. Touchdown Check (crossed opponent goal line)
    if ((isHome && nextBallOn >= 100) || (!isHome && nextBallOn <= 0)) {
      sfx.score();
      if (isHome) state.scoreHome += 6;
      else state.scoreAway += 6;
      state.ballOn = isHome ? 99 : 1;
      renderFieldAndScoreboard();
      setStatus(`Touchdown ${isHome ? 'Home' : 'Away'}! (+6 points)`);
      openTouchdownModal();
      return;
    }

    state.ballOn = clamp(nextBallOn, 1, 99);

    // 3. First Down Check
    const reachedFirstDown = isHome ? state.ballOn >= state.lineGain : state.ballOn <= state.lineGain;
    if (reachedFirstDown || options.autoFirstDown) {
      sfx.score();
      resetFirstDownMarkers();
      renderFieldAndScoreboard();
      const label = options.reason || `Gain of ${netYards >= 0 ? '+' : ''}${netYards} yds`;
      setStatus(`${label} — First Down at ${formatSpotLabel(state.ballOn, state.possession)}.`);
      openDealPrompt(
        'First Down Achieved',
        '1st & 10',
        'Deal +7 cards to Offense and +5 cards to Defense. Hold unused cards (12-card maximum).',
        'firstdown'
      );
      return;
    }

    // 4. Down Progression / Turnover on Downs
    if (state.down < 4) {
      state.down += 1;
      sfx.whistle();
      renderFieldAndScoreboard();
      startGameClock();
      resetPlayClock(true);
      setStatus(
        `Play resolved (${netYards >= 0 ? '+' : ''}${netYards} yds). ${ordinalDown(state.down)} & ${
          state.distance
        } at ${formatSpotLabel(state.ballOn, state.possession)}.`
      );
    } else {
      sfx.buzzer();
      switchPossession();
      setStatus(`Turnover on downs! ${state.possession === 'home' ? 'Home' : 'Away'} takes over.`);
      openDealPrompt(
        '4th Down Stop',
        'Turnover on Downs',
        'Offense stopped on 4th down. Deal 8 cards to the new Offense and 5 cards to Defense.',
        'fresh'
      );
    }
  }

  function enforceOffensiveJokerPenalty() {
    sfx.score();
    const isHome = state.possession === 'home';
    const nextSpot = isHome ? Math.min(99, state.ballOn + 15) : Math.max(1, state.ballOn - 15);
    state.ballOn = nextSpot;
    resetFirstDownMarkers();
    renderFieldAndScoreboard();
    setStatus(`Joker Penalty enforced: +15 yards & automatic 1st Down at ${formatSpotLabel(state.ballOn, state.possession)}.`);
    openDealPrompt(
      'Offensive Joker Penalty',
      '+15 Yards & 1st Down',
      '15-yard penalty enforced with an automatic 1st Down. Deal +7 cards to Offense and +5 cards to Defense.',
      'firstdown'
    );
  }

  // =========================================================================
  // DELAY OF GAME & QUARTER END MODALS
  // =========================================================================
  function openDelayOfGameModal() {
    setStatus('Play clock expired (:00). Resolve Delay of Game penalty.');
    openModal(dom.modalDelayOfGame);
  }

  function openQuarterEndModal() {
    if (state.quarter === 2) {
      dom.quarterEndKicker.textContent = 'End of 1st Half';
      dom.titleQuarterEnd.textContent = 'Halftime';
      dom.quarterEndBody.textContent =
        'Halftime! Discard both hands completely and reshuffle the entire 54-card deck before starting Quarter 3.';
      dom.btnConfirmQuarterEnd.textContent = 'Reshuffle & Start Q3';
    } else if (state.quarter >= 4) {
      const winnerText =
        state.scoreHome === state.scoreAway
          ? `Tied ${state.scoreHome} - ${state.scoreAway}. Start Overtime or begin a new game.`
          : `${state.scoreHome > state.scoreAway ? 'Home' : 'Away'} leads ${state.scoreHome} - ${state.scoreAway}.`;
      dom.quarterEndKicker.textContent = state.quarter === 4 ? 'End of Regulation' : 'End of Overtime';
      dom.titleQuarterEnd.textContent = state.scoreHome === state.scoreAway ? 'Overtime Needed' : 'Game Final';
      dom.quarterEndBody.textContent = winnerText;
      dom.btnConfirmQuarterEnd.textContent = state.scoreHome === state.scoreAway ? 'Start Overtime' : 'Continue / Add OT';
    } else {
      dom.quarterEndKicker.textContent = `End of Q${state.quarter}`;
      dom.titleQuarterEnd.textContent = `Quarter ${state.quarter} Complete`;
      dom.quarterEndBody.textContent = `Ready to start Quarter ${state.quarter + 1}. Keep current hands and field position.`;
      dom.btnConfirmQuarterEnd.textContent = `Start Q${state.quarter + 1}`;
    }
    openModal(dom.modalQuarterEnd);
  }

  function advanceQuarter() {
    state.quarter += 1;
    state.gameTimeRemaining = state.quarterLengthMinutes * 60;
    resetPlayClock(false);
    if (state.quarter === 3) {
      state.offenseHandCount = FRESH_DRIVE_OFFENSE;
      state.defenseHandCount = FRESH_DRIVE_DEFENSE;
      setStatus('Halftime complete. Deck reshuffled for Quarter 3.');
    } else {
      setStatus(`Quarter ${state.quarter <= 4 ? state.quarter : `OT${state.quarter - 4}`} ready.`);
    }
    renderFieldAndScoreboard();
  }

  // =========================================================================
  // PLAY CALCULATOR LOGIC
  // =========================================================================
  function evaluatePlayCalculator() {
    const manualOffStr = dom.inputOffenseSum.value.trim();
    const manualDefStr = dom.inputDefenseSum.value.trim();
    const usingManual = manualOffStr !== '' || manualDefStr !== '';

    const hasOffJoker = state.offenseCards.some((c) => c.type === 'joker');
    const hasOffKing = state.offenseCards.some((c) => c.type === 'king');
    const hasOffQueen = state.offenseCards.some((c) => c.type === 'queen');

    const hasDefJoker = state.defenseCards.some((c) => c.type === 'joker');
    const hasDefKing = state.defenseCards.some((c) => c.type === 'king');
    const hasDefAce = state.defenseCards.some((c) => c.type === 'ace');

    // Special Combo 1: Offense K + Joker => +15y Penalty & Automatic 1st Down
    if (!usingManual && hasOffJoker && hasOffKing) {
      return {
        outcome: 'penalty',
        net: 15,
        displayText: '+15 Yds & 1st Down',
        subtext: 'Offense played King + Joker: 15-yard penalty and automatic 1st Down.',
        ctaText: 'Enforce +15y Penalty & 1st Down',
      };
    }

    // Special Combo 2: Defense K + Joker => Turnover unless Offense plays King
    if (!usingManual && hasDefJoker && hasDefKing && !hasOffKing) {
      return {
        outcome: 'turnover',
        net: 0,
        displayText: 'Turnover',
        subtext: 'Defense played King + Joker with no Offensive King to block.',
        ctaText: 'Confirm Turnover',
      };
    }

    // Calculate card sums
    let offSum = 0;
    if (manualOffStr !== '') {
      offSum = Math.max(0, Number(manualOffStr) || 0);
    } else {
      state.offenseCards.forEach((c) => {
        if (c.type === 'ace' || c.type === 'joker') {
          if (state.aceMode === 'standard') {
            offSum += 11;
          } else {
            offSum += hasOffQueen ? 11 : 5;
          }
        } else {
          offSum += Number(c.val);
        }
      });
    }

    let defSum = 0;
    if (manualDefStr !== '') {
      defSum = Math.max(0, Number(manualDefStr) || 0);
    } else {
      state.defenseCards.forEach((c) => {
        if (c.type === 'ace' || c.type === 'joker') {
          defSum += 11;
        } else {
          defSum += Number(c.val);
        }
      });
    }

    const rawDiff = offSum - defSum;
    let net = rawDiff;
    const defSackCap = hasDefAce || hasDefJoker ? -10 : -5;

    if (rawDiff < 0) {
      net = Math.max(defSackCap, rawDiff);
    }

    let subtext = `Offense ${offSum} − Defense ${defSum} = ${net >= 0 ? '+' : ''}${net} yds`;
    if (hasDefJoker && hasDefKing && hasOffKing) {
      subtext = `Turnover blocked by Offense King! ${subtext}`;
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
    dom.btnOffAceKey.textContent = state.aceMode === 'standard' ? 'Ace (11)' : 'Ace (5 / 11 w/ Q)';
    dom.labelOffenseCount.textContent = `Offense Cards (${state.offenseCards.length}/${PLAY_CARD_LIMIT})`;
    dom.labelDefenseCount.textContent = `Defense Cards (${state.defenseCards.length}/${PLAY_CARD_LIMIT})`;

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
  }

  function renderCardTokens(container, cards, onRemove) {
    container.innerHTML = '';
    if (cards.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'selected-empty';
      empty.textContent = 'No cards selected';
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
      dom.puntDesc.textContent = 'Conceding team kicks from their own 20-yard line using punt rules.';
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
      dom.puntNetText.className = 'result-value is-negative';
      dom.puntLandingPreview.textContent = 'Joker drawn on empty-hand punt — immediate turnover at LOS.';
      return;
    }

    const kickYards = getPuntKickYards(state.puntKickCard);
    const returnYards = state.puntReturnCard ? Number(state.puntReturnCard.val) : 0;
    const net = Math.max(0, kickYards - returnYards);

    dom.puntNetText.textContent = `${net} Net Yards`;
    dom.puntNetText.className = 'result-value';

    if (!state.puntKickCard) {
      dom.puntLandingPreview.textContent = 'Select a punt card (or defaults to 35y kick on execute).';
      return;
    }

    const isHome = state.possession === 'home';
    const rawLanding = isHome ? state.ballOn + net : state.ballOn - net;
    const isTouchback = (isHome && rawLanding >= 100) || (!isHome && rawLanding <= 0);
    const nextPossession = isHome ? 'away' : 'home';

    if (isTouchback) {
      dom.puntLandingPreview.textContent = `Touchback! ${nextPossession === 'home' ? 'Home' : 'Away'} starts at Own 20.`;
    } else {
      const spot = clamp(rawLanding, 1, 99);
      dom.puntLandingPreview.textContent = `Kick ${kickYards}y − Return ${returnYards}y · ${
        nextPossession === 'home' ? 'Home' : 'Away'
      } starts at ${formatSpotLabel(spot, nextPossession)}.`;
    }
  }

  // =========================================================================
  // FIELD GOAL MODAL LOGIC
  // =========================================================================
  function getFGTargetDistance() {
    const isHome = state.possession === 'home';
    const yardsToGoal = isHome ? 100 - state.ballOn : state.ballOn;
    return yardsToGoal + 10;
  }

  function renderFGUI() {
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

    if (isBlocked) {
      dom.fgMathText.textContent = `Offense (${offSum}) · Blocked by Defense Joker!`;
    } else {
      const verdict = net > target ? 'GOOD' : `Needs > ${target}`;
      dom.fgMathText.textContent = `Offense (${offSum}) − Defense (${defSum}) = ${net} Net (${verdict})`;
    }
  }

  // =========================================================================
  // TOUCHDOWN & KICKOFF HELPERS
  // =========================================================================
  function openTouchdownModal() {
    dom.patConfirmBox.hidden = true;
    dom.kickoffBox.hidden = true;
    openModal(dom.modalTD);
  }

  function resolveKickoffTouchback(sourceModal) {
    closeModal(sourceModal, false);
    const isHome = state.possession === 'home';
    const landing = isHome ? 75 : 25;
    switchPossession(landing);
    setStatus(`Touchback! ${state.possession === 'home' ? 'Home' : 'Away'} takes over at Own 25.`);
    openDealPrompt(
      'Touchback',
      'Own 25-Yard Line',
      'Ball placed on the receiving team’s 25-yard line. Deal 8 cards to new Offense and 5 cards to Defense.',
      'fresh'
    );
  }

  function resolveKickoffReturn(sourceModal) {
    closeModal(sourceModal, false);
    let returnYards = 0;
    for (let i = 0; i < 4; i += 1) {
      returnYards += Math.floor(Math.random() * 9) + 2; // 4 cards (2–10 each)
    }
    const isHome = state.possession === 'home';
    const landing = clamp(isHome ? 100 - returnYards : returnYards, 1, 99);
    switchPossession(landing);
    setStatus(`Kickoff returned ${returnYards} yards to ${formatSpotLabel(landing, state.possession)}.`);
    openDealPrompt(
      'Kick Return',
      `Returned ${returnYards} Yards`,
      `Ball spotted at ${formatSpotLabel(landing, state.possession)}. Deal 8 cards to new Offense and 5 cards to Defense.`,
      'fresh'
    );
  }

  // =========================================================================
  // EVENT LISTENERS
  // =========================================================================
  function bindEvents() {
    // Sound toggle
    $('btnToggleSound').addEventListener('click', (e) => {
      state.soundEnabled = !state.soundEnabled;
      e.currentTarget.setAttribute('aria-pressed', String(state.soundEnabled));
      e.currentTarget.textContent = state.soundEnabled ? 'Sound On' : 'Sound Off';
    });

    // Quarter length segmented controls (Header)
    document.querySelectorAll('#quarterLengthSelector .seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mins = Number(btn.dataset.mins);
        setQuarterLength(mins, true);
        setStatus(`Quarter length set to ${mins} minutes.`);
      });
    });

    // Quarter clock Start / Pause
    dom.btnToggleGameClock.addEventListener('click', () => {
      if (state.gameClockRunning) {
        pauseGameClock();
        pausePlayClock();
      } else {
        startGameClock();
        if (!state.playClockExpired) {
          if (state.playClockTime > 0 && state.playClockTime < PLAY_CLOCK_DEFAULT) {
            startPlayClock();
          } else {
            resetPlayClock(true);
          }
        }
      }
    });

    // Play clock dedicated Start / Pause / Reset controls
    dom.btnStartPlayClock.addEventListener('click', () => startPlayClock());
    dom.btnPausePlayClock.addEventListener('click', () => pausePlayClock());
    dom.btnResetPlayClock.addEventListener('click', () => resetPlayClock(false));

    // Ball Spot Scrubber
    dom.ballScrubber.addEventListener('input', (e) => {
      state.ballOn = clamp(Number(e.target.value), 1, 99);
      renderFieldAndScoreboard();
    });

    // Hand Tracker +/- buttons
    $('btnOffHandDec').addEventListener('click', () => {
      state.offenseHandCount = Math.max(0, state.offenseHandCount - 1);
      renderHandTracker();
    });
    $('btnOffHandInc').addEventListener('click', () => {
      state.offenseHandCount = Math.min(HAND_LIMIT, state.offenseHandCount + 1);
      renderHandTracker();
    });
    $('btnDefHandDec').addEventListener('click', () => {
      state.defenseHandCount = Math.max(0, state.defenseHandCount - 1);
      renderHandTracker();
    });
    $('btnDefHandInc').addEventListener('click', () => {
      state.defenseHandCount = Math.min(HAND_LIMIT, state.defenseHandCount + 1);
      renderHandTracker();
    });

    // Situation Action Buttons
    $('btnTriggerTurnover').addEventListener('click', () => {
      sfx.buzzer();
      switchPossession();
      setStatus(`Turnover! ${state.possession === 'home' ? 'Home' : 'Away'} takes over.`);
      openDealPrompt(
        'Change of Possession',
        'Turnover',
        'Defense takes over at the spot. Deal 8 cards to the new Offense and 5 cards to Defense.',
        'fresh'
      );
    });

    $('btnTriggerPunt').addEventListener('click', () => openPuntModal(false));

    $('btnTriggerFG').addEventListener('click', () => {
      state.fgOffenseCards = [];
      state.fgDefenseCards = [];
      renderFGUI();
      openModal(dom.modalFG);
    });

    $('btnTriggerJokerPenalty').addEventListener('click', () => enforceOffensiveJokerPenalty());

    $('btnForceFirstDown').addEventListener('click', () => {
      sfx.score();
      resetFirstDownMarkers();
      renderFieldAndScoreboard();
      setStatus(`Chains reset to 1st & 10 at ${formatSpotLabel(state.ballOn, state.possession)}.`);
      openDealPrompt(
        'First Down Reset',
        '1st & 10',
        'Deal +7 cards to Offense and +5 cards to Defense (12-card maximum).',
        'firstdown'
      );
    });

    // Quick Yardage Buttons (-10 to +15)
    document.querySelectorAll('.btn-yard').forEach((btn) => {
      btn.addEventListener('click', () => {
        applyPlayYardage(Number(btn.dataset.yard));
      });
    });

    // ================= PLAY CALC MODAL EVENTS =================
    $('btnOpenPlayCalc').addEventListener('click', () => {
      state.offenseCards = [];
      state.defenseCards = [];
      dom.inputOffenseSum.value = '';
      dom.inputDefenseSum.value = '';
      renderPlayCalcUI();
      openModal(dom.modalPlayCalc);
    });

    $('btnClosePlayCalc').addEventListener('click', () => closeModal(dom.modalPlayCalc, true));

    document.querySelectorAll('#aceModeSelector .seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.aceMode = btn.dataset.aceMode;
        document.querySelectorAll('#aceModeSelector .seg-btn').forEach((b) => {
          b.classList.toggle('active', b.dataset.aceMode === state.aceMode);
        });
        renderPlayCalcUI();
      });
    });

    dom.inputOffenseSum.addEventListener('input', renderPlayCalcUI);
    dom.inputDefenseSum.addEventListener('input', renderPlayCalcUI);

    document.querySelectorAll('#keysOffense .btn-key').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (state.offenseCards.length >= PLAY_CARD_LIMIT) return;
        dom.inputOffenseSum.value = '';
        state.offenseCards.push({
          type: btn.dataset.type,
          val: btn.dataset.val,
          label: btn.dataset.type === 'ace' ? 'Ace' : btn.dataset.type === 'joker' ? 'Joker' : btn.textContent.split(' ')[0],
        });
        renderPlayCalcUI();
      });
    });

    document.querySelectorAll('#keysDefense .btn-key').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (state.defenseCards.length >= PLAY_CARD_LIMIT) return;
        dom.inputDefenseSum.value = '';
        state.defenseCards.push({
          type: btn.dataset.type,
          val: btn.dataset.val,
          label: btn.dataset.type === 'ace' ? 'Ace' : btn.dataset.type === 'joker' ? 'Joker' : btn.textContent.split(' ')[0],
        });
        renderPlayCalcUI();
      });
    });

    $('btnClearOffense').addEventListener('click', () => {
      state.offenseCards = [];
      dom.inputOffenseSum.value = '';
      renderPlayCalcUI();
    });

    $('btnClearDefense').addEventListener('click', () => {
      state.defenseCards = [];
      dom.inputDefenseSum.value = '';
      renderPlayCalcUI();
    });

    dom.btnApplyPlayCalc.addEventListener('click', () => {
      const result = evaluatePlayCalculator();
      const offPlayed = state.offenseCards.length;
      const defPlayed = state.defenseCards.length;

      // Deduct played cards from tracked hands
      state.offenseHandCount = Math.max(0, state.offenseHandCount - offPlayed);
      state.defenseHandCount = Math.max(0, state.defenseHandCount - defPlayed);
      renderHandTracker();

      closeModal(dom.modalPlayCalc, false);

      if (result.outcome === 'penalty') {
        enforceOffensiveJokerPenalty();
        return;
      }

      if (result.outcome === 'turnover') {
        sfx.buzzer();
        switchPossession();
        setStatus(`Defense King + Joker Turnover! ${state.possession === 'home' ? 'Home' : 'Away'} takes over.`);
        openDealPrompt(
          'King + Joker Steal',
          'Turnover',
          'Defense stole the ball! Deal 8 cards to the new Offense and 5 cards to Defense.',
          'fresh'
        );
        return;
      }

      applyPlayYardage(result.net);
    });

    $('btnCalcJokerPenalty').addEventListener('click', () => {
      closeModal(dom.modalPlayCalc, false);
      enforceOffensiveJokerPenalty();
    });

    // ================= PUNT MODAL EVENTS =================
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

    document.querySelectorAll('#keysPuntKick .btn-key').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.puntKickCard = { val: btn.dataset.val, label: btn.dataset.label };
        renderPuntUI();
      });
    });

    document.querySelectorAll('#keysPuntReturn .btn-key').forEach((btn) => {
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
        setStatus('Muffed punt! Joker drawn on empty hand — immediate turnover at LOS.');
        openDealPrompt(
          'Muffed Punt',
          'Turnover at Spot',
          'Punter drew a Joker from the deck. Deal 8 cards to the new Offense and 5 cards to Defense.',
          'fresh'
        );
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
        ? 'Punt resulted in a touchback to the 20-yard line.'
        : `Punt netted ${net} yards. Ball spotted at ${formatSpotLabel(state.ballOn, state.possession)}.`;
      setStatus(detail);
      openDealPrompt(
        touchback ? 'Punt Touchback' : 'Punt Resolved',
        touchback ? 'Touchback (Own 20)' : 'Change of Possession',
        `${detail} Deal 8 cards to the new Offense and 5 cards to Defense.`,
        'fresh'
      );
    });

    // ================= FIELD GOAL MODAL EVENTS =================
    $('btnCloseFG').addEventListener('click', () => closeModal(dom.modalFG, true));

    $('btnAutoFGDeck').addEventListener('click', () => {
      const deckValues = [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11];
      for (let i = 0; i < 5; i += 1) {
        if (state.fgOffenseCards.length >= 8) break;
        const val = deckValues[Math.floor(Math.random() * deckValues.length)];
        state.fgOffenseCards.push({ val, label: val === 11 ? 'Deck Ace (11)' : `Deck ${val}` });
      }
      renderFGUI();
    });

    $('btnClearFGOffense').addEventListener('click', () => {
      state.fgOffenseCards = [];
      renderFGUI();
    });

    $('btnClearFGDefense').addEventListener('click', () => {
      state.fgDefenseCards = [];
      renderFGUI();
    });

    document.querySelectorAll('#keysFGOffense .btn-key').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (state.fgOffenseCards.length >= 8) return;
        state.fgOffenseCards.push({ val: btn.dataset.val, label: btn.dataset.label });
        renderFGUI();
      });
    });

    document.querySelectorAll('#keysFGDefense .btn-key').forEach((btn) => {
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

      if (!isBlocked && net > target) {
        sfx.score();
        if (isHome) state.scoreHome += 3;
        else state.scoreAway += 3;
        renderFieldAndScoreboard();
        dom.fgMadeDetail.textContent = `${isHome ? 'Home' : 'Away'} scores +3 points! Net kick of ${net} yards cleared the ${target}-yard target.`;
        setStatus(`Field Goal Good (+3) from ${target} yards.`);
        openModal(dom.modalFGMade);
      } else {
        sfx.buzzer();
        dom.fgMissedDetail.textContent = isBlocked
          ? 'Kick blocked by Defense Joker! Opponent takes over at the spot of the kick.'
          : `Kick came up short (${net} net yards; needed > ${target} yards). Opponent takes over at the spot.`;
        setStatus(isBlocked ? 'Field Goal blocked by Defense Joker!' : `Field Goal missed (${net} vs ${target} yds).`);
        openModal(dom.modalFGMissed);
      }
    });

    $('btnFGKickTouchback').addEventListener('click', () => resolveKickoffTouchback(dom.modalFGMade));
    $('btnFGKickReturnDeck').addEventListener('click', () => resolveKickoffReturn(dom.modalFGMade));

    $('btnConfirmFGMissed').addEventListener('click', () => {
      closeModal(dom.modalFGMissed, false);
      switchPossession();
      openDealPrompt(
        'Missed Field Goal',
        'Change of Possession',
        `Defense takes over at ${formatSpotLabel(state.ballOn, state.possession)}. Deal 8 cards to new Offense and 5 cards to Defense.`,
        'fresh'
      );
    });

    // ================= TOUCHDOWN & PAT EVENTS =================
    $('btnSelectPAT1').addEventListener('click', () => {
      state.pendingPATPoints = 1;
      dom.patPromptText.textContent = '1-Point Kick: Was the flipped card 4 or higher?';
      dom.patConfirmBox.hidden = false;
    });

    $('btnSelectPAT2').addEventListener('click', () => {
      state.pendingPATPoints = 2;
      dom.patPromptText.textContent = '2-Point Try: Did Offense beat Defense on the 1-card snap?';
      dom.patConfirmBox.hidden = false;
    });

    $('btnConfirmPATSuccess').addEventListener('click', () => {
      sfx.score();
      if (state.possession === 'home') state.scoreHome += state.pendingPATPoints;
      else state.scoreAway += state.pendingPATPoints;
      renderFieldAndScoreboard();
      dom.patConfirmBox.hidden = true;
      dom.kickoffBox.hidden = false;
      setStatus(`PAT Good (+${state.pendingPATPoints})! Ready for kickoff.`);
    });

    $('btnConfirmPATFail').addEventListener('click', () => {
      sfx.buzzer();
      dom.patConfirmBox.hidden = true;
      dom.kickoffBox.hidden = false;
      setStatus('PAT failed. Ready for kickoff.');
    });

    $('btnTDKickTouchback').addEventListener('click', () => resolveKickoffTouchback(dom.modalTD));
    $('btnTDKickReturnDeck').addEventListener('click', () => resolveKickoffReturn(dom.modalTD));

    // ================= SAFETY & DELAY OF GAME EVENTS =================
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
      setStatus('Delay of Game enforced (-5 yards). Game clock stopped; play clock reset to :30.');
    });

    $('btnWaveOffDelay').addEventListener('click', () => {
      closeModal(dom.modalDelayOfGame, false);
      resetPlayClock(false);
      setStatus('Delay of Game waived off. Play clock reset to :30.');
    });

    // ================= DEAL & QUARTER END EVENTS =================
    $('btnResumeAfterDeal').addEventListener('click', () => {
      if (state.pendingDealType) {
        applyDealToHandCounts(state.pendingDealType);
        state.pendingDealType = null;
      }
      closeModal(dom.modalDeal, false);
      sfx.whistle();
      startGameClock();
      resetPlayClock(true);
    });

    dom.btnConfirmQuarterEnd.addEventListener('click', () => {
      closeModal(dom.modalQuarterEnd, false);
      advanceQuarter();
    });

    // ================= SCORE ADJUST MODAL EVENTS =================
    $('btnOpenScoreModal').addEventListener('click', () => {
      renderFieldAndScoreboard();
      openModal(dom.modalScoreAdjust);
    });
    $('btnCloseScoreModal').addEventListener('click', () => closeModal(dom.modalScoreAdjust, true));

    document.querySelectorAll('[data-add-home]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.scoreHome = Math.max(0, state.scoreHome + Number(btn.dataset.addHome));
        renderFieldAndScoreboard();
      });
    });

    document.querySelectorAll('[data-add-away]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.scoreAway = Math.max(0, state.scoreAway + Number(btn.dataset.addAway));
        renderFieldAndScoreboard();
      });
    });

    $('btnFlipPossessionManual').addEventListener('click', () => {
      switchPossession();
      setStatus(`Possession switched manually to ${state.possession === 'home' ? 'Home' : 'Away'}.`);
    });

    $('btnNextQuarterModal').addEventListener('click', () => {
      closeModal(dom.modalScoreAdjust, false);
      if (state.quarter === 2) {
        openQuarterEndModal();
      } else {
        advanceQuarter();
      }
    });

    // ================= NEW GAME / SETUP MODAL EVENTS =================
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
      const mins = activeBtn ? Number(activeBtn.dataset.mins) : 5;
      setQuarterLength(mins, true);
      closeModal(dom.modalNewGame, false);
      setStatus(`Quarter clock updated to ${mins} minutes.`);
    });

    $('btnConfirmResetNewGame').addEventListener('click', () => {
      const activeBtn = document.querySelector('#quarterLengthPills .seg-btn.active');
      const mins = activeBtn ? Number(activeBtn.dataset.mins) : 5;
      pauseGameClock();
      pausePlayClock();

      state.scoreHome = 0;
      state.scoreAway = 0;
      state.possession = 'home';
      state.ballOn = 20;
      state.down = 1;
      state.lineGain = 30;
      state.distance = 10;
      state.quarter = 1;
      state.quarterLengthMinutes = mins;
      state.gameTimeRemaining = mins * 60;
      state.playClockTime = PLAY_CLOCK_DEFAULT;
      state.playClockExpired = false;
      state.offenseHandCount = FRESH_DRIVE_OFFENSE;
      state.defenseHandCount = FRESH_DRIVE_DEFENSE;

      syncQuarterLengthButtons();
      renderFieldAndScoreboard();
      closeModal(dom.modalNewGame, false);
      setStatus(`New game ready (${mins}-minute quarters). Deal 8 cards to Home, 5 to Away.`);
    });

    // ================= RULES MODAL EVENTS =================
    $('btnOpenRules').addEventListener('click', () => openModal(dom.modalRules));
    $('btnCloseRules').addEventListener('click', () => closeModal(dom.modalRules, true));

    // Close dismissible modals on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const dismissible = [
        dom.modalRules,
        dom.modalNewGame,
        dom.modalScoreAdjust,
        dom.modalPlayCalc,
        dom.modalPunt,
        dom.modalFG,
      ];
      for (const modal of dismissible) {
        if (modal.classList.contains('active')) {
          closeModal(modal, true);
          break;
        }
      }
    });
  }

  // Initialize application
  bindEvents();
  syncQuarterLengthButtons();
  renderFieldAndScoreboard();
})();
