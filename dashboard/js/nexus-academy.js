/**
 * Nexus Academy — cross-game manifest + aggregate XP.
 * Requires GeneCodeGame, OrbitalGame, LexiconGame if their scripts are loaded (for live reads).
 */
(function (global) {
  var NEXUS_KEY = "nexusAcademy_v1";

  function loadManifest() {
    var d = {
      schemaVersion: 1,
      displayName: "",
      lastPlayed: null,
      muteUiSounds: true
    };
    try {
      var raw = localStorage.getItem(NEXUS_KEY);
      if (raw) {
        var o = JSON.parse(raw);
        if (o.displayName) d.displayName = String(o.displayName).slice(0, 24);
        if (o.lastPlayed && typeof o.lastPlayed === "object") d.lastPlayed = o.lastPlayed;
        if (typeof o.muteUiSounds === "boolean") d.muteUiSounds = o.muteUiSounds;
      }
    } catch (e) {}
    return d;
  }

  function saveManifest(m) {
    try {
      localStorage.setItem(NEXUS_KEY, JSON.stringify(m));
    } catch (e) {}
  }

  function xpGeneCode() {
    if (global.GeneCodeGame && typeof global.GeneCodeGame.computeGlobalXP === "function") {
      return global.GeneCodeGame.computeGlobalXP();
    }
    return xpFromStorage("geneCodeExplorer_v2", ["dna", "heredity", "cells", "evolution"]);
  }

  function xpOrbital() {
    if (global.OrbitalGame && typeof global.OrbitalGame.computeGlobalXP === "function") {
      return global.OrbitalGame.computeGlobalXP();
    }
    return xpFromStorage("orbitalAcademy_v1", ["launch", "transfer", "sensors", "geometry"]);
  }

  function xpLexicon() {
    if (global.LexiconGame && typeof global.LexiconGame.computeGlobalXP === "function") {
      return global.LexiconGame.computeGlobalXP();
    }
    return xpFromStorage("lexiconGuild_v1", ["map", "voices", "forge", "sigils"]);
  }

  function xpFromStorage(key, lessonIds) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return 0;
      var o = JSON.parse(raw);
      if (!o.lessons) return 0;
      var t = 0;
      var XP_MISSION = 100;
      var XP_QUIZ = 25;
      lessonIds.forEach(function (id) {
        var L = o.lessons[id];
        if (!L) return;
        if (L.missions) {
          L.missions.forEach(function (done) {
            if (done) t += XP_MISSION;
          });
        }
        if (L.quiz) {
          L.quiz.forEach(function (done) {
            if (done) t += XP_QUIZ;
          });
        }
      });
      return t;
    } catch (e) {
      return 0;
    }
  }

  function syncNameToGames(name) {
    if (!name) return;
    if (global.GeneCodeGame && global.GeneCodeGame.setName) global.GeneCodeGame.setName(name);
    if (global.OrbitalGame && global.OrbitalGame.setName) global.OrbitalGame.setName(name);
    if (global.LexiconGame && global.LexiconGame.setName) global.LexiconGame.setName(name);
  }

  function recordLastPlayed(gameId, href) {
    var m = loadManifest();
    m.lastPlayed = {
      gameId: gameId,
      href: href,
      updatedAt: new Date().toISOString()
    };
    saveManifest(m);
  }

  function setDisplayName(name) {
    var m = loadManifest();
    m.displayName = String(name || "").slice(0, 24);
    saveManifest(m);
    syncNameToGames(m.displayName);
  }

  function getAggregate() {
    var g1 = xpGeneCode();
    var g2 = xpOrbital();
    var g3 = xpLexicon();
    return {
      geneCode: g1,
      orbital: g2,
      lexicon: g3,
      total: g1 + g2 + g3,
      maxTotal: 2400 * 3
    };
  }

  global.NexusAcademy = {
    STORAGE_KEY: NEXUS_KEY,
    loadManifest: loadManifest,
    saveManifest: saveManifest,
    getAggregate: getAggregate,
    setDisplayName: setDisplayName,
    syncNameToGames: syncNameToGames,
    recordLastPlayed: recordLastPlayed,
    xpGeneCode: xpGeneCode,
    xpOrbital: xpOrbital,
    xpLexicon: xpLexicon
  };
})(window);
