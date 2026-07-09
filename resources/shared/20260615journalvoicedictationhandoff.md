# Handoff: How to make voice dictation work like the Outcrop Corporate Journal

**For:** the other Claude (the other dashboard)
**From:** the Outcrop Inspector dashboard team
**Date:** 2026-06-15
**About:** the working mic / voice-dictation on https://dashboard.outcropinspector.com/ (Corporate Journal → New Entry)

---

## Why this handoff exists

Ken uses the **Corporate Journal** on the Outcrop dashboard for voice dictation and it
works the way he wants:

- The mic types **live** — every word shows on screen as he speaks, no waiting.
- **No lag**, and the stop button is always clickable.
- When he **says "period" it types `.`** and when he **says "comma" it types `,`** —
  it does NOT type the words "Period" or "Comma".
- It keeps listening through pauses, so he doesn't have to repeat himself.

The other dashboard has the opposite problems:

1. It doesn't type while he speaks.
2. It lags, and the Stop button is sometimes not clickable.
3. It types the literal words "Period" and "Comma" instead of `.` and `,`.
4. It lags and he often has to say things twice.

Below is exactly how the working Journal does it. Copy this approach and all four
problems go away. This is plain browser JavaScript using the built-in Web Speech API —
no library, no server call, no API key.

---

## The four fixes (what causes each problem and how the Journal solves it)

### Problem 1 + 4 — "doesn't type live" and "have to say it twice"
**Cause:** Most broken versions only read the **final** result after you stop, and they
let the browser end the session on the first pause.

**Fix — two settings + an auto-restart:**

- `recog.interimResults = true;` → this is what makes words appear **as you speak**
  instead of only after you stop. This is the single most important setting for "type live".
- `recog.continuous = true;` → keeps one session running instead of stopping after one phrase.
- Chrome **still** ends the session on its own after a pause. So in `onend`, if the user
  did not press stop, **restart it automatically**. That's why Ken never has to repeat himself.

```js
recog.interimResults = true;   // show words live as they're spoken
recog.continuous     = true;   // don't stop after the first phrase

recog.onend = () => {
  // Chrome ends continuous sessions on its own after a pause.
  // Restart so dictation continues through pauses.
  if (!userStopped) { try { recog.start(); return; } catch(e){} }
  // ...only here (user really stopped) do we reset the button to 🎤
};
```

### Problem 2 — "lags and the Stop button is not clickable"
**Cause:** if dictation runs heavy work on every result, or the button state is tangled
up with the recognizer, the UI thread stalls and the Stop button stops responding.

**Fix — keep the click handler dead simple and track state with plain flags.** The button
is a toggle: if recording, stop; otherwise start. A `userStopped` flag tells `onend`
whether to restart or actually finish. The handler does almost no work, so it's always
responsive.

```js
let recog = null, recording = false, userStopped = false;

btn.addEventListener('click', () => {
  if (recording) { stop(); return; }   // already recording → stop immediately
  userStopped = false;
  // ...build recog and start...
});

function stop() {
  if (recording && recog) { userStopped = true; try { recog.stop(); } catch(e){} }
}
```

### Problem 3 — "types Period instead of ." (THE BIG ONE Ken cares about)
**Cause:** the Web Speech API returns the literal words "period" and "comma" in the
transcript. If you drop that text straight into the box, you get the words. You have to
**translate spoken punctuation into real punctuation yourself.**

**Fix — run every transcript through a small replace function before putting it in the box:**

```js
function spokenPunctuation(s) {
  return s
    .replace(/\s*\bquestion mark\b/gi, '?')
    .replace(/\s*\bexclamation (?:point|mark)\b/gi, '!')
    .replace(/\s*\bperiod\b/gi, '.')
    .replace(/\s*\bcomma\b/gi, ',')
    .replace(/\s*\bcolon\b/gi, ':')
    .replace(/\s*\bsemicolon\b/gi, ';')
    .replace(/\s*\bnew (?:line|paragraph)\b/gi, '\n')
    .replace(/[ \t]+([.,?!:;])/g, '$1');   // remove the space before the punctuation
}
```

Notes that make it feel polished:
- `gi` = case-insensitive, so "Period", "PERIOD", "period" all become `.`
- `\b...\b` = word boundaries, so it won't mangle a real word that contains "period".
- The last line pulls the punctuation tight against the previous word ("hello ." → "hello.").

---

## The complete working code (copy/paste reference)

This is the exact, live code from the Outcrop Journal. It attaches a mic button to a
text field. Call `attachDictation(buttonElement, textFieldElement)` once per field.

```js
(function(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const stoppers = [];

  // Convert spoken punctuation words into real punctuation / line breaks.
  function spokenPunctuation(s) {
    return s
      .replace(/\s*\bquestion mark\b/gi, '?')
      .replace(/\s*\bexclamation (?:point|mark)\b/gi, '!')
      .replace(/\s*\bperiod\b/gi, '.')
      .replace(/\s*\bcomma\b/gi, ',')
      .replace(/\s*\bcolon\b/gi, ':')
      .replace(/\s*\bsemicolon\b/gi, ';')
      .replace(/\s*\bnew (?:line|paragraph)\b/gi, '\n')
      .replace(/[ \t]+([.,?!:;])/g, '$1');
  }

  function attachDictation(btn, field) {
    if (!btn || !field) return;
    if (!SR) {                                 // Safari/Firefox have no support
      btn.title = 'Voice dictation needs Chrome or Edge';
      btn.style.opacity = '0.4';
      btn.addEventListener('click', () =>
        alert('Voice dictation needs Chrome or Edge. Please switch browsers to use the mic.'));
      return;
    }
    let recog = null, recording = false, userStopped = false;

    function stop() {
      if (recording && recog) { userStopped = true; try { recog.stop(); } catch(e){} }
    }
    stoppers.push(stop);

    btn.addEventListener('click', () => {
      if (recording) { stop(); return; }
      userStopped = false;
      recog = new SR();
      recog.lang = 'en-US';
      recog.interimResults = true;             // ← live typing
      recog.continuous = true;                 // ← don't stop after one phrase
      recog.maxAlternatives = 1;
      // Start from whatever is already in the field so dictation APPENDS.
      let finalText = field.value ? field.value.replace(/\s+$/, '') + ' ' : '';
      recog.onstart = () => {
        recording = true;
        btn.classList.add('recording');
        btn.textContent = '⏹';
        btn.title = 'Listening… click again to stop.';
        try { field.focus(); } catch(e){}
      };
      recog.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) finalText += t + ' '; else interim += t;
        }
        field.value = spokenPunctuation((finalText + interim).replace(/[ \t]+/g, ' '));
      };
      recog.onerror = (e) => {
        // Permission / hardware errors are fatal; a pause ('no-speech') is not.
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture')
          userStopped = true;
      };
      recog.onend = () => {
        // Chrome ends continuous sessions on its own — restart so dictation
        // continues through pauses (Ken speaks slowly and pauses to think).
        if (!userStopped) { try { recog.start(); return; } catch(e){} }
        recording = false;
        btn.classList.remove('recording');
        btn.textContent = '🎤';
        btn.title = 'Click to dictate — speak, then click again to stop.';
      };
      try { recog.start(); } catch(err) { console.warn(err); }
    });
  }

  // Wire up each field that should have a mic:
  attachDictation(document.getElementById('my-title-mic'),   document.getElementById('my-title'));
  attachDictation(document.getElementById('my-content-mic'), document.getElementById('my-content'));

  // Optional: stop dictation if the modal/panel is closed mid-recording.
  // stoppers.forEach(s => s());
})();
```

---

## The `onresult` loop, explained (this is the heart of "live, no-lag" typing)

Every time the browser hears something it fires `onresult`. Two ideas make it smooth:

- **`finalText`** holds everything the browser has *committed* (isFinal). We keep adding
  to it and never re-process it.
- **`interim`** is the browser's live guess for what's being said *right now*. It changes
  word-by-word as Ken speaks — that's the live feedback.
- We always set the box to `finalText + interim`. So the box shows committed words plus
  the live guess, updating instantly. Starting the loop at `e.resultIndex` (not 0) means
  we only look at new results — that's what keeps it fast and lag-free.

---

## Quick checklist for the other Claude

- [ ] Use `window.SpeechRecognition || window.webkitSpeechRecognition` (don't assume one).
- [ ] Set `interimResults = true` → fixes "doesn't type live".
- [ ] Set `continuous = true` **and** auto-restart in `onend` → fixes "have to say it twice".
- [ ] Keep the button click handler trivial (toggle + flags) → fixes the unclickable Stop button / lag.
- [ ] Run every transcript through `spokenPunctuation()` → fixes "types Period / Comma".
- [ ] Track a `userStopped` flag so the auto-restart knows when to actually quit.
- [ ] Tell users it needs **Chrome or Edge** (Safari/Firefox don't support this API well).

That's the whole thing. No backend, no API key, no library — it's the browser's built-in
speech engine plus the small punctuation translator above.
