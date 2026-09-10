import { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './components/FirebaseProvider';
import { signInWithGoogle, logout, db, handleFirestoreError, OperationType } from './lib/firebase';
import { collection, query, where, onSnapshot, doc, setDoc, deleteDoc, updateDoc, addDoc } from 'firebase/firestore';
import { JournalEntry, Habit, Task, MOOD_OPTIONS, AIAnalysis, HABIT_CONFIG, MOOD_EMOJIS, getMoodEmoji } from './types';
import Calendar from './components/Calendar';
import Editor from './components/Editor';
import HabitTracker from './components/HabitTracker';
import TaskList from './components/TaskList';
import Analytics from './components/Analytics';
import SearchEntries from './components/SearchEntries';
import { format, isSameDay, parseISO } from 'date-fns';
import { Book, CheckSquare, BarChart2, Settings as SettingsIcon, LogOut, Calendar as CalendarIcon, Sparkles, ChevronRight, Hash, Search as SearchIcon, Plus, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { saveAs } from 'file-saver';
import { jsPDF } from 'jspdf';
import { Document, Packer, Paragraph, TextRun } from 'docx';

function AppContent() {
  const { user, profile } = useAuth();
  const [view, setView] = useState<'calendar' | 'day'>('calendar');
  const [activeTab, setActiveTab] = useState<'entry' | 'habits' | 'analytics' | 'settings' | 'search'>('entry');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  
  // Custom Dialog States
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
  } | null>(null);

  const [alertDialog, setAlertDialog] = useState<{
    title: string;
    message: string;
    onClose: () => void;
  } | null>(null);

  const customConfirm = (title: string, message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmDialog({
        title,
        message,
        onConfirm: () => {
          setConfirmDialog(null);
          resolve(true);
        },
        onCancel: () => {
          setConfirmDialog(null);
          resolve(false);
        }
      });
    });
  };

  const customAlert = (title: string, message: string): Promise<void> => {
    return new Promise((resolve) => {
      setAlertDialog({
        title,
        message,
        onClose: () => {
          setAlertDialog(null);
          resolve();
        }
      });
    });
  };

  // Data State
  const [entries, setEntries] = useState<{ [key: string]: JournalEntry }>({});
  const [habits, setHabits] = useState<Habit[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>('gemini-3.5-flash');
  const [selectedStyle, setSelectedStyle] = useState<string>('detailed');

  const dateStr = format(selectedDate, 'yyyy-MM-dd');

  // Real-time listeners
  useEffect(() => {
    if (!user) return;

    const qEntries = query(collection(db, 'entries'), where('userId', '==', user.uid));
    const unsubscribeEntries = onSnapshot(qEntries, (snapshot) => {
      const data: { [key: string]: JournalEntry } = {};
      snapshot.forEach(doc => {
        const entry = doc.data() as JournalEntry;
        data[entry.date] = { ...entry, id: doc.id };
      });
      setEntries(data);
    }, (error) => console.error("Entries snapshot error:", error));

    const qHabits = query(collection(db, 'habits'), where('userId', '==', user.uid));
    const unsubscribeHabits = onSnapshot(qHabits, (snapshot) => {
      const data: Habit[] = [];
      snapshot.forEach(doc => {
        data.push({ ...doc.data() as Habit, id: doc.id });
      });
      setHabits(data);
    }, (error) => console.error("Habits snapshot error:", error));

    const qTasks = query(collection(db, 'tasks'), where('userId', '==', user.uid));
    const unsubscribeTasks = onSnapshot(qTasks, (snapshot) => {
      const data: Task[] = [];
      snapshot.forEach(doc => {
        data.push({ ...doc.data() as Task, id: doc.id });
      });
      setTasks(data);
    }, (error) => console.error("Tasks snapshot error:", error));

    return () => {
      unsubscribeEntries();
      unsubscribeHabits();
      unsubscribeTasks();
    };
  }, [user]);

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4" style={{ backgroundColor: 'var(--bg-primary)' }}>
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="text-center space-y-8"
        >
          <div className="relative">
             <h1 className="text-8xl font-poiret text-neon-cyan neon-glow-blue uppercase tracking-[0.3em]">Lumina</h1>
             <p className="text-neon-pink font-bold absolute -bottom-4 right-0 rotate-[-5deg] text-xs px-2 py-1 glass rounded border-neon-pink/30">AI JOURNAL</p>
          </div>
          <p className="text-baby-blue/40 max-w-sm mx-auto font-light leading-relaxed">
            A state-of-the-art AI-powered cognitive behavioral journal and daily planner. 
            Login to begin your transformation.
          </p>
          <button 
            onClick={signInWithGoogle}
            className="px-8 py-4 bg-white/5 border border-white/20 rounded-full text-white hover:bg-white/10 hover:border-neon-blue transition-all flex items-center gap-3 mx-auto shadow-lg hover:shadow-neon-blue/20"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/split/google.svg" alt="Google" className="w-5 h-5" />
            Continue with Google
          </button>
        </motion.div>
      </div>
    );
  }

  const currentEntry = entries[dateStr] || {
    userId: user.uid,
    date: dateStr,
    title: '',
    content: '',
    mood: '',
    tags: [],
    images: [],
    audio: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const currentHabits = habits.filter(h => h.date === dateStr).reduce((acc, h) => {
    acc[h.habitKey] = h;
    return acc;
  }, {} as { [key: string]: Habit });

  const currentTasks = tasks.filter(t => t.date === dateStr);

  const saveEntryFields = async (fieldsToUpdate: Partial<JournalEntry>) => {
    const existingEntry = entries[dateStr];
    const entryId = existingEntry?.id || `${user.uid}_${dateStr}`;
    const entryRef = doc(db, 'entries', entryId);
    
    const dataToSave: any = {
      ...fieldsToUpdate,
      updatedAt: new Date().toISOString()
    };
    
    if (!existingEntry) {
       dataToSave.userId = user.uid;
       dataToSave.date = dateStr;
       dataToSave.content = dataToSave.content || '';
       dataToSave.createdAt = new Date().toISOString();
    }
    
    try {
      await setDoc(entryRef, dataToSave, { merge: true });
    } catch (e: any) {
      console.error("Firestore Save Error for entries:", e);
      customAlert("Save Error", `Failed to save: ${e.message || e}`);
    }
  };

  const handleEntryUpdate = async (content: string) => {
    await saveEntryFields({ content });
  };

  const handleManualSave = async (content: string) => {
    await saveEntryFields({ content });
  };

  const handleMoodUpdate = async (mood: string) => {
    await saveEntryFields({ mood });
  };

  const handleHabitUpdate = async (habitKey: string, newValue: number) => {
    try {
      const existing = habits.find(h => h.date === dateStr && h.habitKey === habitKey);
      if (existing) {
        await updateDoc(doc(db, 'habits', existing.id!), { value: newValue });
      } else {
        await addDoc(collection(db, 'habits'), {
          userId: user.uid,
          date: dateStr,
          habitKey,
          value: newValue
        });
      }
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, 'habits');
    }
  };

  const handleAddTask = async (task: Partial<Task>) => {
    try {
      await addDoc(collection(db, 'tasks'), {
        ...task,
        userId: user.uid,
        date: dateStr,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, 'tasks');
    }
  };

  const handleUpdateTask = async (taskId: string, updates: Partial<Task>) => {
    try {
      await updateDoc(doc(db, 'tasks', taskId), { ...updates, updatedAt: new Date().toISOString() });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, 'tasks');
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    try {
      await deleteDoc(doc(db, 'tasks', taskId));
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, 'tasks');
    }
  };

  const handleDeleteEntry = async (): Promise<boolean> => {
    const existingEntry = entries[dateStr];
    if (!existingEntry || !existingEntry.id) {
      await customAlert("Delete Entry", "No journal entry exists for this day.");
      return false;
    }
    
    const confirmDelete = await customConfirm("Delete Entry", "Are you sure you want to permanently delete this journal entry?");
    if (!confirmDelete) return false;

    try {
      await deleteDoc(doc(db, 'entries', existingEntry.id));
      return true;
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, 'entries');
      return false;
    }
  };

  const handleAnalyze = async () => {
    if (analyzing) return;

    if (!currentEntry.content || currentEntry.content.length < 20) {
      await customAlert("Analysis Preview", "Please write a bit more before analysis.");
      return;
    }

    if (currentEntry.analysis) {
      const confirmRun = await customConfirm(
        "Re-run Analysis",
        `An AI Analysis already exists for this entry.\n\nRe-running the analysis will consume your API quota. Are you sure you want to run a new analysis with ${selectedModel} (${selectedStyle} mode)?`
      );
      if (!confirmRun) return;
    }

    setAnalyzing(true);
    setAnalysisError(null);
    setShowErrorModal(false);

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          content: currentEntry.content.replace(/<[^>]*>/g, ''), 
          mood: currentEntry.mood,
          model: selectedModel,
          style: selectedStyle
        })
      });
      const analysis = await res.json();
      if (!res.ok) {
        throw new Error(analysis.error || 'Failed to analyze');
      }
      
      try {
        const updatedEntry = { ...currentEntry, analysis, updatedAt: new Date().toISOString() };
        if (updatedEntry.id) {
          await updateDoc(doc(db, 'entries', updatedEntry.id), { analysis, updatedAt: updatedEntry.updatedAt });
        } else {
          const { id, ...dataToSave } = updatedEntry;
          await addDoc(collection(db, 'entries'), dataToSave);
        }
      } catch(err) {
        handleFirestoreError(err, OperationType.WRITE, 'entries');
      }

    } catch (e) {
      console.error(e);
      const detailedMessage = e instanceof Error ? e.message : 'Unknown error';
      setAnalysisError(detailedMessage);
      setShowErrorModal(true);
    } finally {
      setAnalyzing(false);
    }
  };

  const exportEntry = (exportFormat: 'txt' | 'pdf' | 'docx' | 'html') => {
    const textContent = currentEntry.content
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/<[^>]*>/g, '');
    const formattedDate = format(parseISO(dateStr), 'MMMM d, yyyy');

    const isDusk = profile?.theme === 'dusk';
    const isLight = profile?.theme === 'light';

    const pdfTheme = {
      bg: isLight ? [240, 247, 255] : isDusk ? [13, 0, 5] : [3, 7, 18],
      text: isLight ? [0, 38, 88] : isDusk ? [255, 179, 198] : [220, 225, 235],
      cyan: isLight ? [0, 162, 255] : isDusk ? [255, 0, 127] : [0, 255, 255],
      pink: isLight ? [0, 75, 191] : isDusk ? [255, 107, 157] : [255, 0, 255],
      purple: isLight ? [92, 0, 163] : isDusk ? [191, 0, 255] : [191, 0, 255],
      babyBlue: isLight ? [0, 38, 88] : isDusk ? [255, 228, 230] : [137, 207, 240]
    };

    if (exportFormat === 'txt') {
      const parts: string[] = [];
      parts.push(`================================================================================`);
      parts.push(`                               ${formattedDate.toUpperCase()}`);
      parts.push(`================================================================================\n`);
      
      if (currentEntry.mood) {
        parts.push(`Mood: ${getMoodEmoji(currentEntry.mood)} ${currentEntry.mood}\n`);
      }
      
      if (currentEntry.title) {
        parts.push(`Title: ${currentEntry.title}\n`);
      }
      
      parts.push(`--------------------------------------------------------------------------------`);
      parts.push(`JOURNAL ENTRY`);
      parts.push(`--------------------------------------------------------------------------------`);
      parts.push(textContent);
      parts.push("");
      
      if (currentEntry.analysis) {
        const ana = currentEntry.analysis;
        parts.push(`--------------------------------------------------------------------------------`);
        parts.push(`PSYCHOLOGICAL READOUT`);
        parts.push(`--------------------------------------------------------------------------------`);
        
        if (ana.moodSummary) {
          parts.push(`Atmosphere Summary:\n"${ana.moodSummary}"\n`);
        }
        
        if (ana.tags && ana.tags.length > 0) {
          parts.push(`Suggested Tags: ${ana.tags.map(t => `#${t}`).join(', ')}\n`);
        }
        
        const themes = ana.keyThemes && ana.keyThemes.length > 0 ? ana.keyThemes : (ana.insights || []);
        if (themes.length > 0) {
          parts.push(`Themes & Patterns:\n${themes.map(t => `• ${t}`).join('\n')}\n`);
        }
        
        if (ana.cognitiveDistortions && ana.cognitiveDistortions.length > 0) {
          parts.push(`Cognitive Distortions Identified:\n${ana.cognitiveDistortions.map(d => `⚠️ ${d}`).join('\n')}\n`);
        }
        
        if (ana.underlyingDynamics && ana.underlyingDynamics.length > 0) {
          parts.push(`Underlying Dynamics:\n${ana.underlyingDynamics.map(d => `💡 ${d}`).join('\n')}\n`);
        }
        
        if (ana.cbtReframes && ana.cbtReframes.length > 0) {
          parts.push(`CBT Reframes:\n${ana.cbtReframes.map(r => `🔄 ${r}`).join('\n')}\n`);
        }
        
        if (ana.reflectionQuestions && ana.reflectionQuestions.length > 0) {
          parts.push(`Reflection Questions:\n${ana.reflectionQuestions.map(q => `❓ ${q}`).join('\n')}\n`);
        }
        
        if (ana.watchPattern) {
          parts.push(`Future Monitoring:\n"${ana.watchPattern}"\n`);
        }
      }
      
      parts.push(`================================================================================`);
      const blob = new Blob([parts.join('\n')], { type: 'text/plain;charset=utf-8' });
      saveAs(blob, `${dateStr}_entry.txt`);
      
    } else if (exportFormat === 'pdf') {
      const doc = new jsPDF('p', 'mm', 'a4');
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      let currentY = 15;

      const addPageIfNeeded = (neededHeight: number) => {
        if (currentY + neededHeight > pageH - 15) {
          doc.addPage();
          doc.setFillColor(pdfTheme.bg[0], pdfTheme.bg[1], pdfTheme.bg[2]);
          doc.rect(0, 0, pageW, pageH, 'F');
          currentY = 15;
        }
      };

      // Fill background
      doc.setFillColor(pdfTheme.bg[0], pdfTheme.bg[1], pdfTheme.bg[2]);
      doc.rect(0, 0, pageW, pageH, 'F');

      // Date Header (Poiret One aesthetic)
      doc.setTextColor(pdfTheme.cyan[0], pdfTheme.cyan[1], pdfTheme.cyan[2]); // Dynamic cyan/pink accent
      doc.setFont("helvetica", "bold");
      doc.setFontSize(22);
      doc.text(formattedDate.toUpperCase(), pageW / 2, currentY + 10, { align: "center" });
      currentY += 18;

      // Mood badge
      if (currentEntry.mood) {
        const emoji = getMoodEmoji(currentEntry.mood);
        const moodStr = `MOOD: ${emoji} ${currentEntry.mood.toUpperCase()}`;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        const badgeW = doc.getTextWidth(moodStr) + 10;
        const badgeH = 7;
        const badgeX = (pageW - badgeW) / 2;
        
        // Neon pink border
        doc.setDrawColor(pdfTheme.pink[0], pdfTheme.pink[1], pdfTheme.pink[2]);
        doc.setFillColor(pdfTheme.pink[0], pdfTheme.pink[1], pdfTheme.pink[2], 0.05);
        doc.roundedRect(badgeX, currentY, badgeW, badgeH, 3.5, 3.5, 'FD');
        
        doc.setTextColor(pdfTheme.pink[0], pdfTheme.pink[1], pdfTheme.pink[2]);
        doc.text(moodStr, pageW / 2, currentY + 4.8, { align: "center" });
        currentY += 12;
      }

      // Title as Header 1 (H1)
      if (currentEntry.title) {
        addPageIfNeeded(15);
        if (isLight) {
          doc.setTextColor(0, 0, 0); // Black for Light theme
        } else if (isDusk) {
          doc.setTextColor(201, 169, 233); // #C9A9E9 Dusty Pink/Glow for Dusk theme
        } else {
          doc.setTextColor(56, 189, 248); // #38BDF8 Aurora blue-cyan start for AMOLED theme
        }
        doc.setFont("helvetica", "bold");
        doc.setFontSize(18); // Header 1 size
        doc.text(currentEntry.title, 15, currentY);
        currentY += 10;
      }

      // Journal Content (wrapped lines with sleek left border)
      const contentLines = doc.splitTextToSize(textContent, pageW - 36);
      const contentBoxH = contentLines.length * 5.5 + 8;

      addPageIfNeeded(contentBoxH);
      
      // Draw left border in Neon Cyan
      doc.setDrawColor(pdfTheme.cyan[0], pdfTheme.cyan[1], pdfTheme.cyan[2]);
      doc.setLineWidth(1);
      doc.line(15, currentY, 15, currentY + contentBoxH);

      doc.setTextColor(pdfTheme.text[0], pdfTheme.text[1], pdfTheme.text[2]);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      contentLines.forEach((line: string, idx: number) => {
        addPageIfNeeded(5.5);
        doc.text(line, 19, currentY + 4 + idx * 5.5);
      });
      currentY += contentBoxH + 12;

      // AI Analysis
      if (currentEntry.analysis) {
        const ana = currentEntry.analysis;
        addPageIfNeeded(25);

        // Neon divider line
        doc.setDrawColor(pdfTheme.pink[0], pdfTheme.pink[1], pdfTheme.pink[2]);
        doc.setLineWidth(0.5);
        doc.line(15, currentY, pageW - 15, currentY);
        currentY += 8;

        // Psychological Readout Header
        doc.setTextColor(pdfTheme.pink[0], pdfTheme.pink[1], pdfTheme.pink[2]); // Neon pink
        doc.setFont("helvetica", "bold");
        doc.setFontSize(13);
        doc.text("✦ PSYCHOLOGICAL READOUT", 15, currentY);
        currentY += 8;

        // Draw left pink border for the analysis section
        const analysisStartY = currentY;

        if (ana.moodSummary) {
          addPageIfNeeded(18);
          doc.setTextColor(pdfTheme.babyBlue[0], pdfTheme.babyBlue[1], pdfTheme.babyBlue[2]); // baby-blue
          doc.setFont("helvetica", "bold");
          doc.setFontSize(8);
          doc.text("ATMOSPHERE SUMMARY", 18, currentY);
          currentY += 4.5;

          doc.setTextColor(pdfTheme.text[0], pdfTheme.text[1], pdfTheme.text[2]);
          doc.setFont("helvetica", "italic");
          doc.setFontSize(9.5);
          const summaryLines = doc.splitTextToSize(`"${ana.moodSummary}"`, pageW - 36);
          summaryLines.forEach((line: string) => {
            addPageIfNeeded(5);
            doc.text(line, 18, currentY);
            currentY += 5;
          });
          currentY += 4;
        }

        const themes = ana.keyThemes && ana.keyThemes.length > 0 ? ana.keyThemes : (ana.insights || []);
        if (themes.length > 0) {
          addPageIfNeeded(18);
          doc.setTextColor(pdfTheme.babyBlue[0], pdfTheme.babyBlue[1], pdfTheme.babyBlue[2]);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(8);
          doc.text("THEMES & PATTERNS", 18, currentY);
          currentY += 4.5;

          doc.setTextColor(pdfTheme.text[0], pdfTheme.text[1], pdfTheme.text[2]);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(9.5);
          themes.forEach((theme: string) => {
            const themeLines = doc.splitTextToSize(`• ${theme}`, pageW - 36);
            themeLines.forEach((line: string) => {
              addPageIfNeeded(5);
              doc.text(line, 18, currentY);
              currentY += 5;
            });
          });
          currentY += 4;
        }

        if (ana.cognitiveDistortions && ana.cognitiveDistortions.length > 0) {
          addPageIfNeeded(18);
          doc.setTextColor(239, 68, 68); // Red (keep alert red)
          doc.setFont("helvetica", "bold");
          doc.setFontSize(8);
          doc.text("COGNITIVE DISTORTIONS IDENTIFIED", 18, currentY);
          currentY += 4.5;

          doc.setTextColor(252, 165, 165); // keep soft red
          doc.setFont("helvetica", "bold");
          doc.setFontSize(9.5);
          ana.cognitiveDistortions.forEach((d: string) => {
            addPageIfNeeded(5);
            doc.text(`⚠️ ${d}`, 18, currentY);
            currentY += 5;
          });
          currentY += 4;
        }

        if (ana.underlyingDynamics && ana.underlyingDynamics.length > 0) {
          addPageIfNeeded(18);
          doc.setTextColor(pdfTheme.purple[0], pdfTheme.purple[1], pdfTheme.purple[2]); // Purple
          doc.setFont("helvetica", "bold");
          doc.setFontSize(8);
          doc.text("UNDERLYING DYNAMICS", 18, currentY);
          currentY += 4.5;

          doc.setTextColor(pdfTheme.text[0], pdfTheme.text[1], pdfTheme.text[2]);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(9.5);
          ana.underlyingDynamics.forEach((dyn: string) => {
            const dynLines = doc.splitTextToSize(`💡 ${dyn}`, pageW - 36);
            dynLines.forEach((line: string) => {
              addPageIfNeeded(5);
              doc.text(line, 18, currentY);
              currentY += 5;
            });
          });
          currentY += 4;
        }

        if (ana.cbtReframes && ana.cbtReframes.length > 0) {
          addPageIfNeeded(18);
          doc.setTextColor(pdfTheme.cyan[0], pdfTheme.cyan[1], pdfTheme.cyan[2]); // Cyan
          doc.setFont("helvetica", "bold");
          doc.setFontSize(8);
          doc.text("CBT REFRAMES & ALTERNATIVE PERSPECTIVES", 18, currentY);
          currentY += 4.5;

          doc.setTextColor(pdfTheme.text[0], pdfTheme.text[1], pdfTheme.text[2]);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(9.5);
          ana.cbtReframes.forEach((ref: string) => {
            const refLines = doc.splitTextToSize(`🔄 ${ref}`, pageW - 36);
            refLines.forEach((line: string) => {
              addPageIfNeeded(5);
              doc.text(line, 18, currentY);
              currentY += 5;
            });
          });
          currentY += 4;
        }

        if (ana.reflectionQuestions && ana.reflectionQuestions.length > 0) {
          addPageIfNeeded(18);
          doc.setTextColor(pdfTheme.purple[0], pdfTheme.purple[1], pdfTheme.purple[2]);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(8);
          doc.text("CLINICIAN OBSERVATIONS & REFLECTION QUESTIONS", 18, currentY);
          currentY += 4.5;

          doc.setTextColor(pdfTheme.text[0], pdfTheme.text[1], pdfTheme.text[2]);
          doc.setFont("helvetica", "italic");
          doc.setFontSize(9.5);
          ana.reflectionQuestions.forEach((q: string) => {
            const qLines = doc.splitTextToSize(`❓ ${q}`, pageW - 36);
            qLines.forEach((line: string) => {
              addPageIfNeeded(5);
              doc.text(line, 18, currentY);
              currentY += 5;
            });
          });
          currentY += 4;
        }

        if (ana.watchPattern) {
          addPageIfNeeded(18);
          doc.setTextColor(pdfTheme.pink[0], pdfTheme.pink[1], pdfTheme.pink[2]); // Pink
          doc.setFont("helvetica", "bold");
          doc.setFontSize(8);
          doc.text("FUTURE MONITORING: WATCH FOR THIS PATTERN", 18, currentY);
          currentY += 4.5;

          doc.setTextColor(pdfTheme.text[0], pdfTheme.text[1], pdfTheme.text[2]);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(9.5);
          const watchLines = doc.splitTextToSize(`"${ana.watchPattern}"`, pageW - 36);
          watchLines.forEach((line: string) => {
            addPageIfNeeded(5);
            doc.text(line, 18, currentY);
            currentY += 5;
          });
        }

        // Draw left pink border for the whole analysis block
        doc.setDrawColor(pdfTheme.pink[0], pdfTheme.pink[1], pdfTheme.pink[2]);
        doc.setLineWidth(1);
        doc.line(15, analysisStartY, 15, currentY);
      }

      doc.save(`${dateStr}_entry.pdf`);

    } else if (exportFormat === 'docx') {
      const docChildren: any[] = [];
      
      // Header Date (Poiret One)
      docChildren.push(
        new Paragraph({
          alignment: "center",
          children: [
            new TextRun({
              text: formattedDate.toUpperCase(),
              bold: true,
              size: 36,
              font: "Poiret One",
              color: "00ffff", // Neon cyan
            }),
          ],
        })
      );
      
      if (currentEntry.mood) {
        const emoji = getMoodEmoji(currentEntry.mood);
        docChildren.push(
          new Paragraph({
            alignment: "center",
            children: [
              new TextRun({
                text: `MOOD: ${emoji} ${currentEntry.mood.toUpperCase()}`,
                bold: true,
                size: 24,
                font: "Century Gothic",
                color: "ff00ff", // Neon pink
              }),
            ],
          })
        );
      }
      
      docChildren.push(new Paragraph({ children: [] })); // line break
      
      if (currentEntry.title) {
        docChildren.push(
          new Paragraph({
            children: [
              new TextRun({
                text: currentEntry.title,
                bold: true,
                size: 28,
                font: "Century Gothic",
                color: "ffffff",
              }),
            ],
          })
        );
      }
      
      // Journal body
      docChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: textContent,
              size: 22,
              font: "Inter",
            }),
          ],
        })
      );
      
      if (currentEntry.analysis) {
        const ana = currentEntry.analysis;
        docChildren.push(new Paragraph({ children: [] }));
        
        docChildren.push(
          new Paragraph({
            children: [
              new TextRun({
                text: "PSYCHOLOGICAL READOUT",
                bold: true,
                size: 28,
                font: "Century Gothic",
                color: "ff00ff", // Neon pink
              }),
            ],
          })
        );
        
        if (ana.moodSummary) {
          docChildren.push(
            new Paragraph({
              children: [
                new TextRun({ text: "ATMOSPHERE SUMMARY:\n", bold: true, size: 20, color: "00ffff" }),
                new TextRun({ text: `"${ana.moodSummary}"\n`, italics: true, size: 20, color: "f3f4f6" }),
              ],
            })
          );
        }
        
        const themes = ana.keyThemes && ana.keyThemes.length > 0 ? ana.keyThemes : (ana.insights || []);
        if (themes.length > 0) {
          docChildren.push(
            new Paragraph({
              children: [
                new TextRun({ text: "THEMES & PATTERNS:\n", bold: true, size: 20, color: "00ffff" }),
                ...themes.flatMap((t: string) => [
                  new TextRun({ text: `• ${t}\n`, size: 20, color: "f3f4f6" })
                ])
              ],
            })
          );
        }
        
        if (ana.cognitiveDistortions && ana.cognitiveDistortions.length > 0) {
          docChildren.push(
            new Paragraph({
              children: [
                new TextRun({ text: "COGNITIVE DISTORTIONS IDENTIFIED:\n", bold: true, size: 20, color: "ff0055" }),
                ...ana.cognitiveDistortions.flatMap((d: string) => [
                  new TextRun({ text: `⚠️ ${d}\n`, size: 20, color: "fca5a5" })
                ])
              ],
            })
          );
        }
        
        if (ana.underlyingDynamics && ana.underlyingDynamics.length > 0) {
          docChildren.push(
            new Paragraph({
              children: [
                new TextRun({ text: "UNDERLYING DYNAMICS:\n", bold: true, size: 20, color: "bf00ff" }),
                ...ana.underlyingDynamics.flatMap((d: string) => [
                  new TextRun({ text: `💡 ${d}\n`, size: 20, color: "f3f4f6" })
                ])
              ],
            })
          );
        }
        
        if (ana.cbtReframes && ana.cbtReframes.length > 0) {
          docChildren.push(
            new Paragraph({
              children: [
                new TextRun({ text: "CBT REFRAMES & ALTERNATIVE PERSPECTIVES:\n", bold: true, size: 20, color: "00ffff" }),
                ...ana.cbtReframes.flatMap((r: string) => [
                  new TextRun({ text: `🔄 ${r}\n`, size: 20, color: "f3f4f6" })
                ])
              ],
            })
          );
        }
        
        if (ana.reflectionQuestions && ana.reflectionQuestions.length > 0) {
          docChildren.push(
            new Paragraph({
              children: [
                new TextRun({ text: "CLINICIAN OBSERVATIONS & REFLECTION QUESTIONS:\n", bold: true, size: 20, color: "bf00ff" }),
                ...ana.reflectionQuestions.flatMap((q: string) => [
                  new TextRun({ text: `❓ ${q}\n`, size: 20, italics: true, color: "f3f4f6" })
                ])
              ],
            })
          );
        }
        
        if (ana.watchPattern) {
          docChildren.push(
            new Paragraph({
              children: [
                new TextRun({ text: "FUTURE MONITORING (WATCH FOR PATTERN):\n", bold: true, size: 20, color: "ff00ff" }),
                new TextRun({ text: `"${ana.watchPattern}"\n`, italics: true, size: 20, color: "f3f4f6" }),
              ],
            })
          );
        }
      }

      const docObj = new Document({
        sections: [{
          properties: {},
          children: docChildren,
        }],
      });
      Packer.toBlob(docObj).then(blob => saveAs(blob, `${dateStr}_entry.docx`));

    } else if (exportFormat === 'html') {
      const moodSection = currentEntry.mood ? `
      <div class="badge-container">
        <div class="badge">Mood: ${getMoodEmoji(currentEntry.mood)} ${currentEntry.mood}</div>
      </div>
      ` : '';

      const titleSection = currentEntry.title ? `<h1 class="journal-title">${currentEntry.title}</h1>` : '';

      let analysisSection = '';
      if (currentEntry.analysis) {
        const ana = currentEntry.analysis;
        const themes = ana.keyThemes && ana.keyThemes.length > 0 ? ana.keyThemes : (ana.insights || []);

        analysisSection = `
        <div class="divider"></div>
        <div class="analysis-card">
          <div class="analysis-header">
            <span>✦ Psychological Readout</span>
          </div>
          
          <div class="grid">
            <div>
              ${ana.moodSummary ? `
              <div class="section-title">Atmosphere Summary</div>
              <div class="summary-text">"${ana.moodSummary}"</div>
              ` : ''}
              
              ${ana.tags && ana.tags.length > 0 ? `
              <div class="section-title">Suggested Tags</div>
              <div style="margin-top: 0.5rem;">
                ${ana.tags.map((t: string) => `<span class="tag font-bold">#${t}</span>`).join('')}
              </div>
              ` : ''}
            </div>
            
            <div>
              ${themes.length > 0 ? `
              <div class="section-title">Themes & Patterns</div>
              <div style="margin-top: 0.5rem;">
                ${themes.map((theme: string) => `
                  <div class="list-item">${theme}</div>
                `).join('')}
              </div>
              ` : ''}
            </div>
          </div>
          
          ${ana.cognitiveDistortions && ana.cognitiveDistortions.length > 0 ? `
          <div class="section-title">Cognitive Distortions Identified</div>
          <div style="margin-top: 0.5rem; margin-bottom: 1.5rem;">
            ${ana.cognitiveDistortions.map((d: string) => `<span class="distortion-badge">⚠️ ${d}</span>`).join('')}
          </div>
          ` : ''}
          
          ${ana.underlyingDynamics && ana.underlyingDynamics.length > 0 ? `
          <div class="section-title">Underlying Dynamics & CBT Hypotheses</div>
          <div class="grid" style="margin-top: 0.5rem; margin-bottom: 1.5rem;">
            ${ana.underlyingDynamics.map((dyn: string) => `
              <div class="reframe-card" style="border-left-color: var(--neon-purple);">💡 ${dyn}</div>
            `).join('')}
          </div>
          ` : ''}
          
          ${ana.cbtReframes && ana.cbtReframes.length > 0 ? `
          <div class="section-title">CBT Reframes & Alternative Perspectives</div>
          <div class="grid" style="margin-top: 0.5rem; margin-bottom: 1.5rem;">
            ${ana.cbtReframes.map((ref: string) => `
              <div class="reframe-card">🔄 ${ref}</div>
            `).join('')}
          </div>
          ` : ''}
          
          ${ana.reflectionQuestions && ana.reflectionQuestions.length > 0 ? `
          <div class="section-title">Clinician Observations & Reflection Questions</div>
          <div class="grid" style="margin-top: 0.5rem; margin-bottom: 1.5rem;">
            ${ana.reflectionQuestions.map((q: string) => `
              <div class="question-card">❓ ${q}</div>
            `).join('')}
          </div>
          ` : ''}
          
          ${ana.watchPattern ? `
          <div class="section-title">Future Monitoring: Watch for This Pattern</div>
          <div class="reframe-card" style="border-left-color: var(--neon-pink); margin-top: 0.5rem;">
            <span class="watch-text">${ana.watchPattern}</span>
          </div>
          ` : ''}
        </div>
        `;
      }

      let extractedFont = '';
      const fontMatch = currentEntry.content.match(/font-family:\s*['"]?([^'";\s]+)['"]?/);
      if (fontMatch && fontMatch[1]) {
        extractedFont = fontMatch[1].trim();
      }

      const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Lumina Neural Journal - ${formattedDate}</title>
  <link href="https://fonts.googleapis.com/css2?family=Poiret+One&family=Inter:wght@200;400;600;800&family=JetBrains+Mono:wght@200;400;600&family=Arima&family=Bellota&family=Comic+Neue&family=Playpen+Sans&family=Montserrat:ital,wght@0,300;0,400;1,300&family=Bubbler+One&family=Petit+Formal+Script&family=Handlee&family=Bad+Script&family=Sofia&family=Gabriela&family=Cinzel+Decorative&family=Cormorant+Infant&family=Josefin+Slab&display=swap" rel="stylesheet">
  <style>
    :root {
      ${isLight ? `
        --bg-primary: #f0f7ff;
        --bg-image: radial-gradient(circle at 30% 20%, #e6f0fa 0%, #f0f7ff 100%);
        --bg-card: rgba(255, 255, 255, 0.8);
        --bg-analysis: rgba(255, 255, 255, 0.9);
        --border: rgba(0, 38, 88, 0.1);
        --text-primary: #002658;
        --neon-pink: #004bbf;
        --neon-cyan: #00a2ff;
        --neon-blue: #002658;
        --neon-purple: #5c00a3;
        --baby-blue: #002658;
      ` : isDusk ? `
        --bg-primary: #0d0005;
        --bg-image: radial-gradient(circle at 30% 20%, #200213 0%, #060003 100%);
        --bg-card: rgba(26, 1, 12, 0.6);
        --bg-analysis: rgba(26, 1, 12, 0.8);
        --border: rgba(255, 107, 157, 0.2);
        --text-primary: #ffb3c6;
        --neon-pink: #ff6b9d;
        --neon-cyan: #ff007f;
        --neon-blue: #ff6b9d;
        --neon-purple: #bf00ff;
        --baby-blue: #ffe4e6;
      ` : `
        --bg-primary: #030712;
        --bg-image: radial-gradient(circle at center, #111827 0%, #030712 100%);
        --bg-card: rgba(9, 13, 22, 0.6);
        --bg-analysis: rgba(9, 13, 22, 0.8);
        --border: rgba(255, 255, 255, 0.08);
        --text-primary: #f3f4f6;
        --neon-pink: #ff00ff;
        --neon-cyan: #00ffff;
        --neon-blue: #0066ff;
        --neon-purple: #bf00ff;
        --baby-blue: #89cff0;
      `}
    }
    body {
      background-color: var(--bg-primary);
      background-image: var(--bg-image);
      color: var(--text-primary);
      font-family: 'Inter', sans-serif;
      margin: 0;
      padding: 3rem 1rem;
      min-height: 100vh;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
    }
    .header {
      font-family: 'Poiret One', cursive, sans-serif;
      font-size: 3rem;
      text-align: center;
      color: var(--neon-cyan);
      text-transform: uppercase;
      letter-spacing: 0.3em;
      text-shadow: 0 0 20px rgba(0, 255, 255, 0.4);
      margin-bottom: 1.5rem;
    }
    .badge-container {
      display: flex;
      justify-content: center;
      gap: 1rem;
      margin-bottom: 3rem;
    }
    .badge {
      background: rgba(255, 0, 255, 0.05);
      border: 1px solid rgba(255, 0, 255, 0.2);
      color: var(--neon-pink);
      padding: 0.5rem 1.5rem;
      border-radius: 9999px;
      font-weight: 600;
      font-size: 0.8rem;
      letter-spacing: 0.15em;
      text-transform: uppercase;
      box-shadow: 0 0 15px rgba(255, 0, 255, 0.1);
    }
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 1.5rem;
      padding: 3rem;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(12px);
      margin-bottom: 3rem;
    }
    .journal-title {
      font-family: 'Poiret One', sans-serif;
      font-size: 2.2rem;
      font-weight: bold;
      text-align: center;
      margin-bottom: 2rem;
      border-bottom: 1px solid var(--border);
      padding-bottom: 1.5rem;
      ${isLight ? `
        color: #000000;
      ` : isDusk ? `
        background: linear-gradient(135deg, #C9A9E9 0%, #E8A4B8 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        display: block;
        width: 100%;
      ` : `
        background: linear-gradient(180deg, #38BDF8 0%, #A855F7 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        display: block;
        width: 100%;
      `}
    }
    .journal-body {
      line-height: 1.8;
      font-weight: 300;
      font-size: 1.1rem;
      white-space: pre-wrap !important;
      ${extractedFont ? `font-family: '${extractedFont}', sans-serif;` : ''}
    }
    /* TipTap styles */
    .journal-body h1, .journal-body h2, .journal-body h3 {
      font-family: 'Poiret One', sans-serif;
      font-weight: bold;
      color: var(--neon-cyan);
      margin-top: 1.5rem;
      margin-bottom: 1rem;
    }
    .journal-body p { margin-bottom: 1.2rem; }
    .journal-body ul, .journal-body ol {
      padding-left: 1.5rem;
      margin-bottom: 1.2rem;
    }
    .journal-body li { margin-bottom: 0.5rem; }
    .journal-body mark {
      background-color: var(--neon-pink);
      color: white;
      padding: 0.1rem 0.3rem;
      border-radius: 0.2rem;
    }
    
    .divider {
      position: relative;
      height: 14px;
      width: 100%;
      background: transparent !important;
      margin: 4rem 0;
      overflow: visible;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
    }
    
    .divider::before {
      content: "";
      display: block;
      height: 2px;
      width: 100%;
      background: ${isLight ? 'linear-gradient(90deg, transparent 0%, #db2777 25%, #7c3aed 50%, #0f766e 75%, transparent 100%)' : isDusk ? 'linear-gradient(90deg, transparent 0%, #C9A9E9 25%, #E8A4B8 50%, #C9A9E9 75%, transparent 100%)' : 'linear-gradient(90deg, transparent 0%, #00CFFF 25%, #A855F7 50%, #FF007F 75%, transparent 100%)'};
      clip-path: ellipse(50% 50% at 50% 50%);
    }
    
    .divider::after {
      content: "◆  ◆  ◆";
      display: block;
      font-size: 8px;
      line-height: 1;
      margin-top: 4px;
      margin-left: 2px;
      letter-spacing: 4px;
      color: ${isLight ? '#db2777' : isDusk ? '#ff007f' : '#ff0055'};
      text-shadow: ${isLight ? '0 0 4px rgba(219, 39, 119, 0.4)' : isDusk ? '0 0 6px rgba(255, 0, 127, 0.8)' : '0 0 6px rgba(255, 0, 85, 0.8)'};
    }
    .analysis-card {
      background: var(--bg-analysis);
      border: 1px solid var(--border);
      border-left: 4px solid var(--neon-pink);
      border-radius: 1.5rem;
      padding: 2.5rem;
      box-shadow: 0 10px 30px rgba(255, 0, 255, 0.05);
      margin-top: 2rem;
    }
    .analysis-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      color: var(--neon-pink);
      font-size: 1.3rem;
      text-transform: uppercase;
      letter-spacing: 0.2em;
      margin-bottom: 2rem;
    }
    .section-title {
      font-size: 0.75rem;
      text-transform: uppercase;
      color: var(--baby-blue);
      letter-spacing: 0.2em;
      font-weight: 700;
      opacity: 0.6;
      margin-bottom: 0.75rem;
      margin-top: 1.5rem;
    }
    .summary-text {
      font-size: 1rem;
      line-height: 1.7;
      color: rgba(243, 244, 246, 0.9);
      font-style: italic;
      margin-bottom: 1.5rem;
    }
    .tag {
      display: inline-block;
      background: rgba(0, 255, 255, 0.08);
      border: 1px solid rgba(0, 255, 255, 0.2);
      color: var(--neon-cyan);
      font-size: 0.75rem;
      padding: 0.25rem 0.75rem;
      border-radius: 0.5rem;
      margin-right: 0.5rem;
      margin-bottom: 0.5rem;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .grid {
      display: grid;
      grid-template-cols: 1fr;
      gap: 1.5rem;
    }
    @media (min-width: 768px) {
      .grid { grid-template-cols: 1fr 1fr; }
    }
    .list-item {
      border-left: 2px solid rgba(0, 255, 255, 0.2);
      padding-left: 1rem;
      margin-bottom: 1rem;
      font-size: 0.9rem;
      line-height: 1.6;
    }
    .distortion-badge {
      display: inline-block;
      background: rgba(239, 68, 68, 0.08);
      border: 1px solid rgba(239, 68, 68, 0.2);
      color: #ef4444;
      font-size: 0.8rem;
      padding: 0.4rem 0.8rem;
      border-radius: 9999px;
      margin-right: 0.5rem;
      margin-bottom: 0.5rem;
      font-weight: 500;
    }
    .reframe-card {
      background: rgba(0, 255, 255, 0.03);
      border: 1px solid rgba(0, 255, 255, 0.1);
      border-left: 4px solid var(--neon-cyan);
      padding: 1rem;
      border-radius: 0.5rem;
      font-size: 0.85rem;
      line-height: 1.6;
    }
    .question-card {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.05);
      padding: 1rem;
      border-radius: 0.5rem;
      font-size: 0.9rem;
      font-style: italic;
      font-family: Georgia, serif;
      line-height: 1.6;
    }
    .watch-text {
      font-size: 0.9rem;
      line-height: 1.6;
      font-style: italic;
      color: rgba(243, 244, 246, 0.85);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">${formattedDate}</div>
    ${moodSection}
    <div class="card">
      ${titleSection}
      <div class="journal-body">
        ${currentEntry.content}
      </div>
    </div>
    ${analysisSection}
  </div>
</body>
</html>`;

      const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
      saveAs(blob, `${dateStr}_entry.html`);
    }
  };

  const handleReset = async () => {
    const isConfirmed = await customConfirm("Erase Data", "Are you sure you want to erase ALL your data? This cannot be undone.");
    if (isConfirmed) {
       await customAlert("Wipe Account", "Data clearing requested. Please contact support for full account wipe or delete entries manually.");
    }
  };

  const handleExportJSON = () => {
    const data = {
      entries,
      habits,
      tasks,
      profile
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    saveAs(blob, `neural-journal-backup-${format(new Date(), 'yyyy-MM-dd')}.json`);
  };

  const handleImportJSON = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const confirmProceed = await customConfirm('Import Data', 'This will import the data. Do you want to proceed? (Note: existing conflicting data may be overwritten or skipped based on merge logic. Simple merge implemented for Entries, Habits and Tasks.)');
        if (confirmProceed) {
           // Simple merge: Loop entries and add
           if (data.entries) {
             for (const key in data.entries) {
               const entry = data.entries[key];
               if (entry.id) {
                 const { id, ...dataToSave } = entry;
                 // Re-assign user ID to current user just in case
                 dataToSave.userId = user?.uid;
                 await setDoc(doc(db, 'entries', id), dataToSave, { merge: true }).catch(console.error);
               }
             }
           }
           if (data.habits && Array.isArray(data.habits)) {
             for (const habit of data.habits) {
               if (habit.id) {
                 const { id, ...dataToSave } = habit;
                 dataToSave.userId = user?.uid;
                 await setDoc(doc(db, 'habits', id), dataToSave, { merge: true }).catch(console.error);
               }
             }
           }
           if (data.tasks && Array.isArray(data.tasks)) {
             for (const task of data.tasks) {
               if (task.id) {
                 const { id, ...dataToSave } = task;
                 dataToSave.userId = user?.uid;
                 await setDoc(doc(db, 'tasks', id), dataToSave, { merge: true }).catch(console.error);
               }
             }
           }
           await customAlert("Import Complete", "Import complete!");
        }
      } catch (err) {
        console.error("Import error", err);
        await customAlert("Import Error", "Failed to import. Invalid JSON format.");
      }
    };
    input.click();
  };

  const isDusk = profile?.theme === 'dusk';
  const isLight = profile?.theme === 'light';

  return (
    <div className={`min-h-screen overflow-hidden flex flex-col ${isLight ? 'theme-light' : isDusk ? 'theme-dusk' : 'theme-amoled'}`}>
      {/* Top Navbar */}
      <nav className="h-16 flex items-center justify-between px-6 border-b border-white/5 backdrop-blur-xl z-50 glass" style={{ color: isLight ? '#002658' : 'inherit' }}>
        <div className="flex items-center gap-6">
          <button 
            onClick={() => setView('calendar')}
            className={`flex items-center gap-2 text-sm uppercase tracking-widest transition-colors ${view === 'calendar' ? 'text-neon-cyan font-bold' : 'text-baby-blue/40 hover:text-white'}`}
          >
            <CalendarIcon size={18} />
            Year View
          </button>
          <button 
            onClick={() => { setView('day'); setSelectedDate(new Date()); }}
             className={`flex items-center gap-2 text-sm uppercase tracking-widest transition-colors ${view === 'day' && isSameDay(selectedDate, new Date()) ? 'text-neon-cyan font-bold' : 'text-baby-blue/40 hover:text-white'}`}
          >
            Today
          </button>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-xs font-bold text-white tracking-widest uppercase">{user.displayName}</p>
            <p className="text-[10px] text-baby-blue/30 uppercase">{dateStr}</p>
          </div>
          <button onClick={logout} className="p-2 rounded-full hover:bg-white/5 text-baby-blue/40 hover:text-red-400 transition-colors">
            <LogOut size={20} />
          </button>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-grow flex overflow-hidden">
        {view === 'calendar' ? (
          <Calendar onDateSelect={(d) => { setSelectedDate(d); setView('day'); }} entries={entries} />
        ) : (
          <div className="flex w-full overflow-hidden">
            {/* Left Content Area: Dynamic based on Tab */}
            <div className="flex-grow h-full overflow-y-auto p-8 scrollbar-hide">
              <AnimatePresence mode="wait">
                {activeTab === 'entry' && (
                  <motion.div 
                    key="entry"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex flex-col w-full"
                  >
                    {/* Date Header */}
                    <div className="mb-0">
                      <h2 
                        className={`font-poiret uppercase tracking-widest ${isLight ? 'text-slate-900 font-bold' : isDusk ? 'text-[#ff6b9d] neon-glow-pink font-light' : 'text-neon-cyan neon-glow-blue font-bold'}`} 
                        style={{ fontSize: '32px', lineHeight: '1' }}
                      >
                        {format(selectedDate, 'MMMM d, yyyy')}
                      </h2>
                    </div>

                    {/* Inline Title input bar with Tags and Mood at the end */}
                    <div className="flex items-end justify-between w-full mb-[2px] gap-4">
                      <div className="flex items-baseline gap-3 flex-grow border-b pb-0 transition-all"
                           style={{ 
                             borderBottomColor: isLight ? '#e2e8f0' : isDusk ? 'rgba(236, 72, 153, 0.2)' : 'rgba(0, 255, 255, 0.2)' 
                           }}>
                        <div 
                          className="uppercase tracking-widest font-bold font-poiret shrink-0 select-none text-baby-blue/40"
                          style={{ 
                            fontSize: '11px',
                            letterSpacing: '0.25em',
                            marginBottom: '4px'
                          }}
                        >
                          Journal Entry
                        </div>
                        
                        <input
                          type="text"
                          value={currentEntry.title || ''}
                          onChange={async (e) => {
                            await saveEntryFields({ title: e.target.value });
                          }}
                          placeholder="An Aurora Gradient Title in Poiret One"
                          style={{
                            fontFamily: "'Poiret One', sans-serif",
                            background: isLight 
                              ? 'none' 
                              : isDusk 
                                ? 'linear-gradient(90deg, #C9A9E9 0%, #E8A4B8 100%)' 
                                : 'linear-gradient(90deg, #38BDF8 0%, #A855F7 100%)',
                            WebkitBackgroundClip: isLight ? 'unset' : 'text',
                            WebkitTextFillColor: isLight ? 'unset' : 'transparent',
                            color: isLight ? '#000000' : 'transparent',
                            fontSize: '30px',
                            fontWeight: 'normal',
                            lineHeight: '1',
                            padding: '0 0 2px 0',
                            margin: '0',
                          }}
                          className={`flex-grow bg-transparent focus:outline-none transition-all ${
                            isLight
                              ? 'placeholder-slate-300'
                              : isDusk
                                ? 'placeholder-pink-300/20'
                                : 'placeholder-neon-cyan/20'
                          }`}
                        />
                      </div>

                      {/* Tags & Mood Capsules */}
                      <div className="flex items-center gap-2 shrink-0 mb-[1px]">
                        {/* Tags Capsule */}
                        <div className="flex items-center gap-1.5 bg-white/5 p-1 px-3 rounded-full border border-white/5">
                          <span className="text-[9px] font-bold text-baby-blue/40 uppercase tracking-widest">Tags</span>
                          <input 
                            type="text" 
                            placeholder="Add tag"
                            value={tagInput}
                            onChange={(e) => setTagInput(e.target.value)}
                            onKeyDown={async (e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                const newTag = tagInput.trim().toLowerCase();
                                if (newTag) {
                                  const currentTags = currentEntry.tags || [];
                                  if (!currentTags.includes(newTag)) {
                                    await saveEntryFields({ tags: [...currentTags, newTag] });
                                  }
                                  setTagInput('');
                                }
                              }
                            }}
                            className="bg-transparent text-[11px] border-none focus:ring-0 text-white w-16 placeholder:text-white/20 p-0"
                          />
                          <button
                            type="button"
                            onClick={async () => {
                              const newTag = tagInput.trim().toLowerCase();
                              if (newTag) {
                                const currentTags = currentEntry.tags || [];
                                if (!currentTags.includes(newTag)) {
                                  await saveEntryFields({ tags: [...currentTags, newTag] });
                                }
                                setTagInput('');
                              }
                            }}
                            className="text-neon-cyan hover:text-white transition-colors cursor-pointer flex items-center justify-center"
                            title="Add Tag"
                          >
                            <Plus size={12} />
                          </button>
                        </div>

                        {/* Mood Capsule */}
                        <div className="flex items-center gap-2 bg-white/5 p-1 px-3 rounded-full border border-white/5">
                          <span className="text-[9px] font-bold text-baby-blue/40 uppercase tracking-widest">Mood</span>
                          <select 
                            value={currentEntry.mood || ''}
                            onChange={(e) => handleMoodUpdate(e.target.value)}
                            className="bg-transparent text-[11px] border-none focus:ring-0 text-white cursor-pointer p-0 appearance-none"
                          >
                            <option value="" style={{ backgroundColor: 'var(--bg-secondary)' }}>Choose...</option>
                            {MOOD_OPTIONS.map(m => {
                              const emoji = MOOD_EMOJIS[m] || '📝';
                              return (
                                <option key={m} value={m} style={{ backgroundColor: 'var(--bg-secondary)' }}>
                                  {emoji} {m}
                                </option>
                              );
                            })}
                          </select>
                        </div>
                      </div>
                    </div>
                    
                    {(currentEntry.tags || []).length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-1">
                        {(currentEntry.tags || []).map((tag, i) => (
                          <span key={i} className="flex items-center gap-1 px-2 py-0.5 bg-neon-cyan/10 border border-neon-cyan/20 text-neon-cyan text-[9px] rounded-lg tracking-wider uppercase font-bold">
                            #{tag}
                            <button 
                              onClick={async () => {
                                const currentTags = currentEntry.tags || [];
                                const newTags = currentTags.filter(t => t !== tag);
                                await saveEntryFields({ tags: newTags });
                              }}
                              className="text-neon-cyan/60 hover:text-red-400 text-sm ml-1"
                            >
                              &times;
                            </button>
                          </span>
                        ))}
                      </div>
                    )}

                    <Editor 
                      key={dateStr}
                      theme={profile?.theme || 'amoled'}
                      content={currentEntry.content} 
                      onChange={handleEntryUpdate}
                      onExport={exportEntry}
                      onSave={handleManualSave}
                      onDelete={handleDeleteEntry}
                      fonts={profile?.favoriteFonts}
                      onAlert={customAlert}
                    />

                    {analysisError && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="max-w-3xl mx-auto p-5 bg-red-950/20 border border-red-500/30 rounded-2xl space-y-3 mb-6"
                      >
                        <div className="flex items-center gap-2 text-red-400 font-bold tracking-wider uppercase text-xs">
                          <AlertTriangle size={16} className="text-red-500 font-bold" />
                          <span>Gemini API Integration Notice</span>
                        </div>
                        <p className="text-xs text-red-200 font-mono bg-black/40 p-3 rounded-lg border border-red-500/10 whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto">
                          {analysisError}
                        </p>
                        <div className="text-xs text-baby-blue/60 leading-relaxed border-t border-white/5 pt-2">
                          <strong>How to resolve this error:</strong>
                          <ol className="list-decimal pl-5 mt-1 space-y-1 text-baby-blue/50">
                            <li>Check if your prepayment credentials are depleted (billing limits or depleted Google Cloud project tokens).</li>
                            <li>Go to the <span className="text-neon-pink font-bold">Settings (gear icon) &gt; Secrets</span> menu in Google AI Studio to update/fix your secrets.</li>
                            <li>Make sure either <code className="bg-white/5 text-white p-0.5 rounded font-mono">GEMINI_API_KEY</code> or <code className="bg-white/5 text-white p-0.5 rounded font-mono">CUSTOM_GEMINI_API_KEY</code> is correctly formatted and active.</li>
                          </ol>
                        </div>
                      </motion.div>
                    )}

                    {/* Gemini AI Parameter Selectors */}
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-6 max-w-2xl mx-auto p-5 bg-white/5 border border-white/5 rounded-2xl">
                      <div className="flex flex-col gap-1.5 w-full sm:w-1/2">
                        <label className="text-[10px] uppercase font-bold text-baby-blue/60 tracking-widest flex items-center gap-1.5 pl-1">
                          <span className="w-1.5 h-1.5 bg-neon-pink rounded-full animate-pulse" />
                          Gemini Variant Engine
                        </label>
                        <select
                          value={selectedModel}
                          onChange={(e) => setSelectedModel(e.target.value)}
                          className="bg-black/40 text-xs border border-white/10 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:ring-1 focus:ring-neon-pink focus:border-neon-pink w-full cursor-pointer font-mono"
                        >
                          <option value="gemini-3.5-flash" style={{ backgroundColor: '#18181b' }}>Gemini 3.5 Flash (Primary)</option>
                          <option value="gemini-2.5-flash" style={{ backgroundColor: '#18181b' }}>Gemini 2.5 Flash</option>
                          <option value="gemini-2.0-flash" style={{ backgroundColor: '#18181b' }}>Gemini 2.0 Flash</option>
                          <option value="gemini-1.5-flash" style={{ backgroundColor: '#18181b' }}>Gemini 1.5 Flash</option>
                          <option value="gemini-3.1-flash-lite" style={{ backgroundColor: '#18181b' }}>Gemini 3.1 Flash-Lite</option>
                        </select>
                      </div>

                      <div className="flex flex-col gap-1.5 w-full sm:w-1/2">
                        <label className="text-[10px] uppercase font-bold text-baby-blue/60 tracking-widest flex items-center gap-1.5 pl-1">
                          <span className="w-1.5 h-1.5 bg-neon-cyan rounded-full animate-pulse" />
                          Readout Detail Depth
                        </label>
                        <select
                          value={selectedStyle}
                          onChange={(e) => setSelectedStyle(e.target.value)}
                          className="bg-black/40 text-xs border border-white/10 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:ring-1 focus:ring-neon-cyan focus:border-neon-cyan w-full cursor-pointer font-mono"
                        >
                          <option value="detailed" style={{ backgroundColor: '#18181b' }}>Detailed (Deep Clinical Psychoanalysis)</option>
                          <option value="normal" style={{ backgroundColor: '#18181b' }}>Normal Readout (Standard CBT)</option>
                          <option value="brief" style={{ backgroundColor: '#18181b' }}>Brief Checkpoint (Verify Key & Summary)</option>
                        </select>
                      </div>
                    </div>

                    <div className="flex justify-center">
                      <button 
                         onClick={handleAnalyze}
                         disabled={analyzing}
                         style={{ color: '#ffffff' }}
                         className={`
                           flex items-center gap-2 px-8 py-3 bg-gradient-to-r from-[#4c0066] to-[#660033] rounded-full text-sm font-bold uppercase tracking-[0.2em] transition-transform hover:scale-105 border border-neon-pink shadow-[0_0_20px_rgba(255,0,255,0.3)]
                           ${analyzing ? 'opacity-50 cursor-wait' : ''}
                         `}
                      >
                        <Sparkles size={16} />
                        {analyzing ? 'Processing Insights...' : 'Run AI Analysis'}
                      </button>
                    </div>

                    {currentEntry.analysis && (
                      <motion.div 
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="p-6 bg-[var(--bg-secondary)] border border-[var(--border)] border-l-4 border-l-neon-pink rounded-2xl space-y-6"
                      >
                         <div className="flex flex-col gap-3 pb-2">
                           <div className="flex items-center gap-3 text-neon-pink">
                             <Sparkles size={24} className="neon-glow-pink" />
                             <h3 className="text-2xl tracking-widest uppercase font-poiret font-bold">Psychological Readout</h3>
                           </div>
                           {/* Custom neon gradient divider, thicker in the middle and thinner at the ends */}
                           <div className="relative w-full h-[2px] flex items-center justify-center my-1 z-10">
                             <svg className="w-full h-full" viewBox="0 0 100 2" preserveAspectRatio="none">
                               <defs>
                                 <linearGradient 
                                      id="neonDividerGrad" 
                                      x1="0%" 
                                      y1="0%" 
                                      x2="100%" 
                                      y2="0%"
                                    >
                                      {isDusk ? (
                                        <>
                                          <stop offset="0%" stopColor="transparent" />
                                          <stop offset="25%" stopColor="#C9A9E9" stopOpacity="0.5" />
                                          <stop offset="50%" stopColor="#E8A4B8" />
                                          <stop offset="75%" stopColor="#C9A9E9" stopOpacity="0.5" />
                                          <stop offset="100%" stopColor="transparent" />
                                        </>
                                      ) : isLight ? (
                                        <>
                                          <stop offset="0%" stopColor="transparent" />
                                          <stop offset="25%" stopColor="#db2777" />
                                          <stop offset="50%" stopColor="#7c3aed" />
                                          <stop offset="75%" stopColor="#0f766e" />
                                          <stop offset="100%" stopColor="transparent" />
                                        </>
                                      ) : (
                                        <>
                                          <stop offset="0%" stopColor="transparent" />
                                          <stop offset="25%" stopColor="#00CFFF" />
                                          <stop offset="50%" stopColor="#A855F7" />
                                          <stop offset="75%" stopColor="#FF007F" />
                                          <stop offset="100%" stopColor="transparent" />
                                        </>
                                      )}
                                   </linearGradient>
                               </defs>
                               <path d="M 0 1 Q 50 0, 100 1 Q 50 2, 0 1" fill="url(#neonDividerGrad)" />
                             </svg>
                           </div>
                         </div>
 
                         {/* Crisis Safety Note */}
                         {currentEntry.analysis.crisisMessage && (
                           <motion.div 
                             initial={{ opacity: 0, scale: 0.95 }}
                             animate={{ opacity: 1, scale: 1 }}
                             className="p-4 bg-red-950/40 border border-red-500/50 rounded-xl flex gap-3 text-red-200"
                           >
                             <AlertTriangle size={20} className="text-red-500 shrink-0 mt-0.5 animate-pulse" />
                             <div className="text-sm space-y-1">
                               <span className="font-bold uppercase tracking-wider text-red-400">Immediate Support & Safety Notice</span>
                               <p className="leading-relaxed">{currentEntry.analysis.crisisMessage}</p>
                             </div>
                           </motion.div>
                         )}
                         
                         <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                           <div className="space-y-4">
                             <div className="space-y-1">
                               <h4 className="text-xs text-baby-blue/40 uppercase font-bold tracking-widest">Atmosphere Summary</h4>
                               <p className="text-base leading-relaxed text-[var(--text-primary)]/80 italic">"{currentEntry.analysis.moodSummary}"</p>
                             </div>
                             
                             {/* Optional Safety Note */}
                             {currentEntry.analysis.safetyNote && (
                               <div className="text-xs text-baby-blue/40 leading-relaxed font-sans italic border-t border-white/5 pt-2">
                                 {currentEntry.analysis.safetyNote}
                               </div>
                             )}
 
                             <div className="space-y-1">
                               <h4 className="text-xs text-baby-blue/40 uppercase font-bold tracking-widest">AI Suggested Tags</h4>
                               <div className="flex flex-wrap gap-2 pt-1">
                                 {currentEntry.analysis.tags?.map((t: string, i: number) => (
                                   <button 
                                     key={i} 
                                     onClick={async () => {
                                       const currentTags = currentEntry.tags || [];
                                       if (!currentTags.includes(t)) {
                                         await saveEntryFields({ tags: [...currentTags, t] });
                                       }
                                     }}
                                      disabled={(currentEntry.tags || []).includes(t)}
                                      className={`px-2 py-1 bg-neon-cyan/10 border border-neon-cyan/20 text-neon-cyan text-xs rounded-lg tracking-wider uppercase font-bold transition-all ${(currentEntry.tags || []).includes(t) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-neon-cyan/20 hover:scale-105 cursor-pointer'}`}
                                   >
                                     #{t}
                                   </button>
                                 ))}
                               </div>
                             </div>
                           </div>
                           
                           {/* Key Themes & Patterns (If new structure exists) */}
                           {currentEntry.analysis.keyThemes && currentEntry.analysis.keyThemes.length > 0 ? (
                             <div className="space-y-3">
                               <h4 className="text-xs text-baby-blue/40 uppercase font-bold tracking-widest">Key Themes & Patterns</h4>
                               <ul className="space-y-3">
                                 {currentEntry.analysis.keyThemes.map((theme: string, i: number) => (
                                   <li key={i} className="flex gap-3 text-sm leading-relaxed text-[var(--text-primary)]/80 border-l border-neon-cyan/30 pl-4 py-1">
                                     <ChevronRight size={14} className="text-neon-cyan mt-0.5 shrink-0" />
                                     {theme}
                                   </li>
                                 ))}
                               </ul>
                             </div>
                           ) : (
                             // Legacy: Identified Cognitive Trends
                             <div className="space-y-3">
                               <h4 className="text-xs text-baby-blue/40 uppercase font-bold tracking-widest">Identified Cognitive Trends</h4>
                               <ul className="space-y-3">
                                 {(currentEntry.analysis.insights || []).map((insight: string, i: number) => (
                                   <li key={i} className="flex gap-3 text-sm leading-relaxed text-[var(--text-primary)]/80 border-l border-white/10 pl-4 py-1">
                                     <ChevronRight size={14} className="text-neon-purple mt-0.5 shrink-0" />
                                     {insight}
                                   </li>
                                 ))}
                               </ul>
                             </div>
                           )}
                         </div>
 
                         {/* Cognitive Distortions Section */}
                         {currentEntry.analysis.cognitiveDistortions && (
                           <div className="p-4 bg-white/5 border border-white/5 rounded-xl space-y-2">
                             <h4 className="text-xs text-neon-pink uppercase font-bold tracking-widest">Cognitive Distortions Identified</h4>
                             {currentEntry.analysis.cognitiveDistortions.length > 0 ? (
                               <div className="flex flex-wrap gap-2 pt-1">
                                 {currentEntry.analysis.cognitiveDistortions.map((distortion: string, i: number) => (
                                   <span key={i} className="px-3 py-1 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-full font-medium">
                                     ⚠️ {distortion}
                                   </span>
                                 ))}
                               </div>
                             ) : (
                               <p className="text-sm text-baby-blue/60 italic">No cognitive distortions flagged in this entry.</p>
                             )}
                           </div>
                         )}
 
                         {/* Underlying Dynamics Section */}
                         {currentEntry.analysis.underlyingDynamics && currentEntry.analysis.underlyingDynamics.length > 0 && (
                           <div className="p-4 bg-white/5 border border-white/5 rounded-xl space-y-2">
                             <h4 className="text-xs text-neon-purple uppercase font-bold tracking-widest">Underlying Dynamics & Conflicts (CBT Hypotheses)</h4>
                             <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
                               {currentEntry.analysis.underlyingDynamics.map((dynamic: string, i: number) => (
                                 <li key={i} className="text-sm text-[var(--text-primary)]/80 leading-relaxed bg-black/10 p-3 rounded-lg border border-white/5">
                                   💡 {dynamic}
                                 </li>
                               ))}
                             </ul>
                           </div>
                         )}
 
                         {/* CBT Reframes & Alternative interpretations */}
                         {currentEntry.analysis.cbtReframes && currentEntry.analysis.cbtReframes.length > 0 && (
                           <div className="p-4 bg-white/5 border border-white/5 rounded-xl space-y-3">
                             <h4 className="text-xs text-neon-pink uppercase font-bold tracking-widest">CBT Reframes & Alternative Perspectives</h4>
                             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                               {currentEntry.analysis.cbtReframes.map((reframe: string, i: number) => (
                                 <div key={i} className="text-sm text-[var(--text-primary)]/80 leading-relaxed bg-neon-cyan/5 p-3 rounded-lg border border-neon-cyan/15 border-l-4 border-l-neon-cyan">
                                   🔄 {reframe}
                                 </div>
                               ))}
                             </div>
                           </div>
                         )}
 
                         {/* Reflection Questions Section */}
                         {currentEntry.analysis.reflectionQuestions && currentEntry.analysis.reflectionQuestions.length > 0 && (
                           <div className="p-4 bg-white/5 border border-white/5 rounded-xl space-y-2">
                             <h4 className="text-xs text-neon-cyan uppercase font-bold tracking-widest">Clinician Observations & Reflection Questions</h4>
                             <ul className="space-y-2">
                               {currentEntry.analysis.reflectionQuestions.map((q: string, i: number) => (
                                 <li key={i} className="text-sm text-[var(--text-primary)]/90 leading-relaxed bg-black/10 p-3 rounded-lg border border-white/5 font-serif italic">
                                   ❓ {q}
                                 </li>
                               ))}
                             </ul>
                           </div>
                         )}
 
                         {/* Watch for Pattern section */}
                         {currentEntry.analysis.watchPattern && (
                           <div className="p-4 bg-white/5 border border-white/5 rounded-xl space-y-1">
                             <h4 className="text-xs text-neon-pink uppercase font-bold tracking-widest">Future Monitoring: Watch for This Pattern</h4>
                             <p className="text-sm text-[var(--text-primary)]/80 leading-relaxed italic">{currentEntry.analysis.watchPattern}</p>
                           </div>
                         )}
                         
                         <div className="bg-white/5 p-6 rounded-2xl border border-white/5 border-l-4 border-l-neon-blue">
                           <h4 className="text-xs text-neon-blue uppercase font-bold tracking-widest mb-2">Therapeutic Recommendation</h4>
                           <p className="text-base leading-relaxed font-light">{currentEntry.analysis.advice}</p>
                         </div>
                      </motion.div>
                    )}
                  </motion.div>
                )}

                {activeTab === 'habits' && (
                  <motion.div 
                    key="habits"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="space-y-8"
                  >
                    <div className="mb-8">
                      <h2 className={`text-3xl font-poiret uppercase tracking-widest ${isLight ? 'text-slate-900' : 'text-neon-cyan neon-glow-blue'}`}>
                        Daily Goals
                      </h2>
                      <p className={`${isLight ? 'text-slate-500' : 'text-baby-blue/40'} text-sm mt-2 uppercase tracking-widest`}>
                        Habit Progress & Daily Actions
                      </p>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                      <HabitTracker date={dateStr} allHabits={habits} profile={profile} onUpdate={handleHabitUpdate} />
                      <TaskList date={dateStr} tasks={currentTasks} onAdd={handleAddTask} onUpdate={handleUpdateTask} onDelete={handleDeleteTask} />
                    </div>
                  </motion.div>
                )}

                {activeTab === 'search' && (
                  <motion.div 
                    key="search"
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="h-full"
                  >
                    <SearchEntries entries={entries} onSelectEntry={(d) => { setSelectedDate(d); setActiveTab('entry'); }} />
                  </motion.div>
                )}

                {activeTab === 'analytics' && (
                  <motion.div 
                    key="analytics"
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="h-full"
                  >
                    <Analytics entries={Object.values(entries)} habits={habits} profile={profile} onAlert={customAlert} />
                  </motion.div>
                )}

                {activeTab === 'settings' && (
                   <motion.div 
                      key="settings"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="max-w-2xl mx-auto space-y-12"
                   >
                     <div className="text-center mb-8">
                        <h2 className="text-3xl font-poiret text-neon-purple neon-glow-purple uppercase tracking-widest">Preferences</h2>
                        <p className="text-baby-blue/40 text-xs mt-2 uppercase tracking-widest">Environment & Data Management</p>
                     </div>

                     <div className="space-y-8">
                       <section className="glass p-8 rounded-3xl space-y-6">
                         <div className="flex items-center gap-3 text-white border-b border-white/10 pb-4">
                           <Sparkles size={18} className="text-neon-cyan" />
                           <h3 className="text-sm uppercase font-bold tracking-[0.2em] opacity-80">Aesthetics</h3>
                         </div>
                         
                         <div className="space-y-4">
                           <div className="space-y-2">
                             <label className="text-[10px] text-baby-blue/40 uppercase font-bold tracking-widest">Interface Theme</label>
                             <div className="grid grid-cols-3 gap-3 w-full">
                               {['amoled', 'light', 'dusk'].map(t => (
                                 <button
                                   key={t}
                                   onClick={async () => {
                                     try {
                                       await updateDoc(doc(db, 'users', user.uid), { theme: t });
                                     } catch (err) {
                                       handleFirestoreError(err, OperationType.WRITE, 'users');
                                     }
                                   }}
                                   className={`px-3 py-3 rounded-xl border text-[10px] sm:text-xs text-center uppercase tracking-widest transition-all truncate hover:border-white/20 ${profile?.theme === t ? 'bg-white/10 border-white/40 text-white' : 'bg-transparent border-white/5 text-baby-blue/40'}`}
                                 >
                                   {t}
                                 </button>
                               ))}
                             </div>
                           </div>
                         </div>
                       </section>

                       <section className="glass p-8 rounded-3xl space-y-6">
                         <div className="flex items-center gap-3 text-white border-b border-white/10 pb-4">
                           <BarChart2 size={18} className="text-neon-pink" />
                           <h3 className="text-sm uppercase font-bold tracking-[0.2em] opacity-80">Data Sovereignty</h3>
                         </div>
                         <div className="grid grid-cols-2 gap-4">
                           <button onClick={handleExportJSON} className="px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-xs uppercase tracking-widest hover:border-white/40 transition-all">Export JSON</button>
                           <button onClick={handleImportJSON} className="px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-xs uppercase tracking-widest hover:border-white/40 transition-all">Import JSON</button>
                           <p className="col-span-2 text-[10px] text-baby-blue/40 text-center leading-relaxed">Downloads may not work inside the preview window. Please open the app in a new tab to export data.</p>
                           <button 
                             onClick={handleReset}
                             className="col-span-2 px-4 py-3 bg-red-950/20 border border-red-500/20 text-red-400 rounded-xl text-xs uppercase tracking-widest hover:border-red-500 transition-all"
                           >
                              Hard Reset App
                           </button>
                         </div>
                       </section>
                     </div>
                   </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Right Tabs Rail */}
            <div className="w-14 border-l border-[var(--border)] flex flex-col items-center py-6 gap-6 glass">
              {(['entry', 'habits', 'analytics', 'search'] as const).map((tab) => {
                const isActive = activeTab === tab;
                const label = tab === 'entry' ? 'JOURNAL' : tab === 'habits' ? 'DAILY GOALS' : tab === 'search' ? 'SEARCH' : 'ANALYTICS';
                return (
                  <button 
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`tab-vertical px-3 py-5 transition-all duration-300 rounded-l-md font-bold tracking-widest ${
                      isActive 
                        ? 'bg-[var(--neon-pink-color)] text-black shadow-lg shadow-neon-pink/10' 
                        : isLight
                          ? 'text-indigo-950/75 hover:text-indigo-600 hover:bg-indigo-50/50'
                          : 'text-baby-blue/40 hover:text-neon-pink hover:opacity-100'
                    }`}
                    title={label}
                  >
                    {label}
                  </button>
                );
              })}
              <div className="flex-grow" />
              <button 
                onClick={() => setActiveTab('settings')}
                className={`tab-vertical px-3 py-5 transition-all duration-300 rounded-l-md font-bold tracking-widest ${
                  activeTab === 'settings' 
                    ? 'bg-[var(--neon-pink-color)] text-black shadow-lg shadow-neon-pink/10' 
                    : isLight
                      ? 'text-indigo-950/75 hover:text-indigo-600 hover:bg-indigo-50/50'
                      : 'text-baby-blue/40 hover:text-neon-pink hover:opacity-100'
                }`}
                title="Settings"
              >
                SETTINGS
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Error Modal Popup */}
      <AnimatePresence>
        {showErrorModal && analysisError && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-zinc-950 border border-red-500/30 rounded-3xl p-6 shadow-2xl max-w-2xl w-full space-y-6"
            >
              <div className="flex items-start gap-4">
                <div className="p-3 bg-red-500/10 rounded-2xl border border-red-500/30 text-red-500 animate-pulse shrink-0">
                  <AlertTriangle size={28} />
                </div>
                <div className="space-y-1 flex-grow">
                  <h3 className="text-xl font-bold uppercase tracking-wider text-red-400 font-poiret">Gemini API Connection Failed</h3>
                  <p className="text-xs text-baby-blue/60 leading-relaxed">The journal intelligence system failed to establish a secure channel to the LLM backend.</p>
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-[10px] font-bold text-red-400 uppercase tracking-widest">Diagnostic Logs</span>
                <div className="bg-black/80 border border-red-500/10 p-4 rounded-xl max-h-48 overflow-y-auto font-mono text-xs text-red-200 leading-relaxed break-words whitespace-pre-wrap">
                  {analysisError}
                </div>
              </div>

              <div className="space-y-2 border-t border-white/5 pt-4">
                <span className="text-[10px] font-bold text-baby-blue/60 uppercase tracking-widest">How to Resolve This</span>
                <ul className="list-decimal pl-5 text-xs text-baby-blue/80 space-y-2 leading-relaxed">
                  <li>
                    Verify your Google AI Studio credentials. Make sure you've entered a valid, active <span className="text-neon-pink font-bold font-sans">API Key</span> in 
                    the <span className="text-neon-pink font-bold font-sans">Settings (gear icon) &gt; Secrets</span> menu or <span className="text-neon-pink font-bold font-sans">.env</span>.
                  </li>
                  <li>
                    Check if your Google Cloud project prepayment/billing quotas are exhausted, dormant, or blocked.
                  </li>
                  <li>
                    Try selecting a different <span className="text-neon-cyan font-bold font-sans">Gemini Engine Variant</span> from the selector (e.g. switching to Gemini 3.1 Flash-Lite or Gemini 2.0 Flash).
                  </li>
                </ul>
              </div>

              <div className="flex justify-end pt-2">
                <button 
                  onClick={() => {
                    setShowErrorModal(false);
                    setAnalysisError(null);
                  }}
                  className="px-6 py-2.5 bg-red-950/40 border border-red-500 text-red-400 font-bold uppercase tracking-wider text-xs rounded-xl hover:bg-red-500 hover:text-white transition-all shadow-[0_0_15px_rgba(239,68,68,0.2)] cursor-pointer"
                >
                  Dismiss & Troubleshoot
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Custom Promise-Based Confirm Dialog */}
      <AnimatePresence>
        {confirmDialog && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className={`border rounded-3xl p-6 shadow-2xl max-w-md w-full space-y-6 ${isLight ? 'bg-white border-slate-200 text-slate-900' : 'bg-zinc-950 border-neon-cyan/20 text-white'}`}
            >
              <div className="flex items-start gap-4">
                <div className={`p-3 rounded-2xl border shrink-0 ${isLight ? 'bg-slate-100 border-slate-200 text-slate-700' : 'bg-white/5 border-white/10 text-neon-cyan'}`}>
                  <AlertTriangle size={24} />
                </div>
                <div className="space-y-1 flex-grow">
                  <h3 className="text-lg font-bold uppercase tracking-wider font-poiret">{confirmDialog.title}</h3>
                  <p className={`text-xs leading-relaxed ${isLight ? 'text-slate-500' : 'text-baby-blue/60'}`}>{confirmDialog.message}</p>
                </div>
              </div>

              <div className="flex justify-end gap-3 border-t border-white/5 pt-4">
                <button
                  onClick={confirmDialog.onCancel}
                  className={`px-4 py-2 border font-bold uppercase tracking-wider text-xs rounded-xl cursor-pointer transition-all ${
                    isLight 
                      ? 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100' 
                      : 'bg-white/5 border-white/10 text-baby-blue/80 hover:text-white hover:bg-white/10'
                  }`}
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDialog.onConfirm}
                  className={`px-4 py-2 font-bold uppercase tracking-wider text-xs rounded-xl cursor-pointer transition-all ${
                    isLight 
                      ? 'bg-red-600 text-white hover:bg-red-700' 
                      : 'bg-neon-pink text-black hover:bg-neon-purple hover:text-black hover:shadow-[0_0_12px_rgba(255,0,255,0.4)]'
                  }`}
                >
                  Confirm
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Custom Promise-Based Alert Dialog */}
      <AnimatePresence>
        {alertDialog && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className={`border rounded-3xl p-6 shadow-2xl max-w-md w-full space-y-6 ${isLight ? 'bg-white border-slate-200 text-slate-900' : 'bg-zinc-950 border-neon-cyan/20 text-white'}`}
            >
              <div className="flex items-start gap-4">
                <div className={`p-3 rounded-2xl border shrink-0 ${isLight ? 'bg-slate-100 border-slate-200 text-slate-700' : 'bg-white/5 border-white/10 text-neon-cyan'}`}>
                  <AlertTriangle size={24} />
                </div>
                <div className="space-y-1 flex-grow">
                  <h3 className="text-lg font-bold uppercase tracking-wider font-poiret">{alertDialog.title}</h3>
                  <p className={`text-xs leading-relaxed ${isLight ? 'text-slate-500' : 'text-baby-blue/60'}`}>{alertDialog.message}</p>
                </div>
              </div>

              <div className="flex justify-end border-t border-white/5 pt-4">
                <button
                  onClick={alertDialog.onClose}
                  className={`px-6 py-2 font-bold uppercase tracking-wider text-xs rounded-xl cursor-pointer transition-all ${
                    isLight 
                      ? 'bg-slate-900 text-white hover:bg-slate-800' 
                      : 'bg-neon-cyan text-black hover:bg-white hover:text-black hover:shadow-[0_0_12px_rgba(0,255,255,0.4)]'
                  }`}
                >
                  Dismiss
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
