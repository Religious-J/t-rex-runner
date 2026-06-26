/*
 * Leaderboard for t-rex-runner.
 * Stores scores as JSON comments on a GitHub issue (issue #1 of the game repo)
 * via the GitHub REST API. Reads are cached in localStorage for 5 minutes.
 *
 * Hooks into the game via the custom window events 'dino:gameover' and
 * 'dino:restart' dispatched from index.js — no other coupling to the game.
 */
(function () {
    'use strict';

    var REPO = 'Religious-J/t-rex-runner';
    var ISSUE_NUMBER = 1;
    var TOKEN = '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';
    var API_BASE = 'https://api.github.com/repos/' + REPO + '/issues/' + ISSUE_NUMBER + '/comments';
    var CACHE_KEY = 'dino_leaderboard_cache';
    var CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
    var MAX_ENTRIES = 10;

    // ---- DOM ----
    var submitEl, leaderboardEl, nameInput, submitBtn, skipBtn, closeBtn, listEl;

    function buildUI() {
        // Score submission overlay (shown on game over).
        submitEl = document.createElement('div');
        submitEl.id = 'score-submit';
        submitEl.className = 'lb-hidden';
        submitEl.innerHTML =
            '<div class="lb-panel">' +
              '<h3>Game Over!</h3>' +
              '<p>Your score: <span id="lb-final-score">0</span></p>' +
              '<input id="lb-name" type="text" maxlength="16" placeholder="Your name" />' +
              '<div class="lb-buttons">' +
                '<button id="lb-submit-btn">Submit</button>' +
                '<button id="lb-skip-btn" class="lb-secondary">Skip</button>' +
              '</div>' +
            '</div>';
        document.body.appendChild(submitEl);

        // Leaderboard panel (always visible below the game).
        leaderboardEl = document.createElement('div');
        leaderboardEl.id = 'leaderboard';
        leaderboardEl.innerHTML =
            '<div class="lb-header">' +
              '<h3>🏆 Leaderboard</h3>' +
              '<button id="lb-close" class="lb-secondary lb-small">×</button>' +
            '</div>' +
            '<ol id="lb-list"></ol>';
        document.querySelector('.interstitial-wrapper').appendChild(leaderboardEl);

        nameInput = document.getElementById('lb-name');
        submitBtn = document.getElementById('lb-submit-btn');
        skipBtn = document.getElementById('lb-skip-btn');
        closeBtn = document.getElementById('lb-close');
        listEl = document.getElementById('lb-list');

        submitBtn.addEventListener('click', onSubmit);
        skipBtn.addEventListener('click', hideSubmit);
        closeBtn.addEventListener('click', function () {
            leaderboardEl.classList.add('lb-hidden');
        });
        nameInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') onSubmit();
        });
    }

    // ---- Score submission ----
    var currentScore = 0;
    var alreadySubmitted = false;

    function showSubmit(score) {
        currentScore = score;
        document.getElementById('lb-final-score').textContent = score;
        submitEl.classList.remove('lb-hidden');
        // Focus the input so the player can type right away. The game's
        // keydown handlers are on document but they check game state, so
        // typing here won't trigger jumps.
        nameInput.value = '';
        nameInput.focus();
        alreadySubmitted = false;
    }

    function hideSubmit() {
        submitEl.classList.add('lb-hidden');
    }

    function onSubmit() {
        if (alreadySubmitted) {
            hideSubmit();
            return;
        }
        var name = (nameInput.value || '').trim().slice(0, 16) || 'Anonymous';
        alreadySubmitted = true;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';
        submitScore(name, currentScore, function (ok) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit';
            hideSubmit();
            if (ok) {
                // Force a refresh bypassing the cache so the new score shows.
                fetchAndRender(true);
            }
        });
    }

    function submitScore(name, score, cb) {
        var body = JSON.stringify({ name: name, score: score, ts: Date.now() });
        var xhr = new XMLHttpRequest();
        xhr.open('POST', API_BASE, true);
        xhr.setRequestHeader('Authorization', 'Bearer ' + TOKEN);
        xhr.setRequestHeader('Accept', 'application/vnd.github+json');
        xhr.setRequestHeader('X-GitHub-Api-Version', '2022-11-28');
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.onreadystatechange = function () {
            if (xhr.readyState === 4) {
                cb(xhr.status >= 200 && xhr.status < 300);
            }
        };
        xhr.send(JSON.stringify({ body: body }));
    }

    // ---- Leaderboard fetch & render ----
    function getCache() {
        try {
            var raw = localStorage.getItem(CACHE_KEY);
            if (!raw) return null;
            var parsed = JSON.parse(raw);
            if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
            return parsed.data;
        } catch (e) {
            return null;
        }
    }

    function setCache(data) {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: data }));
        } catch (e) { /* ignore */ }
    }

    function fetchLeaderboard(cb) {
        var cached = getCache();
        if (cached) { cb(cached); return; }

        var xhr = new XMLHttpRequest();
        // per_page=100 is the max; enough for a casual leaderboard.
        xhr.open('GET', API_BASE + '?per_page=100', true);
        xhr.setRequestHeader('Accept', 'application/vnd.github+json');
        xhr.setRequestHeader('X-GitHub-Api-Version', '2022-11-28');
        xhr.onreadystatechange = function () {
            if (xhr.readyState === 4) {
                if (xhr.status >= 200 && xhr.status < 300) {
                    var entries = parseComments(JSON.parse(xhr.responseText));
                    entries.sort(function (a, b) { return b.score - a.score; });
                    entries = entries.slice(0, MAX_ENTRIES);
                    setCache(entries);
                    cb(entries);
                } else {
                    cb(null);
                }
            }
        };
        xhr.send();
    }

    function parseComments(comments) {
        var entries = [];
        for (var i = 0; i < comments.length; i++) {
            try {
                var data = JSON.parse(comments[i].body);
                if (data && typeof data.score === 'number' && typeof data.name === 'string') {
                    entries.push({ name: data.name, score: data.score, ts: data.ts || 0 });
                }
            } catch (e) { /* skip non-JSON / malformed comments */ }
        }
        return entries;
    }

    function fetchAndRender(force) {
        if (force) {
            try { localStorage.removeItem(CACHE_KEY); } catch (e) { /* ignore */ }
        }
        fetchLeaderboard(function (entries) {
            renderLeaderboard(entries);
        });
    }

    function renderLeaderboard(entries) {
        listEl.innerHTML = '';
        if (!entries || entries.length === 0) {
            var empty = document.createElement('li');
            empty.className = 'lb-empty';
            empty.textContent = 'No scores yet. Be the first!';
            listEl.appendChild(empty);
            return;
        }
        for (var i = 0; i < entries.length; i++) {
            var li = document.createElement('li');
            var rank = document.createElement('span');
            rank.className = 'lb-rank';
            rank.textContent = (i + 1) + '.';
            var name = document.createElement('span');
            name.className = 'lb-name';
            name.textContent = entries[i].name;
            var score = document.createElement('span');
            score.className = 'lb-score';
            score.textContent = entries[i].score;
            li.appendChild(rank);
            li.appendChild(name);
            li.appendChild(score);
            listEl.appendChild(li);
        }
    }

    // ---- Wire up to game events ----
    function init() {
        buildUI();
        // Load the leaderboard on page open.
        fetchAndRender(false);
        // Refresh on focus (e.g. coming back to the tab).
        window.addEventListener('focus', function () { fetchAndRender(false); });

        window.addEventListener('dino:gameover', function (e) {
            var score = e && e.detail ? e.detail.score : 0;
            showSubmit(score);
        });
        window.addEventListener('dino:restart', function () {
            hideSubmit();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
