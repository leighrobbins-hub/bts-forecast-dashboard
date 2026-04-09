/**
 * Guild of the Lexicon — Middle School ELA (fantasy theme).
 * Same XP economy: 4 units × 600 = 2400 max.
 */
(function (global) {
  var STORAGE_KEY = "lexiconGuild_v1";
  var LESSON_IDS = ["map", "voices", "forge", "sigils"];
  var XP_MISSION = 100;
  var XP_QUIZ = 25;
  var MAX_PER_LESSON = 5 * XP_MISSION + 4 * XP_QUIZ;
  var MAX_GLOBAL = LESSON_IDS.length * MAX_PER_LESSON;

  function emptyLesson() {
    return { missions: [false, false, false, false, false], quiz: [false, false, false, false] };
  }

  function defaultState() {
    var s = {
      name: "Hero",
      mute: false,
      grandFinaleSeen: false,
      lessons: {}
    };
    LESSON_IDS.forEach(function (id) {
      s.lessons[id] = emptyLesson();
    });
    return s;
  }

  function mergeLesson(target, from) {
    if (!from || typeof from !== "object") return;
    if (Array.isArray(from.missions) && from.missions.length === 5) {
      for (var i = 0; i < 5; i++) target.missions[i] = !!from.missions[i];
    }
    if (Array.isArray(from.quiz) && from.quiz.length === 4) {
      for (var q = 0; q < 4; q++) target.quiz[q] = !!from.quiz[q];
    }
  }

  function loadState() {
    var state = defaultState();
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var o = JSON.parse(raw);
        if (o.name) state.name = String(o.name).slice(0, 24);
        if (typeof o.mute === "boolean") state.mute = o.mute;
        if (typeof o.grandFinaleSeen === "boolean") state.grandFinaleSeen = o.grandFinaleSeen;
        if (o.lessons && typeof o.lessons === "object") {
          LESSON_IDS.forEach(function (id) {
            if (o.lessons[id]) mergeLesson(state.lessons[id], o.lessons[id]);
          });
        }
      }
    } catch (e) {}
    return state;
  }

  function computeLessonXP(lesson) {
    var t = 0;
    lesson.missions.forEach(function (done) {
      if (done) t += XP_MISSION;
    });
    lesson.quiz.forEach(function (done) {
      if (done) t += XP_QUIZ;
    });
    return t;
  }

  function computeGlobalXP(state) {
    var t = 0;
    LESSON_IDS.forEach(function (id) {
      t += computeLessonXP(state.lessons[id]);
    });
    return t;
  }

  function lessonComplete(state, id) {
    var L = state.lessons[id];
    return L.missions.every(Boolean) && L.quiz.every(Boolean);
  }

  var state = loadState();

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {}
  }

  function displayName() {
    var n = state.name && String(state.name).trim() ? String(state.name).trim() : "Hero";
    if (n.length > 22) n = n.slice(0, 22) + "…";
    return n;
  }

  function personalize(text) {
    return String(text).replace(/\{name\}/g, displayName());
  }

  function beep(ok) {
    if (state.mute) return;
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      osc.connect(g);
      g.connect(ctx.destination);
      osc.frequency.value = ok ? 660 : 180;
      osc.type = "sine";
      g.gain.value = 0.07;
      osc.start();
      osc.stop(ctx.currentTime + 0.08);
    } catch (e) {}
  }

  function updateGlobalHUD() {
    var g = computeGlobalXP(state);
    var pct = Math.min(100, (g / MAX_GLOBAL) * 100);
    var tx = document.getElementById("hud-global-xp-text");
    var fill = document.getElementById("hud-global-xp-fill");
    var wrap = document.getElementById("hud-global-xp-bar-wrap");
    if (tx) tx.textContent = g + " / " + MAX_GLOBAL;
    if (fill) fill.style.width = pct + "%";
    if (wrap) wrap.setAttribute("aria-valuenow", String(g));
  }

  function updateChapterHUD(lessonId) {
    var L = state.lessons[lessonId];
    if (!L) return;
    var ch = computeLessonXP(L);
    var tx = document.getElementById("hud-chapter-xp-text");
    var fill = document.getElementById("hud-chapter-xp-fill");
    var wrap = document.getElementById("hud-chapter-xp-bar-wrap");
    if (tx) tx.textContent = ch + " / " + MAX_PER_LESSON;
    if (fill) fill.style.width = Math.min(100, (ch / MAX_PER_LESSON) * 100) + "%";
    if (wrap) wrap.setAttribute("aria-valuenow", String(ch));
  }

  function tryGrandFinale() {
    var all = LESSON_IDS.every(function (id) {
      return lessonComplete(state, id);
    });
    if (!all || state.grandFinaleSeen) return false;
    state.grandFinaleSeen = true;
    save();
    updateGlobalHUD();
    return true;
  }

  function updateQuizHUDForLesson(lessonId) {
    var L = state.lessons[lessonId];
    if (!L) return;
    var n = 0;
    for (var i = 0; i < 4; i++) {
      if (L.quiz[i]) n++;
    }
    var el = document.getElementById("hud-quiz-text");
    var fill = document.getElementById("hud-quiz-fill");
    var wrap = document.getElementById("hud-quiz-bar-wrap");
    if (el) el.textContent = n + " / 4";
    if (fill) fill.style.width = Math.min(100, (n / 4) * 100) + "%";
    if (wrap) wrap.setAttribute("aria-valuenow", String(n));
  }

  function refreshLessonHUD(lessonId) {
    updateGlobalHUD();
    updateChapterHUD(lessonId);
    updateQuizHUDForLesson(lessonId);
    var cn = document.getElementById("hud-codename");
    if (cn) {
      cn.textContent = "Hero: " + displayName();
      cn.setAttribute("title", displayName());
    }
  }

  global.LexiconGame = {
    STORAGE_KEY: STORAGE_KEY,
    state: state,
    LESSON_IDS: LESSON_IDS,
    XP_MISSION: XP_MISSION,
    XP_QUIZ: XP_QUIZ,
    MAX_GLOBAL: MAX_GLOBAL,
    MAX_PER_LESSON: MAX_PER_LESSON,
    save: save,
    loadState: loadState,
    computeGlobalXP: function () {
      return computeGlobalXP(state);
    },
    computeLessonXP: function (lessonId) {
      return computeLessonXP(state.lessons[lessonId]);
    },
    lessonComplete: function (lessonId) {
      return lessonComplete(state, lessonId);
    },
    isMissionDone: function (lessonId, idx) {
      return !!state.lessons[lessonId].missions[idx];
    },
    isQuizDone: function (lessonId, idx) {
      return !!state.lessons[lessonId].quiz[idx];
    },
    completeMission: function (lessonId, idx) {
      if (state.lessons[lessonId].missions[idx]) return 0;
      state.lessons[lessonId].missions[idx] = true;
      save();
      updateGlobalHUD();
      updateChapterHUD(lessonId);
      return XP_MISSION;
    },
    completeQuizQuestion: function (lessonId, qIdx) {
      if (state.lessons[lessonId].quiz[qIdx]) return 0;
      state.lessons[lessonId].quiz[qIdx] = true;
      save();
      updateGlobalHUD();
      updateChapterHUD(lessonId);
      return XP_QUIZ;
    },
    setName: function (n) {
      state.name = String(n || "Hero").slice(0, 24);
      save();
    },
    setMute: function (m) {
      state.mute = !!m;
      save();
    },
    displayName: displayName,
    personalize: personalize,
    beep: beep,
    updateGlobalHUD: updateGlobalHUD,
    updateChapterHUD: updateChapterHUD,
    tryGrandFinale: tryGrandFinale,
    updateQuizHUDForLesson: updateQuizHUDForLesson,
    refreshLessonHUD: refreshLessonHUD
  };
})(window);
