/**
 * Shared UI wiring for Orbital Academy & Guild of the Lexicon lessons (missions + quiz + HUD).
 * Requires orbital-game.js or lexicon-game.js. Same DOM hooks as Gene Code (.gce-challenge, .gce-quiz-box).
 */
(function () {
  function confetti(colors) {
    var palette = colors || ["#5eead4", "#4ade80", "#fb7185", "#fbbf24", "#60a5fa", "#a78bfa"];
    var root = document.getElementById("confetti-root");
    if (!root) return;
    root.innerHTML = "";
    for (var i = 0; i < 40; i++) {
      var p = document.createElement("div");
      p.className = "confetti-piece";
      p.style.left = Math.random() * 100 + "%";
      p.style.background = palette[i % palette.length];
      p.style.animationDelay = Math.random() * 0.5 + "s";
      p.style.animationDuration = 2 + Math.random() * 1.5 + "s";
      root.appendChild(p);
    }
    setTimeout(function () {
      root.innerHTML = "";
    }, 3500);
  }

  function init(opts) {
    var G = opts.api;
    if (!G || typeof G.refreshLessonHUD !== "function") return;
    if (window.NexusAcademy && typeof window.NexusAcademy.applyDisplayNameFromManifest === "function") {
      window.NexusAcademy.applyDisplayNameFromManifest();
    }
    var lessonId = opts.lessonId;
    var opLabel = opts.operationLabel || "Operation";
    var storageKey = opts.storageKey || "";
    var defaultName = opts.defaultName || "Explorer";
    var personalize = function (t) {
      return G.personalize(t);
    };

    var prevComplete = G.lessonComplete(lessonId);
    var opTitleEl = document.getElementById("gce-op-title");
    if (opTitleEl) opTitleEl.textContent = opLabel;

    function updateHUD() {
      G.refreshLessonHUD(lessonId);
      var missions = G.state.lessons[lessonId].missions;
      var hud = document.getElementById("hud-missions");
      if (hud) {
        hud.innerHTML = "";
        for (var i = 0; i < 5; i++) {
          var b = document.createElement("button");
          b.type = "button";
          b.className = "mission-dot" + (missions[i] ? " done" : "");
          b.textContent = i + 1;
          b.setAttribute("aria-label", "Mission " + (i + 1) + (missions[i] ? " complete" : ""));
          (function (idx) {
            b.addEventListener("click", function () {
              var el = document.querySelector('[data-mission="' + (idx + 1) + '"]');
              if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
            });
          })(i);
          hud.appendChild(b);
        }
      }
      document.querySelectorAll(".mission-tag").forEach(function (tag) {
        var m = parseInt(tag.getAttribute("data-mission-tag"), 10);
        if (m >= 1 && m <= 5) {
          tag.classList.toggle("done", missions[m - 1]);
        }
      });
      var gr = document.getElementById("hero-greeting");
      if (gr && opts.heroGreeting) {
        gr.textContent = personalize(opts.heroGreeting);
      }
    }

    function showVictory(isGrand) {
      var ov = document.getElementById("victory");
      if (!ov) return;
      var msg = document.getElementById("victory-msg");
      var title = document.getElementById("victory-title");
      var badges = document.getElementById("victory-badges");
      if (isGrand) {
        if (title) title.textContent = opts.grandTitle || "Realm complete";
        if (msg) msg.textContent = personalize(opts.grandMsg || "{name}, you cleared all four units.");
        if (badges) badges.innerHTML = opts.grandBadges || "";
      } else {
        if (title) title.textContent = opts.chapterTitle || "Chapter complete";
        if (msg) msg.textContent = personalize(opts.chapterMsg || "{name}, chapter cleared.");
        if (badges) badges.innerHTML = opts.chapterBadges || "";
      }
      ov.classList.add("active");
      ov.setAttribute("aria-hidden", "false");
      confetti(opts.confettiColors);
      G.beep(true);
    }

    document.getElementById("victory-dismiss") &&
      document.getElementById("victory-dismiss").addEventListener("click", function () {
        var o = document.getElementById("victory");
        if (o) {
          o.classList.remove("active");
          o.setAttribute("aria-hidden", "true");
        }
      });

    function maybeVictory() {
      var was = prevComplete;
      prevComplete = G.lessonComplete(lessonId);
      if (G.tryGrandFinale()) {
        setTimeout(function () {
          showVictory(true);
        }, 400);
        return;
      }
      if (prevComplete && !was) {
        setTimeout(function () {
          showVictory(false);
        }, 400);
      }
    }

    var modal = document.getElementById("codename-modal");
    var input = document.getElementById("codename-input");
    function openCodename() {
      if (!modal || !input) return;
      modal.classList.add("active");
      input.value = G.state.name === defaultName ? "" : G.state.name;
      setTimeout(function () {
        input.focus();
      }, 100);
    }
    function closeCodename() {
      if (modal) modal.classList.remove("active");
    }
    var startBtn = document.getElementById("codename-start");
    if (startBtn) {
      startBtn.addEventListener("click", function () {
        var v = input && input.value.trim();
        if (v) {
          G.setName(v.slice(0, 24));
          if (window.NexusAcademy && window.NexusAcademy.setDisplayName) {
            window.NexusAcademy.setDisplayName(v.slice(0, 24));
          }
        }
        closeCodename();
        updateHUD();
      });
    }
    var editBtn = document.getElementById("btn-edit-name");
    if (editBtn) editBtn.addEventListener("click", openCodename);

    var firstVisit = storageKey ? !localStorage.getItem(storageKey) : false;
    if (firstVisit && modal) openCodename();

    var btnMute = document.getElementById("btn-mute");
    function syncMute() {
      if (btnMute) btnMute.textContent = G.state.mute ? "Sound off" : "Sound on";
    }
    if (btnMute) {
      btnMute.addEventListener("click", function () {
        G.setMute(!G.state.mute);
        syncMute();
      });
    }
    syncMute();

    function markChallengeDone(box) {
      box.classList.add("complete");
      box.querySelectorAll(".choice-btn").forEach(function (b) {
        b.disabled = true;
      });
    }

    document.querySelectorAll(".gce-challenge").forEach(function (box) {
      var mi = parseInt(box.getAttribute("data-mi"), 10);
      if (isNaN(mi) || mi < 0 || mi > 4) return;
      var fb = box.querySelector(".gce-feedback");

      if (G.isMissionDone(lessonId, mi)) {
        markChallengeDone(box);
        if (fb) {
          fb.textContent = "Mission cleared.";
          fb.className = "gce-feedback show ok";
        }
        return;
      }

      box.querySelectorAll(".choice-btn").forEach(function (btn) {
        btn.addEventListener("click", function () {
          if (box.classList.contains("complete")) return;
          var correct = btn.getAttribute("data-correct") === "true";
          box.querySelectorAll(".choice-btn").forEach(function (b) {
            b.disabled = true;
            if (b.getAttribute("data-correct") === "true") b.classList.add("correct");
            else if (b === btn && !correct) b.classList.add("wrong");
          });
          if (correct) {
            G.completeMission(lessonId, mi);
            if (fb) {
              fb.textContent = personalize(opts.missionOk || "{name}, confirmed.");
              fb.className = "gce-feedback show ok";
            }
            box.classList.add("complete");
            G.beep(true);
            updateHUD();
            maybeVictory();
          } else {
            if (fb) {
              fb.innerHTML =
                (opts.missionRetry || "Try again.") +
                ' <button type="button" class="btn-retry">Retry</button>';
              fb.className = "gce-feedback show no";
              var rb = fb.querySelector(".btn-retry");
              if (rb) {
                rb.addEventListener("click", function () {
                  box.querySelectorAll(".choice-btn").forEach(function (b) {
                    b.disabled = false;
                    b.classList.remove("correct", "wrong");
                  });
                  fb.className = "gce-feedback";
                  fb.innerHTML = "";
                });
              }
            }
            G.beep(false);
          }
        });
      });
    });

    document.querySelectorAll(".gce-quiz-box").forEach(function (box) {
      var qi = parseInt(box.getAttribute("data-qi"), 10);
      if (isNaN(qi) || qi < 0 || qi > 3) return;
      var okIdx = parseInt(box.getAttribute("data-ok"), 10);
      var expl = box.querySelector(".explain");

      if (G.isQuizDone(lessonId, qi)) {
        box.setAttribute("data-answered", "1");
        box.querySelectorAll("button").forEach(function (b) {
          b.disabled = true;
        });
        var right = box.querySelector('button[data-i="' + okIdx + '"]');
        if (right) right.classList.add("ok");
        if (expl) expl.classList.add("open");
        return;
      }

      box.querySelectorAll("button").forEach(function (btn) {
        btn.addEventListener("click", function () {
          if (box.getAttribute("data-answered")) return;
          box.setAttribute("data-answered", "1");
          var picked = parseInt(btn.getAttribute("data-i"), 10);
          box.querySelectorAll("button").forEach(function (b) {
            b.disabled = true;
          });
          if (picked === okIdx) {
            btn.classList.add("ok");
            G.completeQuizQuestion(lessonId, qi);
            G.updateGlobalHUD();
            G.updateChapterHUD(lessonId);
            G.updateQuizHUDForLesson(lessonId);
            maybeVictory();
          } else {
            btn.classList.add("bad");
            var r = box.querySelector('button[data-i="' + okIdx + '"]');
            if (r) r.classList.add("ok");
          }
          if (expl) expl.classList.add("open");
        });
      });
    });

    document.querySelectorAll(".reveal").forEach(function (el) {
      if (!("IntersectionObserver" in window)) {
        el.classList.add("in-view");
        return;
      }
      var o = new IntersectionObserver(
        function (ents) {
          ents.forEach(function (e) {
            if (e.isIntersecting) {
              e.target.classList.add("in-view");
              o.unobserve(e.target);
            }
          });
        },
        { rootMargin: "0px 0px -10% 0px", threshold: 0.05 }
      );
      o.observe(el);
    });

    document.querySelectorAll(".flashcard-q").forEach(function (q) {
      q.addEventListener("click", function () {
        q.closest(".flashcard").classList.toggle("open");
      });
      q.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          q.click();
        }
      });
    });

    var jump = document.getElementById("btn-jump-m1");
    if (jump) {
      jump.addEventListener("click", function () {
        var t = document.querySelector('[data-mission="1"]');
        if (t) t.scrollIntoView({ behavior: "smooth" });
      });
    }

    updateHUD();
    prevComplete = G.lessonComplete(lessonId);
  }

  window.RealmLesson = { init: init };
})();
