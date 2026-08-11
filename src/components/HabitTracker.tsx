import { useState, useMemo } from 'react';
import { Habit, UserProfile, HabitGoal, DEFAULT_HABITS, HabitConfigItem } from '../types';
import { Check, Edit2, Target, Plus, Trash2, AlertTriangle, RefreshCw } from 'lucide-react';
import { isSameDay, subDays, parseISO } from 'date-fns';
import { doc, updateDoc, collection, query, where, getDocs, deleteDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { motion, AnimatePresence } from 'motion/react';

interface HabitTrackerProps {
  date: string;
  allHabits: Habit[];
  profile: UserProfile | null;
  onUpdate: (habitKey: string, newValue: number) => void;
}

export default function HabitTracker({ date, allHabits, profile, onUpdate }: HabitTrackerProps) {
  const [editingGoalKey, setEditingGoalKey] = useState<string | null>(null);
  const [tempGoal, setTempGoal] = useState<HabitGoal>({ type: 'weekly', target: 3 });

  // Add Habit form states
  const [newHabitText, setNewHabitText] = useState('');
  const [newHabitMax, setNewHabitMax] = useState<number>(1);
  const [isAdding, setIsAdding] = useState(false);

  // Delete modal states
  const [habitToDelete, setHabitToDelete] = useState<HabitConfigItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Resolve dynamic habits list from user profile or fallback to defaults
  const habitsConfig = useMemo(() => {
    const list = profile?.habitsList || DEFAULT_HABITS;
    // Order the habits by their daily completion target (max) in ascending order.
    // Filter out hidden ones.
    return [...list]
      .filter(h => !h.hidden)
      .sort((a, b) => (a.max || 1) - (b.max || 1));
  }, [profile?.habitsList]);

  // Get habits for the currently viewed date
  const currentHabits = useMemo(() => {
    return allHabits.filter(h => h.date === date).reduce((acc, h) => {
      acc[h.habitKey] = h;
      return acc;
    }, {} as { [key: string]: Habit });
  }, [allHabits, date]);

  // Calculate streaks dynamically
  const streaks = useMemo(() => {
    const counts: Record<string, number> = {};
    const referenceDate = parseISO(date);
    const fullList = profile?.habitsList || DEFAULT_HABITS;

    fullList.forEach(conf => {
      let currentStreak = 0;
      let checkDate = referenceDate;
      const key = conf.key;
      const maxVal = conf.max || 1;

      while (true) {
        const checkStr = checkDate.toISOString().split('T')[0];
        const dayHabit = allHabits.find(h => h.habitKey === key && h.date === checkStr);
        if (dayHabit && dayHabit.value >= maxVal) {
          currentStreak++;
          checkDate = subDays(checkDate, 1);
        } else {
          // If checking today and it's incomplete, we still count yesterday's streak.
          if (currentStreak === 0 && isSameDay(checkDate, referenceDate)) {
             checkDate = subDays(checkDate, 1);
             const yesterdayStr = checkDate.toISOString().split('T')[0];
             const yesterdayHabit = allHabits.find(h => h.habitKey === key && h.date === yesterdayStr);
             if (yesterdayHabit && yesterdayHabit.value >= maxVal) {
                currentStreak++;
                checkDate = subDays(checkDate, 1);
                continue;
             }
          }
          break;
        }
      }
      counts[key] = currentStreak;
    });
    return counts;
  }, [allHabits, date, profile?.habitsList]);

  // Save the custom habit target/goal (weekly/monthly target days)
  const saveGoal = async (key: string) => {
    if (!profile) return;
    try {
      const newGoals = { ...(profile.habitGoals || {}), [key]: tempGoal };
      await updateDoc(doc(db, 'users', profile.uid), { habitGoals: newGoals });
      setEditingGoalKey(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'users');
    }
  };

  // Add Dynamic Habit to profile list
  const handleAddHabit = async () => {
    if (!newHabitText.trim() || !profile) return;
    setIsAdding(true);
    
    // Generate a unique key based on lowercase habit label
    const sanitizedKey = newHabitText
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
    
    // Fallback if empty or purely special chars
    const baseKey = sanitizedKey || `habit_${Date.now()}`;
    let uniqueKey = baseKey;
    
    // Retrieve current list
    const currentList = profile.habitsList || DEFAULT_HABITS;
    
    // Ensure the key is truly unique
    let counter = 1;
    while (currentList.some(h => h.key === uniqueKey)) {
      uniqueKey = `${baseKey}_${counter}`;
      counter++;
    }

    const newHabitItem: HabitConfigItem = {
      key: uniqueKey,
      label: newHabitText.trim(),
      max: newHabitMax,
    };

    try {
      const updatedList = [...currentList, newHabitItem];
      await updateDoc(doc(db, 'users', profile.uid), {
        habitsList: updatedList
      });
      setNewHabitText('');
      setNewHabitMax(1);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'users');
    } finally {
      setIsAdding(false);
    }
  };

  // Delete custom habit handler
  const handleDeleteHabitExecute = async (option: 'hide' | 'wipe') => {
    if (!habitToDelete || !profile) return;
    setIsDeleting(true);

    try {
      const currentList = profile.habitsList || DEFAULT_HABITS;
      let updatedList: HabitConfigItem[] = [];

      if (option === 'hide') {
        // Option 1: Set hidden = true on the habit config to retain historical data
        updatedList = currentList.map(h => {
          if (h.key === habitToDelete.key) {
            return { ...h, hidden: true };
          }
          return h;
        });
      } else {
        // Option 2: Completely wipe the habit from config list and delete all logs in '/habits'
        updatedList = currentList.filter(h => h.key !== habitToDelete.key);

        // Delete all daily tracking documents associated with this habit key and user
        const q = query(
          collection(db, 'habits'), 
          where('userId', '==', profile.uid), 
          where('habitKey', '==', habitToDelete.key)
        );
        const querySnapshot = await getDocs(q);
        const deletePromises = querySnapshot.docs.map(docSnap => 
          deleteDoc(doc(db, 'habits', docSnap.id))
        );
        await Promise.all(deletePromises);
      }

      // Also remove goal if fully wiping
      const updatedGoals = { ...(profile.habitGoals || {}) };
      if (option === 'wipe') {
        delete updatedGoals[habitToDelete.key];
      }

      await updateDoc(doc(db, 'users', profile.uid), {
        habitsList: updatedList,
        habitGoals: updatedGoals
      });

      setHabitToDelete(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'users');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6 relative">
      <h3 className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-neon-pink font-bold mb-4 opacity-80 border-b border-neon-pink/20 pb-2">
        <Target size={16} /> Daily Goal Progress
      </h3>

      {/* Sleek Minimalistic Add Habit input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newHabitText}
          onChange={(e) => setNewHabitText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAddHabit()}
          placeholder="Enter new habit name..."
          disabled={isAdding}
          className="flex-grow bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-neon-pink transition-colors placeholder:text-baby-blue/20 text-white"
        />
        <div className="flex items-center bg-white/5 border border-white/10 rounded-xl px-3 gap-2 shrink-0">
          <span className="text-[10px] uppercase tracking-widest text-baby-blue/40 whitespace-nowrap">Target:</span>
          <input
            type="number"
            min="1"
            max="10"
            value={newHabitMax}
            onChange={(e) => setNewHabitMax(Math.max(1, parseInt(e.target.value) || 1))}
            disabled={isAdding}
            className="w-8 bg-transparent border-none p-0 text-center text-sm font-bold text-white focus:ring-0 focus:outline-none"
          />
        </div>
        <button 
          onClick={handleAddHabit}
          disabled={isAdding || !newHabitText.trim()}
          className="p-2.5 bg-neon-pink rounded-xl text-black hover:bg-neon-purple hover:shadow-[0_0_12px_rgba(255,0,255,0.4)] disabled:opacity-50 disabled:hover:shadow-none disabled:bg-neon-pink/30 disabled:text-black/60 transition-all flex items-center justify-center w-11 h-11 shrink-0 cursor-pointer"
        >
          {isAdding ? <RefreshCw size={18} className="animate-spin" /> : <Plus size={20} />}
        </button>
      </div>
      
      <div className="space-y-4">
        {habitsConfig.map((conf) => {
          const habit = currentHabits[conf.key] || { habitKey: conf.key, value: 0 };
          const targetMax = conf.max || 1;
          const isComplete = habit.value >= targetMax;
          const streak = streaks[conf.key] || 0;
          const goal = profile?.habitGoals?.[conf.key];

          return (
            <div key={conf.key} className="flex flex-col gap-2 p-4 rounded-xl bg-white/5 border border-white/5 hover:border-white/10 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className={`text-sm tracking-wide ${isComplete ? 'text-white font-medium' : 'text-baby-blue/80'}`}>
                    {conf.label}
                  </span>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-neon-pink uppercase tracking-widest font-bold">
                      Streak: {streak} 🔥
                    </span>
                    {goal && (
                      <span className="text-[10px] text-neon-cyan uppercase tracking-widest font-bold">
                        | Goal: {goal.target}/{goal.type === 'weekly' ? 'wk' : 'mo'}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => {
                      setTempGoal(goal || { type: 'weekly', target: 3 });
                      setEditingGoalKey(editingGoalKey === conf.key ? null : conf.key);
                    }}
                    className="text-baby-blue/30 hover:text-white transition-colors cursor-pointer"
                    title="Edit Goal"
                  >
                    <Edit2 size={14} />
                  </button>

                  <button 
                    onClick={() => setHabitToDelete(conf)}
                    className="text-baby-blue/30 hover:text-red-400 transition-colors cursor-pointer"
                    title="Delete Habit"
                  >
                    <Trash2 size={14} />
                  </button>

                  <div className="flex gap-1.5">
                    {Array.from({ length: targetMax }).map((_, i) => (
                      <button
                        key={i}
                        onClick={() => onUpdate(conf.key, habit.value > i ? i : i + 1)}
                        className={`
                          w-5 h-5 rounded-full flex items-center justify-center border transition-all cursor-pointer
                          ${habit.value > i 
                            ? 'bg-neon-blue border-neon-blue shadow-[0_0_8px_var(--color-neon-blue)]' 
                            : 'border-white/20 hover:border-neon-blue/40'}
                        `}
                      >
                        {habit.value > i && <Check size={12} className="text-black" />}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Goal Editor */}
              {editingGoalKey === conf.key && (
                <div className="mt-2 p-3 bg-black/40 border border-white/10 rounded-lg flex items-center gap-3 text-xs">
                  <span className="text-baby-blue/60 uppercase tracking-widest font-bold">Target:</span>
                  <input 
                    type="number" 
                    min="1" 
                    max={tempGoal.type === 'weekly' ? 7 : 31}
                    value={tempGoal.target}
                    onChange={e => setTempGoal({ ...tempGoal, target: parseInt(e.target.value) || 1 })}
                    className="w-16 bg-white/5 border border-white/10 rounded px-2 py-1 text-white focus:outline-none focus:border-neon-cyan"
                  />
                  <select 
                    value={tempGoal.type}
                    onChange={e => setTempGoal({ ...tempGoal, type: e.target.value as 'weekly'|'monthly' })}
                    className="bg-white/5 border border-white/10 rounded px-2 py-1 text-white focus:outline-none focus:border-neon-cyan cursor-pointer"
                  >
                    <option value="weekly" className="bg-black">per week</option>
                    <option value="monthly" className="bg-black">per month</option>
                  </select>
                  <button 
                    onClick={() => saveGoal(conf.key)}
                    className="ml-auto px-3 py-1 bg-neon-purple text-black rounded font-bold uppercase tracking-widest hover:bg-white hover:text-black transition-colors"
                  >
                    Save
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {habitsConfig.length === 0 && (
          <p className="text-center py-8 text-baby-blue/20 text-sm italic">No habits configured. Create one above!</p>
        )}
      </div>

      {/* Delete Habit Confirmation Modal */}
      <AnimatePresence>
        {habitToDelete && (
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
              className="bg-zinc-950 border border-red-500/30 rounded-3xl p-6 shadow-2xl max-w-lg w-full space-y-6"
            >
              <div className="flex items-start gap-4">
                <div className="p-3 bg-red-500/10 rounded-2xl border border-red-500/30 text-red-500 shrink-0">
                  <AlertTriangle size={28} />
                </div>
                <div className="space-y-1 flex-grow">
                  <h3 className="text-xl font-bold uppercase tracking-wider text-red-400 font-poiret">Delete Habit: {habitToDelete.label}</h3>
                  <p className="text-xs text-baby-blue/60 leading-relaxed">
                    You are removing this habit. How would you like to handle your existing historical completion logs for this habit?
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3">
                <button
                  disabled={isDeleting}
                  onClick={() => handleDeleteHabitExecute('hide')}
                  className="p-4 bg-white/5 border border-white/10 hover:border-neon-cyan/40 hover:bg-neon-cyan/5 rounded-xl text-left transition-all cursor-pointer disabled:opacity-50"
                >
                  <div className="font-bold text-sm text-neon-cyan uppercase tracking-wider">Keep History & Hide Habit</div>
                  <div className="text-[11px] text-baby-blue/50 mt-1 leading-relaxed">
                    Hides the habit from future daily checklists but keeps all completed logs so historical graphs and matrices remain intact in Analytics. (Recommended)
                  </div>
                </button>

                <button
                  disabled={isDeleting}
                  onClick={() => handleDeleteHabitExecute('wipe')}
                  className="p-4 bg-white/5 border border-white/10 hover:border-red-500/40 hover:bg-red-500/5 rounded-xl text-left transition-all cursor-pointer disabled:opacity-50"
                >
                  <div className="font-bold text-sm text-red-400 uppercase tracking-wider">Wipe Habit & All History</div>
                  <div className="text-[11px] text-baby-blue/50 mt-1 leading-relaxed">
                    Completely deletes the habit config and scrubs all daily logs from your profile database. This habit will disappear entirely from all past Analytics.
                  </div>
                </button>
              </div>

              <div className="flex justify-end gap-3 border-t border-white/5 pt-4">
                <button
                  disabled={isDeleting}
                  onClick={() => setHabitToDelete(null)}
                  className="px-4 py-2 bg-white/5 border border-white/10 text-baby-blue/80 font-bold uppercase tracking-wider text-xs rounded-xl hover:text-white transition-all cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
