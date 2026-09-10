import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { Highlight } from '@tiptap/extension-highlight';
import { FontFamily } from '@tiptap/extension-font-family';
import { TextAlign } from '@tiptap/extension-text-align';
import { Image } from '@tiptap/extension-image';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import Heading from '@tiptap/extension-heading';
import { useDebouncedCallback } from 'use-debounce';
import { Extension } from '@tiptap/core';
import TiptapSuperscript from '@tiptap/extension-superscript';
import TiptapSubscript from '@tiptap/extension-subscript';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (size: string) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
    indent: {
      indent: () => ReturnType;
      outdent: () => ReturnType;
    };
  }
}
import { 
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, 
  Type, Palette, AlignLeft, AlignCenter, AlignRight, AlignJustify,
  List, ListOrdered, CheckSquare, Minus, Plus, Save, Image as ImageIcon,
  Indent, Outdent, Mic, Loader2, Square, Sparkles, X, Volume2, Circle, Check, RotateCcw,
  Trash2, Download, Superscript, Subscript
} from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';

import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage, auth } from '../lib/firebase';

const TabKeyExtension = Extension.create({
  name: 'tabKey',
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        if (this.editor.can().sinkListItem('listItem')) {
          return this.editor.commands.sinkListItem('listItem');
        }
        if (this.editor.can().sinkListItem('taskItem')) {
          return this.editor.commands.sinkListItem('taskItem');
        }
        return this.editor.commands.insertContent('\u00A0\u00A0\u00A0\u00A0\u00A0');
      },
      'Shift-Tab': () => {
        if (this.editor.can().liftListItem('listItem')) {
          return this.editor.commands.liftListItem('listItem');
        }
        if (this.editor.can().liftListItem('taskItem')) {
          return this.editor.commands.liftListItem('taskItem');
        }
        return true;
      }
    };
  }
});

const FontSize = Extension.create({
  addOptions() {
    return { types: ['textStyle'] };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: element => element.style.fontSize.replace(/['"]+/g, ''),
            renderHTML: attributes => {
              if (!attributes.fontSize) return {};
              return { style: `font-size: ${attributes.fontSize}` };
            },
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setFontSize: (fontSize: string) => ({ chain }: any) => {
        return chain().setMark('textStyle', { fontSize }).run();
      },
      unsetFontSize: () => ({ chain }: any) => {
        return chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run();
      },
    };
  },
});

const IndentExtension = Extension.create({
  name: 'indent',
  addOptions() {
    return {
      types: ['paragraph', 'heading'],
      minLevel: 0,
      maxLevel: 8,
    };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          indent: {
            default: 0,
            parseHTML: element => parseInt(element.style.marginLeft) || 0,
            renderHTML: attributes => {
              if (!attributes.indent) return {};
              return { style: `margin-left: ${attributes.indent * 2}rem` };
            },
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      indent: () => ({ tr, state, dispatch }: any) => {
        const { selection } = state;
        tr = tr.setSelection(selection);
        tr = state.tr;
        
        state.doc.nodesBetween(selection.from, selection.to, (node: any, pos: any) => {
          if (this.options.types.includes(node.type.name)) {
            const indent = (node.attrs.indent || 0) + 1;
            if (indent <= this.options.maxLevel) {
              tr = tr.setNodeMarkup(pos, node.type, { ...node.attrs, indent });
            }
          }
        });
        
        if (dispatch) dispatch(tr);
        return true;
      },
      outdent: () => ({ tr, state, dispatch }: any) => {
        const { selection } = state;
        tr = tr.setSelection(selection);
        tr = state.tr;
        
        state.doc.nodesBetween(selection.from, selection.to, (node: any, pos: any) => {
          if (this.options.types.includes(node.type.name)) {
            const indent = (node.attrs.indent || 0) - 1;
            if (indent >= this.options.minLevel) {
              tr = tr.setNodeMarkup(pos, node.type, { ...node.attrs, indent });
            }
          }
        });
        
        if (dispatch) dispatch(tr);
        return true;
      },
    };
  },
});

interface EditorProps {
  title?: string;
  onTitleChange?: (title: string) => void;
  theme?: 'amoled' | 'light' | 'dusk';
  content: string;
  onChange: (content: string) => void;
  onExport: (format: 'txt' | 'pdf' | 'docx' | 'html') => void;
  onSave?: (content: string) => Promise<void>;
  onDelete?: () => Promise<boolean>;
  fonts?: string[];
  onAlert?: (title: string, message: string) => void;
}

export default function Editor({ title, onTitleChange, theme = 'amoled', content, onChange, onExport, onSave, onDelete, fonts, onAlert }: EditorProps) {
  const [showExportOptions, setShowExportOptions] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showImagePrompt, setShowImagePrompt] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  
  const [isRecording, setIsRecording] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const recognitionRef = useRef<any>(null);

  const [isUploading, setIsUploading] = useState(false);

  // Gemini AI Voice Dictation States
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [isGeminiRecording, setIsGeminiRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [audioLevels, setAudioLevels] = useState<number[]>(Array(15).fill(3));
  const [transcriptionResult, setTranscriptionResult] = useState('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const durationIntervalRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, []);

  const startGeminiRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      setRecordingDuration(0);
      setTranscriptionResult('');
      
      let options = {};
      if (MediaRecorder.isTypeSupported('audio/webm')) {
        options = { mimeType: 'audio/webm' };
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        options = { mimeType: 'audio/mp4' };
      }
      
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await transcribeWithGemini(audioBlob);
      };

      // Set up Web Audio API visualizer
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      
      audioContextRef.current = audioCtx;
      analyserRef.current = analyser;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      
      const updateVisualizer = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        // Map frequencies to level heights
        const levels = Array.from(dataArray.slice(0, 15)).map(v => Math.max(3, (v / 255) * 50));
        setAudioLevels(levels);
        animationRef.current = requestAnimationFrame(updateVisualizer);
      };
      
      mediaRecorder.start();
      setIsGeminiRecording(true);
      updateVisualizer();

      durationIntervalRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);

    } catch (err) {
      console.error("Microphone access failed:", err);
      if (onAlert) {
        onAlert("Microphone Error", "Could not access microphone. Please check permissions.");
      } else {
        alert("Could not access microphone. Please check permissions.");
      }
    }
  };

  const stopGeminiRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
    
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
    }
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
    }
    
    setIsGeminiRecording(false);
  };

  const transcribeWithGemini = async (blob: Blob) => {
    setIsTranscribing(true);
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    reader.onloadend = async () => {
      const base64data = reader.result?.toString().split(',')[1];
      try {
        const res = await fetch('/api/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audio: base64data, mimeType: blob.type })
        });
        
        if (!res.ok) throw new Error("Transcription failed");
        
        const data = await res.json();
        if (data.text) {
          setTranscriptionResult(data.text);
        } else {
          setTranscriptionResult("No speech detected. Please speak clearly near the microphone.");
        }
      } catch (err) {
        console.error(err);
        setTranscriptionResult("Error polishing audio. Please try again or use the Live Streaming dictate option.");
      } finally {
        setIsTranscribing(false);
      }
    };
  };

  const formatDuration = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const startRecording = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      if (onAlert) {
        onAlert("Web Speech Error", "Web Speech API is not supported in this browser. Please use Chrome, Edge, or Safari for voice dictation.");
      } else {
        alert("Web Speech API is not supported in this browser. Please use Chrome, Edge, or Safari for voice dictation.");
      }
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsRecording(true);
        setInterimTranscript('');
      };

      recognition.onresult = (event: any) => {
        let finalTranscript = '';
        let currentInterim = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const result = event.results[i];
          const transcript = result[0].transcript;
          if (result.isFinal) {
            finalTranscript += transcript;
          } else {
            currentInterim += transcript;
          }
        }

        setInterimTranscript(currentInterim);

        if (finalTranscript && editor) {
          // Clean up multiple spaces and map punctuation commands
          let formattedText = finalTranscript;
          formattedText = formattedText.replace(/\bperiod\b/gi, '.');
          formattedText = formattedText.replace(/\bcomma\b/gi, ',');
          formattedText = formattedText.replace(/\bquestion mark\b/gi, '?');
          formattedText = formattedText.replace(/\bexclamation point\b/gi, '!');
          formattedText = formattedText.replace(/\bnew paragraph\b/gi, '\n\n');
          formattedText = formattedText.replace(/\bnew line\b/gi, '\n');

          // Ensure spacing around inserted content
          editor.chain().focus().insertContent(formattedText + ' ').run();
        }
      };

      recognition.onerror = (event: any) => {
        console.error("Speech recognition error:", event.error);
        if (event.error === 'not-allowed') {
          if (onAlert) {
            onAlert("Microphone Permission", "Microphone permission denied. Please enable microphone access in your browser settings.");
          } else {
            alert("Microphone permission denied. Please enable microphone access in your browser settings.");
          }
        } else if (event.error === 'no-speech') {
          // Ignore transient silent periods
          setInterimTranscript('');
        } else {
          if (onAlert) {
            onAlert("Speech Error", `Speech recognition error: ${event.error}`);
          } else {
            alert(`Speech recognition error: ${event.error}`);
          }
          stopRecording();
        }
      };

      recognition.onend = () => {
        setIsRecording(false);
        setInterimTranscript('');
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.error("Failed to start Speech Recognition:", err);
      if (onAlert) {
        onAlert("Speech Error", "Failed to start voice dictation.");
      } else {
        alert("Failed to start voice dictation.");
      }
    }
  };

  const stopRecording = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsRecording(false);
    setInterimTranscript('');
  };
  
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!auth.currentUser) {
      if (onAlert) {
        onAlert("Authentication Error", "You must be logged in to upload images.");
      } else {
        alert("You must be logged in to upload images.");
      }
      return;
    }

    setIsUploading(true);
    try {
      const storageRef = ref(storage, `users/${auth.currentUser.uid}/images/${Date.now()}-${file.name}`);
      const snapshot = await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(snapshot.ref);
      
      editor?.chain().focus().setImage({ src: downloadURL }).run();
      setShowImagePrompt(false);
    } catch (error: any) {
      console.error("Error uploading image: ", error);
      if (onAlert) {
        onAlert("Upload Failed", "Failed to upload image.");
      } else {
        alert("Failed to upload image.");
      }
    } finally {
      setIsUploading(false);
    }
  };
  
  const debouncedOnChange = useDebouncedCallback((html: string) => {
    onChange(html);
  }, 1000);

  // Flush debounced changes on unmount to prevent data loss on tab/date switch
  useEffect(() => {
    return () => {
      debouncedOnChange.flush();
    };
  }, [debouncedOnChange]);

  const handleSaveClick = async () => {
    if (!onSave || !editor) return;
    setIsSaving(true);
    try {
      debouncedOnChange.flush();
      await onSave(editor.getHTML());
      setToastMessage("Changes saved to Firestore Archive successfully!");
      setTimeout(() => setToastMessage(null), 3000);
    } catch (e: any) {
      setToastMessage(`Save failed: ${e.message || e}`);
      setTimeout(() => setToastMessage(null), 4000);
    } finally {
      setIsSaving(false);
    }
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false, // We use custom heading
      }),
      Heading.configure({ levels: [1, 2, 3, 4, 5, 6] }),
      IndentExtension,
      Underline,
      TextStyle,
      FontSize,
      Color,
      Highlight.configure({ multicolor: true }),
      FontFamily,
      TiptapSuperscript,
      TiptapSubscript,
      TabKeyExtension,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Image,
      TaskList.configure({
        HTMLAttributes: {
          class: 'not-prose pl-2',
        },
      }),
      TaskItem.configure({
        nested: true,
        HTMLAttributes: {
          class: 'flex items-start my-1',
        },
      }),
    ],
    content,
    onUpdate: ({ editor }) => {
      debouncedOnChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: 'prose prose-invert max-w-none focus:outline-none min-h-[60vh] p-6 tracking-wide whitespace-pre-wrap',
        style: 'font-weight: 200;'
      },
      parseOptions: {
        preserveWhitespace: 'full',
      },
    } as any,
  });

  if (!editor) return null;

  const fontOptions = [
    { name: 'Default', value: 'Century Gothic' },
    { name: 'Poiret One', value: 'Poiret One' },
    { name: 'Arima', value: 'Arima' },
    { name: 'Bellota', value: 'Bellota' },
    { name: 'Comic Neue', value: 'Comic Neue' },
    { name: 'Playpen Sans', value: 'Playpen Sans' },
    { name: 'Montserrat', value: 'Montserrat Alternates' },
    { name: 'Bubbler One', value: 'Bubbler One' },
    { name: 'Petit Formal', value: 'Petit Formal Script' },
    { name: 'Handlee', value: 'Handlee' },
    { name: 'Bad Script', value: 'Bad Script' },
    { name: 'Sofia', value: 'Sofia' },
    { name: 'Gabriela', value: 'Gabriela' },
    { name: 'Cinzel', value: 'Cinzel Decorative' },
    { name: 'Cormorant', value: 'Cormorant Infant' },
    { name: 'Josefin Slab', value: 'Josefin Slab' },
  ];

  return (
    <div className="flex flex-col border border-white/10 rounded-xl overflow-hidden glass">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1 p-2 bg-black/40 border-b border-white/10">
        <button
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={`p-2 rounded hover:bg-white/10 ${editor.isActive('bold') ? 'text-neon-blue' : ''}`}
        >
          <Bold size={18} />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`p-2 rounded hover:bg-white/10 ${editor.isActive('italic') ? 'text-neon-blue' : ''}`}
        >
          <Italic size={18} />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          className={`p-2 rounded hover:bg-white/10 ${editor.isActive('underline') ? 'text-neon-blue' : ''}`}
        >
          <UnderlineIcon size={18} />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleStrike().run()}
          className={`p-2 rounded hover:bg-white/10 ${editor.isActive('strike') ? 'text-neon-blue' : ''}`}
        >
          <Strikethrough size={18} />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleSuperscript().run()}
          className={`p-2 rounded hover:bg-white/10 ${editor.isActive('superscript') ? 'text-neon-blue' : ''}`}
          title="Superscript"
        >
          <Superscript size={18} />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleSubscript().run()}
          className={`p-2 rounded hover:bg-white/10 ${editor.isActive('subscript') ? 'text-neon-blue' : ''}`}
          title="Subscript"
        >
          <Subscript size={18} />
        </button>

        <div className="w-px h-6 bg-white/10 mx-1" />

        <select
          onChange={(e) => {
            if (e.target.value === 'Century Gothic' || e.target.value === '') {
              editor.chain().focus().unsetFontFamily().run();
            } else {
              editor.chain().focus().setFontFamily(e.target.value).run();
            }
          }}
          className="bg-transparent text-sm border-none focus:ring-0 text-baby-blue/80 hover:text-white transition-colors cursor-pointer max-w-[120px] truncate"
        >
          <option value="" style={{ backgroundColor: 'var(--bg-secondary)' }}>Font</option>
          {fontOptions.map(f => (
            <option key={f.value} value={f.value} style={{ backgroundColor: 'var(--bg-secondary)' }}>{f.name}</option>
          ))}
        </select>

        <div className="flex items-center gap-1 bg-white/5 rounded-md p-0.5 border border-white/10 select-none">
          <button
            type="button"
            onClick={() => {
              const currentSize = (() => {
                const sizeAttr = editor.getAttributes('textStyle').fontSize;
                if (!sizeAttr) return 16;
                const num = parseInt(sizeAttr, 10);
                return isNaN(num) ? 16 : num;
              })();
              const newSize = Math.max(8, currentSize - 1);
              editor.chain().focus().setFontSize(`${newSize}px`).run();
            }}
            className="p-1 rounded hover:bg-white/10 text-baby-blue/80 hover:text-white transition-colors"
            title="Decrease Text Size"
          >
            <Minus size={12} />
          </button>
          <span className="text-xs font-mono font-bold text-baby-blue/90 px-1.5 min-w-[20px] text-center">
            {(() => {
              const sizeAttr = editor.getAttributes('textStyle').fontSize;
              if (!sizeAttr) return 16;
              const num = parseInt(sizeAttr, 10);
              return isNaN(num) ? 16 : num;
            })()}
          </span>
          <button
            type="button"
            onClick={() => {
              const currentSize = (() => {
                const sizeAttr = editor.getAttributes('textStyle').fontSize;
                if (!sizeAttr) return 16;
                const num = parseInt(sizeAttr, 10);
                return isNaN(num) ? 16 : num;
              })();
              const newSize = Math.min(72, currentSize + 1);
              editor.chain().focus().setFontSize(`${newSize}px`).run();
            }}
            className="p-1 rounded hover:bg-white/10 text-baby-blue/80 hover:text-white transition-colors"
            title="Increase Text Size"
          >
            <Plus size={12} />
          </button>
        </div>

        <div className="w-px h-6 bg-white/10 mx-1" />

        <div className="relative flex items-center justify-center p-2 rounded hover:bg-white/10 w-9 h-9 cursor-pointer" title="Text Color">
          <Palette size={18} className="text-white/70" />
          <input
            type="color"
            onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
            className="opacity-0 absolute inset-0 w-full h-full cursor-pointer z-10"
          />
          <div 
            className="absolute bottom-1 right-1 w-2.5 h-2.5 rounded-full border border-black/50 shadow-sm" 
            style={{ backgroundColor: editor.getAttributes('textStyle').color || '#ffffff' }}
          />
        </div>
        
        <div className="flex shrink-0 gap-1 ml-1">
          {['#ff00ff', '#00ffff', '#bf00ff'].map(color => (
            <button
              key={color}
              onClick={() => editor.chain().focus().toggleHighlight({ color }).run()}
              className="w-5 h-5 rounded-full border border-white/20"
              style={{ backgroundColor: color }}
              title={`Highlight ${color}`}
            />
          ))}
        </div>

        <div className="w-px h-6 bg-white/10 mx-1" />

        <button onClick={() => editor.chain().focus().setTextAlign('left').run()} className={`p-2 rounded hover:bg-white/10 ${editor.isActive({ textAlign: 'left' }) ? 'text-neon-blue' : ''}`}><AlignLeft size={18} /></button>
        <button onClick={() => editor.chain().focus().setTextAlign('center').run()} className={`p-2 rounded hover:bg-white/10 ${editor.isActive({ textAlign: 'center' }) ? 'text-neon-blue' : ''}`}><AlignCenter size={18} /></button>
        <button onClick={() => editor.chain().focus().setTextAlign('right').run()} className={`p-2 rounded hover:bg-white/10 ${editor.isActive({ textAlign: 'right' }) ? 'text-neon-blue' : ''}`}><AlignRight size={18} /></button>
        <button onClick={() => editor.chain().focus().setTextAlign('justify').run()} className={`p-2 rounded hover:bg-white/10 ${editor.isActive({ textAlign: 'justify' }) ? 'text-neon-blue' : ''}`}><AlignJustify size={18} /></button>

        <div className="w-px h-6 bg-white/10 mx-1" />

        <button onClick={() => editor.chain().focus().toggleBulletList().run()} className={`p-2 rounded hover:bg-white/10 ${editor.isActive('bulletList') ? 'text-neon-cyan' : ''}`}><List size={18} /></button>
        <button onClick={() => editor.chain().focus().toggleOrderedList().run()} className={`p-2 rounded hover:bg-white/10 ${editor.isActive('orderedList') ? 'text-neon-cyan' : ''}`}><ListOrdered size={18} /></button>
        <button onClick={() => editor.chain().focus().toggleTaskList().run()} className={`p-2 rounded hover:bg-white/10 ${editor.isActive('taskList') ? 'text-neon-cyan' : ''}`}><CheckSquare size={18} /></button>

        <div className="w-px h-6 bg-white/10 mx-1" />

        <button onClick={() => editor.can().sinkListItem('listItem') ? editor.chain().focus().sinkListItem('listItem').run() : editor.chain().focus().indent().run()} className="p-2 mr-1 rounded hover:bg-white/10" title="Indent"><Indent size={18} /></button>
        <button onClick={() => editor.can().liftListItem('listItem') ? editor.chain().focus().liftListItem('listItem').run() : editor.chain().focus().outdent().run()} className="p-2 mr-1 rounded hover:bg-white/10" title="Outdent"><Outdent size={18} /></button>
        <button onClick={() => editor.chain().focus().setHorizontalRule().run()} className="p-2 rounded hover:bg-white/10"><Minus size={18} /></button>

        <div className="w-px h-6 bg-white/10 mx-1" />

        <div className="relative flex items-center">
          <button onClick={() => setShowImagePrompt(!showImagePrompt)} className="p-2 rounded hover:bg-white/10" title="Add Image"><ImageIcon size={18} /></button>
          
          {isRecording ? (
            <button onClick={stopRecording} className="p-2 ml-1 rounded hover:bg-red-500/20 text-red-400 animate-pulse flex items-center gap-1.5" title="Stop Voice Dictation">
              <Square size={18} fill="currentColor" />
              <span className="text-[10px] tracking-wider uppercase font-bold text-red-400">Stop</span>
            </button>
          ) : (
            <button onClick={startRecording} className="p-2 ml-1 rounded hover:bg-white/10 text-neon-cyan flex items-center gap-1.5" title="Dictate Journal Entry">
              <Mic size={18} />
              <span className="text-[10px] tracking-wider uppercase font-bold text-neon-cyan">Dictate</span>
            </button>
          )}

          <button 
            onClick={() => {
              setShowVoiceModal(true);
              startGeminiRecording();
            }} 
            className="p-2 ml-2 rounded hover:bg-neon-pink/10 text-neon-pink flex items-center gap-1.5 border border-neon-pink/20 bg-neon-pink/5" 
            title="Polished Voice Recording via Gemini AI (Auto-Punctuation)"
          >
            <Sparkles size={16} className="animate-pulse text-neon-pink" />
            <span className="text-[10px] tracking-wider uppercase font-bold text-neon-pink">AI Voice</span>
          </button>

          {showImagePrompt && (
            <div className="absolute top-full left-0 mt-2 z-50 glass p-3 rounded-lg flex flex-col gap-3 w-72 shadow-xl border border-white/10">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-baby-blue/60 uppercase tracking-widest font-bold">Upload Local Image</label>
                <input 
                  type="file" 
                  accept="image/*"
                  onChange={handleImageUpload}
                  disabled={isUploading}
                  className="text-xs text-white file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-white/10 file:text-white hover:file:bg-white/20 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                />
                {isUploading && <span className="text-[10px] text-neon-cyan animate-pulse">Uploading...</span>}
              </div>
              <div className="flex items-center gap-2">
                <div className="h-px bg-white/10 flex-1"></div>
                <span className="text-[10px] text-baby-blue/40 uppercase">OR PASTE LINK</span>
                <div className="h-px bg-white/10 flex-1"></div>
              </div>
              <div className="flex flex-col gap-1">
                <input 
                  type="text" 
                  value={imageUrl} 
                  onChange={e => setImageUrl(e.target.value)} 
                  placeholder="https://example.com/image.jpg" 
                  className="bg-black/50 border border-white/20 text-white text-xs p-2 rounded w-full focus:outline-none focus:border-neon-cyan"
                />
                <div className="flex justify-end gap-2 text-xs mt-1">
                  <button onClick={() => setShowImagePrompt(false)} className="text-white/60 hover:text-white px-2 py-1">Cancel</button>
                  <button 
                    onClick={() => { 
                      if(imageUrl) editor.chain().focus().setImage({ src: imageUrl }).run(); 
                      setShowImagePrompt(false); 
                      setImageUrl(''); 
                    }} 
                    className="bg-neon-cyan/20 text-neon-cyan px-3 py-1 rounded hover:bg-neon-cyan/40"
                  >Insert Link</button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex-grow" />

        <div className="flex items-center gap-1">
          {onSave && (
            <button 
              onClick={handleSaveClick}
              disabled={isSaving}
              className={`p-2 rounded hover:bg-white/10 text-neon-cyan transition-colors cursor-pointer ${isSaving ? 'opacity-50 cursor-wait' : ''}`}
              title="Save Entry to Archive"
            >
              {isSaving ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
            </button>
          )}

          {onDelete && (
            <button 
              onClick={async () => {
                const deleted = await onDelete();
                if (deleted) {
                  editor.commands.setContent('');
                }
              }}
              className="p-2 rounded hover:bg-red-500/15 text-red-400 hover:text-red-500 transition-colors cursor-pointer"
              title="Delete Entry"
            >
              <Trash2 size={20} />
            </button>
          )}

          <div className="relative">
            <button 
              onClick={() => setShowExportOptions(!showExportOptions)}
              className="p-2 rounded hover:bg-white/10 text-neon-pink cursor-pointer"
              title="Export Options"
            >
              <Download size={20} />
            </button>
            
            {showExportOptions && (
              <div className="absolute right-0 top-full mt-2 w-44 glass rounded-lg shadow-xl z-[60] flex flex-col p-2 space-y-1">
                <button onClick={() => { onExport('txt'); setShowExportOptions(false); }} className="text-left px-3 py-2 hover:bg-white/10 rounded text-sm transition-colors text-white cursor-pointer">Export as TXT</button>
                <button onClick={() => { onExport('pdf'); setShowExportOptions(false); }} className="text-left px-3 py-2 hover:bg-white/10 rounded text-sm transition-colors text-white cursor-pointer">Export as PDF</button>
                <button onClick={() => { onExport('docx'); setShowExportOptions(false); }} className="text-left px-3 py-2 hover:bg-white/10 rounded text-sm transition-colors text-white cursor-pointer">Export as DOCX</button>
                <button onClick={() => { onExport('html'); setShowExportOptions(false); }} className="text-left px-3 py-2 hover:bg-white/10 rounded text-sm transition-colors text-white cursor-pointer font-semibold text-neon-cyan">Export as HTML</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Floating Save Toast Notification */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="fixed bottom-6 right-6 z-[110] flex items-center gap-3 px-5 py-3 bg-[#090d16]/90 border border-neon-cyan/40 text-white rounded-xl shadow-[0_0_25px_rgba(0,255,255,0.25)] backdrop-blur-md font-mono text-xs"
          >
            <div className="w-2 h-2 rounded-full bg-neon-cyan animate-pulse" />
            <span>{toastMessage}</span>
            <button onClick={() => setToastMessage(null)} className="text-white/40 hover:text-white ml-2 text-sm font-bold cursor-pointer">&times;</button>
          </motion.div>
        )}
      </AnimatePresence>
      
      {isRecording && (
        <div className="flex items-center gap-3 px-4 py-2 bg-neon-cyan/5 border-b border-neon-cyan/20 text-xs text-neon-cyan animate-pulse">
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-neon-cyan opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-neon-cyan"></span>
            </span>
            <span className="font-bold tracking-widest uppercase text-[10px]">Listening:</span>
          </div>
          <p className="italic text-baby-blue/70 truncate flex-1">
            {interimTranscript || 'Speak to dictate your thoughts... (try "period", "comma", "new line")'}
          </p>
        </div>
      )}

      {/* Editor Content */}
      <div className="flex-grow bg-black/20 overflow-y-auto">
        <EditorContent editor={editor} />
      </div>

      {/* Polished Gemini Voice Dictation Modal */}
      <AnimatePresence>
        {showVoiceModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                if (!isGeminiRecording && !isTranscribing) {
                  setShowVoiceModal(false);
                }
              }}
              className="absolute inset-0 bg-black/85 backdrop-blur-md"
            />

            {/* Modal Body */}
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg glass border border-neon-pink/30 rounded-2xl overflow-hidden p-6 shadow-2xl shadow-neon-pink/5 z-10"
            >
              {/* Close Button */}
              {(!isGeminiRecording && !isTranscribing) && (
                <button 
                  onClick={() => setShowVoiceModal(false)}
                  className="absolute top-4 right-4 text-baby-blue/40 hover:text-white p-1 rounded-full hover:bg-white/5 transition-all"
                >
                  <X size={18} />
                </button>
              )}

              {/* Title Header */}
              <div className="text-center space-y-1">
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-neon-pink/10 border border-neon-pink/20 rounded-full text-[10px] uppercase tracking-widest font-bold text-neon-pink mb-2">
                  <Sparkles size={12} className="animate-spin" style={{ animationDuration: '3s' }} />
                  <span>Gemini AI Speech Polish</span>
                </div>
                <h3 className="text-lg font-bold text-white tracking-wide">AI Polished Dictation</h3>
                <p className="text-xs text-baby-blue/50 max-w-sm mx-auto">
                  Record without interruption. Gemini will handle punctuation, paragraphs, and format your text beautifully once you stop.
                </p>
              </div>

              {/* Visualizer and Status */}
              <div className="my-8 flex flex-col items-center justify-center space-y-4">
                {isGeminiRecording ? (
                  /* Recording Animation */
                  <div className="flex flex-col items-center space-y-3 w-full">
                    <div className="flex items-end justify-center gap-1.5 h-16 w-full">
                      {audioLevels.map((level, idx) => (
                        <div
                          key={idx}
                          className="w-1.5 rounded-t-full bg-gradient-to-t from-neon-pink via-neon-purple to-neon-cyan transition-all duration-75"
                          style={{ height: `${level}px` }}
                        />
                      ))}
                    </div>
                    <div className="flex items-center gap-2 bg-red-500/10 px-3 py-1 rounded-full border border-red-500/25">
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                      </span>
                      <span className="text-xs font-bold text-red-400 font-mono tracking-widest">
                        RECORDING • {formatDuration(recordingDuration)}
                      </span>
                    </div>
                  </div>
                ) : isTranscribing ? (
                  /* Transcribing State */
                  <div className="flex flex-col items-center space-y-4 py-6">
                    <Loader2 size={36} className="text-neon-pink animate-spin" />
                    <div className="text-center space-y-1">
                      <p className="text-sm text-neon-pink font-bold uppercase tracking-widest animate-pulse">Polishing Audio...</p>
                      <p className="text-xs text-baby-blue/40">Gemini is transcribing and adding punctuation</p>
                    </div>
                  </div>
                ) : transcriptionResult ? (
                  /* Result Preview State */
                  <div className="w-full space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-baby-blue/40 font-bold uppercase tracking-widest font-mono">Transcription Preview:</span>
                      <span className="text-[10px] text-neon-cyan font-bold uppercase tracking-widest font-mono flex items-center gap-1">
                        <Check size={12} /> Ready
                      </span>
                    </div>
                    <textarea
                      value={transcriptionResult}
                      onChange={(e) => setTranscriptionResult(e.target.value)}
                      className="w-full h-40 bg-black/40 border border-white/10 rounded-xl p-3.5 text-sm text-white/90 placeholder-white/20 focus:outline-none focus:border-neon-pink scrollbar-hide resize-none leading-relaxed"
                    />
                  </div>
                ) : (
                  /* Idle/Ready state */
                  <div className="flex flex-col items-center justify-center py-6 space-y-4">
                    <div className="w-16 h-16 rounded-full bg-neon-pink/10 border border-neon-pink/20 flex items-center justify-center text-neon-pink">
                      <Mic size={28} />
                    </div>
                    <p className="text-xs text-baby-blue/40">Ready to record. Click below to begin speaking.</p>
                  </div>
                )}
              </div>

              {/* Modal Actions */}
              <div className="flex items-center gap-3">
                {isGeminiRecording ? (
                  <button
                    onClick={stopGeminiRecording}
                    className="w-full py-3 bg-gradient-to-r from-red-600 to-pink-600 hover:from-red-500 hover:to-pink-500 text-white rounded-xl font-bold text-sm tracking-widest uppercase transition-all shadow-lg shadow-red-500/10 flex items-center justify-center gap-2"
                  >
                    <Square size={16} fill="currentColor" />
                    <span>Stop & Polish</span>
                  </button>
                ) : isTranscribing ? (
                  <button
                    disabled
                    className="w-full py-3 bg-white/5 text-white/30 rounded-xl font-bold text-sm tracking-widest uppercase cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    <Loader2 size={16} className="animate-spin" />
                    <span>Processing...</span>
                  </button>
                ) : transcriptionResult ? (
                  <>
                    <button
                      onClick={() => {
                        setTranscriptionResult('');
                        startGeminiRecording();
                      }}
                      className="w-1/3 py-3 bg-white/5 border border-white/10 hover:bg-white/10 text-white rounded-xl font-bold text-xs tracking-widest uppercase transition-all flex items-center justify-center gap-1.5"
                    >
                      <RotateCcw size={14} />
                      <span>Redo</span>
                    </button>
                    <button
                      onClick={() => {
                        if (editor && transcriptionResult) {
                          editor.chain().focus().insertContent(transcriptionResult + ' ').run();
                        }
                        setShowVoiceModal(false);
                        setTranscriptionResult('');
                      }}
                      className="w-2/3 py-3 bg-gradient-to-r from-neon-pink to-neon-purple text-white rounded-xl font-bold text-sm tracking-widest uppercase transition-all shadow-lg shadow-neon-pink/10 flex items-center justify-center gap-1.5"
                    >
                      <Check size={16} />
                      <span>Insert Text</span>
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => setShowVoiceModal(false)}
                      className="w-1/3 py-3 bg-white/5 hover:bg-white/10 text-white rounded-xl font-bold text-xs tracking-widest uppercase transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={startGeminiRecording}
                      className="w-2/3 py-3 bg-gradient-to-r from-neon-pink to-neon-purple text-white rounded-xl font-bold text-sm tracking-widest uppercase transition-all shadow-lg shadow-neon-pink/10 flex items-center justify-center gap-1.5"
                    >
                      <Mic size={16} />
                      <span>Start Recording</span>
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
