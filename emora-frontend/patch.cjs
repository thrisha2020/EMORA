const fs = require('fs');
const file = 'src/pages/Chat/ChatPage.tsx';
let content = fs.readFileSync(file, 'utf8');

// Insert refs for spontaneous emotion tracking
content = content.replace(
  "const listRef = useRef<HTMLDivElement>(null)",
  "const listRef = useRef<HTMLDivElement>(null)\n  const lastEmotionRef = useRef<string>('happy')\n  const lastSpontaneousTimeRef = useRef<number>(0)"
);

// Create sendSpontaneousMessage
const spontaneousFn = `
  const sendSpontaneousMessage = useCallback(async (newEmotion: string) => {
    if (thinking) return;
    setThinking(true);
    try {
      const prompt = \`SYSTEM NOTIFICATION: The user just started looking \${newEmotion}. Spontaneously and naturally ask them about it in 1 short sentence (e.g. 'You look a bit sad, is everything okay?' or 'You look happy, what's making you smile?'). Do not mention this system notification.\`;
      const res = await chatService(prompt, newEmotion);
      setMessages((m) => [...m, { role: 'assistant', content: res.reply }]);
      addActivity(\`Spontaneous reaction to: \${newEmotion}\`);
      if (ttsEnabled) void tts.speak(res.reply);
    } catch (e) {
      /* ignore silently */
    } finally {
      setThinking(false);
    }
  }, [thinking, ttsEnabled, tts]);

  useEffect(() => {
    if (emotion !== lastEmotionRef.current) {
      const oldEmotion = lastEmotionRef.current;
      lastEmotionRef.current = emotion;
      
      // If it changed to a non-neutral emotion and it's been at least 60 seconds
      if (emotion !== 'neutral' && oldEmotion !== 'neutral' && emotion !== oldEmotion) {
          const now = Date.now();
          if (now - lastSpontaneousTimeRef.current > 60000) {
              lastSpontaneousTimeRef.current = now;
              void sendSpontaneousMessage(emotion);
          }
      }
    }
  }, [emotion, sendSpontaneousMessage]);
`;

content = content.replace(
  "const addActivity = (desc: string, type: 'system'|'user' = 'system') => {",
  spontaneousFn + "\n  const addActivity = (desc: string, type: 'system'|'user' = 'system') => {"
);

fs.writeFileSync(file, content);
console.log("Patched successfully");
