(function (window) {
  "use strict";
  let enabled = false;
  function tone(frequency, duration) {
    if (!enabled) return false;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return false;
    try {
      const context = new AudioContext(); const oscillator = context.createOscillator(); const gain = context.createGain();
      oscillator.frequency.value = frequency; gain.gain.setValueAtTime(.04, context.currentTime); gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + duration);
      oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + duration); oscillator.onended = () => context.close(); return true;
    } catch (error) { return false; }
  }
  window.MkiteAudio = {
    setEnabled(value) { enabled = Boolean(value); }, isEnabled() { return enabled; },
    success() { return tone(880, .12); }, warning() { return tone(520, .18); }, failure() { return tone(220, .24); },
    speak(message) {
      if (!message || !("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) return false;
      try {
        window.speechSynthesis.cancel();
        const utterance = new window.SpeechSynthesisUtterance(String(message));
        utterance.rate = 1.05; utterance.pitch = 1; utterance.volume = 1;
        window.speechSynthesis.speak(utterance); return true;
      } catch (error) { return false; }
    },
    cancelSpeech() {
      try { if ("speechSynthesis" in window) window.speechSynthesis.cancel(); } catch (error) { /* Speech is optional. */ }
    }
  };
}(window));
