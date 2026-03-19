/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, Square } from 'lucide-react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { motion } from 'motion/react';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

type Message = {
  role: 'user' | 'ai';
  text: string;
  timestamp: string;
};

export default function App() {
  const [isListening, setIsListening] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentAiText, setCurrentAiText] = useState('');
  const [currentUserText, setCurrentUserText] = useState('');

  const sessionRef = useRef<any>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const recognitionRef = useRef<any>(null);
  const isListeningRef = useRef(false);
  
  const currentAiTextRef = useRef('');
  const currentUserTextRef = useRef('');

  useEffect(() => { currentUserTextRef.current = currentUserText; }, [currentUserText]);
  useEffect(() => { currentAiTextRef.current = currentAiText; }, [currentAiText]);
  useEffect(() => { isListeningRef.current = isListening; }, [isListening]);

  const saveToGoogleSheets = async (userText: string, aiText: string) => {
    const scriptUrl = (import.meta as any).env.VITE_GOOGLE_SCRIPT_URL;
    if (!scriptUrl) {
      console.warn("VITE_GOOGLE_SCRIPT_URL is not set. Skipping Google Sheets logging.");
      return;
    }
    try {
      await fetch(scriptUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user: userText,
          ai: aiText,
          time: new Date().toISOString()
        })
      });
    } catch (err) {
      console.error("Failed to save to Google Sheets", err);
    }
  };

  const playAudio = useCallback((base64: string) => {
    if (!playbackCtxRef.current) {
      playbackCtxRef.current = new AudioContext({ sampleRate: 24000 });
    }
    const ctx = playbackCtxRef.current;
    
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const int16Data = new Int16Array(bytes.buffer);
    const float32Data = new Float32Array(int16Data.length);
    for (let i = 0; i < int16Data.length; i++) {
      float32Data[i] = int16Data[i] / 32768.0;
    }

    const audioBuffer = ctx.createBuffer(1, float32Data.length, 24000);
    audioBuffer.getChannelData(0).set(float32Data);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    if (nextPlayTimeRef.current < ctx.currentTime) {
      nextPlayTimeRef.current = ctx.currentTime;
    }
    source.start(nextPlayTimeRef.current);
    nextPlayTimeRef.current += audioBuffer.duration;
  }, []);

  const connectLive = useCallback(async () => {
    if (sessionRef.current) return;

    try {
      const sessionPromise = ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-12-2025",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } },
          },
          systemInstruction: "너는 일상적인 대화를 나누는 원어민 친구야. 내가 영어로 말하면 자연스럽게 대답해주고, 대화가 끊이지 않게 질문도 던져줘.",
        },
        callbacks: {
          onopen: () => {
            setIsConnected(true);
          },
          onmessage: (message: LiveServerMessage) => {
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio) {
              playAudio(base64Audio);
            }

            if (message.serverContent?.modelTurn) {
              const parts = message.serverContent.modelTurn.parts;
              for (const part of parts) {
                if (part.text) {
                  setCurrentAiText((prev) => prev + part.text);
                }
              }
            }
            
            if (message.serverContent?.interrupted) {
               if (playbackCtxRef.current) {
                 playbackCtxRef.current.close();
                 playbackCtxRef.current = null;
                 nextPlayTimeRef.current = 0;
               }
            }
            
            if ((message.serverContent as any)?.turnComplete) {
              const userText = currentUserTextRef.current;
              const aiText = currentAiTextRef.current;
              
              if (userText || aiText) {
                setMessages(prev => [
                  ...prev, 
                  ...(userText ? [{ role: 'user' as const, text: userText, timestamp: new Date().toISOString() }] : []),
                  ...(aiText ? [{ role: 'ai' as const, text: aiText, timestamp: new Date().toISOString() }] : [])
                ]);
                saveToGoogleSheets(userText, aiText);
              }
              
              setCurrentUserText('');
              setCurrentAiText('');
            }
          },
          onclose: () => {
            setIsConnected(false);
            sessionRef.current = null;
          }
        }
      });
      sessionRef.current = sessionPromise;
    } catch (err) {
      console.error("Failed to connect to Live API", err);
    }
  }, [playAudio]);

  useEffect(() => {
    if ('webkitSpeechRecognition' in window) {
      const SpeechRecognition = (window as any).webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event: any) => {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          }
        }
        if (finalTranscript) {
           setCurrentUserText((prev) => prev + ' ' + finalTranscript);
        }
      };
      
      recognition.onend = () => {
        if (isListeningRef.current) {
          try { recognition.start(); } catch (e) {}
        }
      };
      
      recognitionRef.current = recognition;
    }
    
    connectLive();
    
    return () => {
      if (sessionRef.current) {
        // cleanup if needed
      }
    };
  }, [connectLive]);

  const startListening = async () => {
    if (!sessionRef.current) {
      await connectLive();
    }
    
    setIsListening(true);
    
    if (recognitionRef.current) {
      try { recognitionRef.current.start(); } catch (e) {}
    }

    try {
      mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioCtxRef.current = new AudioContext({ sampleRate: 16000 });
      await audioCtxRef.current.audioWorklet.addModule('/audio-processor.js');
      
      const source = audioCtxRef.current.createMediaStreamSource(mediaStreamRef.current);
      workletNodeRef.current = new AudioWorkletNode(audioCtxRef.current, 'audio-processor');
      
      workletNodeRef.current.port.onmessage = (event) => {
        const float32Data = event.data as Float32Array;
        const int16Data = new Int16Array(float32Data.length);
        for (let i = 0; i < float32Data.length; i++) {
          let s = Math.max(-1, Math.min(1, float32Data[i]));
          int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        const buffer = new Uint8Array(int16Data.buffer);
        let binary = '';
        for (let i = 0; i < buffer.byteLength; i++) {
          binary += String.fromCharCode(buffer[i]);
        }
        const base64 = btoa(binary);
        
        if (sessionRef.current) {
          sessionRef.current.then((session: any) => {
            session.sendRealtimeInput({
              audio: { data: base64, mimeType: 'audio/pcm;rate=16000' }
            });
          });
        }
      };
      
      source.connect(workletNodeRef.current);
    } catch (err) {
      console.error("Error accessing microphone", err);
      setIsListening(false);
    }
  };

  const stopListening = () => {
    setIsListening(false);
    
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
  };

  useEffect(() => {
    let timeout: NodeJS.Timeout;
    if (currentAiText && !isListening) {
      timeout = setTimeout(() => {
        const userText = currentUserTextRef.current;
        const aiText = currentAiTextRef.current;
        
        if (userText || aiText) {
          setMessages(prev => [
            ...prev, 
            ...(userText ? [{ role: 'user' as const, text: userText, timestamp: new Date().toISOString() }] : []),
            ...(aiText ? [{ role: 'ai' as const, text: aiText, timestamp: new Date().toISOString() }] : [])
          ]);
          saveToGoogleSheets(userText, aiText);
        }
        
        setCurrentUserText('');
        setCurrentAiText('');
      }, 3000);
    }
    return () => clearTimeout(timeout);
  }, [currentAiText, isListening]);

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 flex flex-col items-center py-12 px-4 font-sans">
      <div className="w-full max-w-2xl flex flex-col items-center gap-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tight text-stone-900 mb-2">My AI Friend</h1>
          <p className="text-stone-500">Your friendly English study partner</p>
        </div>

        {/* Chat Log */}
        <div className="w-full bg-white rounded-3xl shadow-sm border border-stone-200 p-6 h-[400px] overflow-y-auto flex flex-col gap-4">
          {messages.length === 0 && !currentUserText && !currentAiText && (
            <div className="flex-1 flex items-center justify-center text-stone-400 italic">
              Press the microphone button to start talking...
            </div>
          )}
          
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              <span className="text-xs text-stone-400 mb-1 px-1">{msg.role === 'user' ? 'You' : 'AI Friend'}</span>
              <div className={`px-5 py-3 rounded-2xl max-w-[85%] ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-tr-sm' : 'bg-stone-100 text-stone-800 rounded-tl-sm'}`}>
                {msg.text}
              </div>
            </div>
          ))}
          
          {/* Current Turn */}
          {currentUserText && (
            <div className="flex flex-col items-end">
              <span className="text-xs text-stone-400 mb-1 px-1">You</span>
              <div className="px-5 py-3 rounded-2xl max-w-[85%] bg-indigo-600/80 text-white rounded-tr-sm">
                {currentUserText}
              </div>
            </div>
          )}
          {currentAiText && (
            <div className="flex flex-col items-start">
              <span className="text-xs text-stone-400 mb-1 px-1">AI Friend</span>
              <div className="px-5 py-3 rounded-2xl max-w-[85%] bg-stone-100 text-stone-800 rounded-tl-sm">
                {currentAiText}
              </div>
            </div>
          )}
        </div>

        {/* Push to Talk Button */}
        <div className="relative mt-4">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={isListening ? stopListening : startListening}
            className={`relative z-10 flex items-center justify-center w-32 h-32 rounded-full shadow-xl transition-colors duration-300 ${
              isListening ? 'bg-red-500 hover:bg-red-600' : 'bg-indigo-600 hover:bg-indigo-700'
            }`}
          >
            {isListening ? (
              <div className="flex flex-col items-center text-white">
                <Square className="w-10 h-10 mb-1 fill-current" />
                <span className="text-sm font-medium tracking-wide">Stop</span>
              </div>
            ) : (
              <div className="flex flex-col items-center text-white">
                <Mic className="w-12 h-12 mb-1" />
                <span className="text-sm font-medium tracking-wide">Talk</span>
              </div>
            )}
          </motion.button>
          
          {/* Ripple effect when listening */}
          {isListening && (
            <>
              <span className="absolute inset-0 rounded-full border-4 border-red-500 animate-ping opacity-30"></span>
              <span className="absolute inset-[-1rem] rounded-full border-4 border-red-500 animate-ping opacity-10" style={{ animationDelay: '0.2s' }}></span>
            </>
          )}
        </div>
        
        <div className="flex items-center gap-2 text-sm font-medium mt-2">
          <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-stone-300'}`}></div>
          <span className={isConnected ? 'text-emerald-600' : 'text-stone-500'}>
            {isConnected ? 'Connected to AI' : 'Connecting...'}
          </span>
        </div>
      </div>
    </div>
  );
}
