import { useEffect, useRef, useState } from 'react';

interface Recognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  onresult: ((event: { results: { [index: number]: { [index: number]: { transcript: string } } } }) => void) | null;
  start(): void;
  abort(): void;
}
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};

function abortRecognition(recognition: Recognition | null) {
  if (!recognition) return;
  recognition.onstart = recognition.onend = recognition.onerror = recognition.onresult = null;
  recognition.abort();
}

export function useVoiceInput() {
  const [isListening, setIsListening] = useState(false);
  const active = useRef<Recognition | null>(null);

  function stop() {
    const recognition = active.current;
    active.current = null;
    abortRecognition(recognition);
    setIsListening(false);
  }

  useEffect(() => () => {
    const recognition = active.current;
    active.current = null;
    abortRecognition(recognition);
  }, []);

  function start(onTranscript: (text: string) => void) {
    if (active.current) return;
    const speechWindow = window as SpeechWindow;
    const SpeechRecognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Voice input is not supported in your browser. Please use Chrome or Edge.');
      return;
    }
    const recognition = new SpeechRecognition();
    active.current = recognition;
    recognition.lang = 'en-IN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => { if (active.current === recognition) setIsListening(true); };
    recognition.onend = recognition.onerror = () => {
      if (active.current === recognition) {
        active.current = null;
        setIsListening(false);
      }
    };
    recognition.onresult = event => {
      if (active.current !== recognition) return;
      const transcript = event.results[0]?.[0]?.transcript.trim();
      if (transcript) onTranscript(transcript);
    };
    try {
      recognition.start();
    } catch {
      stop();
    }
  }
  return { isListening, start, stop };
}
