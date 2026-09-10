import { useState, useMemo } from 'react';
import { 
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  LineChart, Line 
} from 'recharts';
import { JournalEntry, Habit, MOOD_OPTIONS, UserProfile, LongTermAnalysis, HABIT_CONFIG, getMoodScore, getMoodEmoji } from '../types';
import { format, parseISO, subDays, eachDayOfInterval } from 'date-fns';
import { saveAs } from 'file-saver';
import { Sparkles, Brain, Activity, Target } from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { motion } from 'motion/react';

interface AnalyticsProps {
  entries: JournalEntry[];
  habits: Habit[];
  profile: UserProfile | null;
  onAlert?: (title: string, message: string) => void;
}

export default function Analytics({ entries, habits, profile, onAlert }: AnalyticsProps) {
  const [analyzing, setAnalyzing] = useState(false);
  const isLight = profile?.theme === 'light';
  
  const habitsConfig = useMemo(() => {
    const list = profile?.habitsList || HABIT_CONFIG;
    // Sort in ascending order of frequency (max)
    return [...list].sort((a, b) => (a.max || 1) - (b.max || 1));
  }, [profile?.habitsList]);

  // Process Mood Frequency (Last 30 Days)
  const last30Days = useMemo(() => {
    return eachDayOfInterval({
      start: subDays(new Date(), 29),
      end: new Date()
    }).map(d => format(d, 'yyyy-MM-dd'));
  }, []);

  // Process Mood Trend Chronologically (Last 30 Days)
  const moodTrendData = useMemo(() => {
    const rawData = last30Days.map(date => {
      const entry = entries.find(e => e.date === date);
      return {
        date: format(parseISO(date), 'MMM d'),
        score: entry ? getMoodScore(entry.mood) : null,
        mood: entry ? entry.mood : null,
        rawDate: date,
        isInterpolated: !entry
      };
    });

    const interpolatedData = [...rawData];
    for (let i = 0; i < interpolatedData.length; i++) {
      if (interpolatedData[i].score === null) {
        let prevIdx = -1;
        for (let j = i - 1; j >= 0; j--) {
          if (rawData[j].score !== null) {
            prevIdx = j;
            break;
          }
        }
        let nextIdx = -1;
        for (let j = i + 1; j < rawData.length; j++) {
          if (rawData[j].score !== null) {
            nextIdx = j;
            break;
          }
        }

        if (prevIdx !== -1 && nextIdx !== -1) {
          const prevScore = rawData[prevIdx].score!;
          const nextScore = rawData[nextIdx].score!;
          const fraction = (i - prevIdx) / (nextIdx - prevIdx);
          interpolatedData[i].score = prevScore + (nextScore - prevScore) * fraction;
        } else if (prevIdx !== -1) {
          interpolatedData[i].score = rawData[prevIdx].score;
        } else if (nextIdx !== -1) {
          interpolatedData[i].score = rawData[nextIdx].score;
        } else {
          interpolatedData[i].score = null;
        }
      }
    }
    return interpolatedData;
  }, [entries, last30Days]);

  const HABIT_NEON_COLORS: Record<string, string> = {
    make_bed: '#00f0ff',        // Neon Cyan
    dose: '#ff007f',            // Neon Pink
    am_skincare: '#39ff14',     // Neon Green
    empty_sink: '#ffb703',      // Neon Gold/Yellow
    pm_skincare: '#bd00ff',     // Neon Purple
    journal_evening: '#00ffd5', // Neon Turquoise
    take_trash: '#ff5e00',      // Neon Orange
    eat: '#e5ff00',             // Neon Lime Yellow
    water: '#2979ff'            // Neon Blue
  };

  const getNeonColor = (key: string) => {
    if (HABIT_NEON_COLORS[key]) return HABIT_NEON_COLORS[key];
    const altColors = [
      '#ff00ff', // Pink/Magenta
      '#00ff00', // Green
      '#00ffff', // Cyan
      '#ffff00', // Yellow
      '#ff4500', // OrangeRed
      '#7b1fa2', // Purple
      '#00e676', // Bright Green
      '#ff1744', // Bright Red
      '#1de9b6', // Teal
      '#2979ff', // Blue
    ];
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = key.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % altColors.length;
    return altColors[index];
  };

  const exportCSV = () => {
    let csv = "Date,Habit/Mood,Value\n";
    last30Days.forEach(date => {
      const entry = entries.find(e => e.date === date);
      if (entry?.mood) csv += `${date},Mood,${entry.mood}\n`;
      const dayHabits = habits.filter(h => h.date === date);
      dayHabits.forEach(h => {
        csv += `${date},${h.habitKey},${h.value}\n`;
      });
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    saveAs(blob, `lumina_analytics_${format(new Date(), 'yyyy-MM-dd')}.csv`);
  };

  const handleGenerateLongTermAnalysis = async () => {
    if (!profile) return;
    setAnalyzing(true);
    try {
      const recentEntries = entries
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 30)
        .map(e => ({
          date: e.date,
          content: e.content.replace(/<[^>]*>/g, ''),
          mood: e.mood,
          tags: [
            ...(Array.isArray(e.tags) ? e.tags : []),
            ...(Array.isArray(e.analysis?.tags) ? e.analysis.tags : [])
          ],
        }));

      const res = await fetch('/api/analyze-trends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: recentEntries })
      });
      const analysis: LongTermAnalysis & { error?: string } = await res.json();
      if (!res.ok) {
        throw new Error(analysis.error || 'Failed to analyze trends');
      }
      
      await updateDoc(doc(db, 'users', profile.uid), { longTermAnalysis: analysis });
    } catch (e) {
      if (e instanceof Error && e.message.includes('analyze')) {
        if (onAlert) {
          onAlert("AI Analysis Error", e.message);
        } else {
          alert(`AI Analysis Error: ${e.message}`);
        }
        return;
      }
      if (e instanceof Error && e.message.includes('OperationType')) {
        throw e; // already handled
      }
      if (e instanceof TypeError) {
         console.error(e);
      } else {
         try {
            const { handleFirestoreError, OperationType } = await import('../lib/firebase');
            handleFirestoreError(e, OperationType.WRITE, 'users');
         } catch(err) {
            console.error(err);
         }
      }
      if (onAlert) {
        onAlert("Analysis Failed", "Long-term analysis failed.");
      } else {
        alert("Long-term analysis failed.");
      }
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="p-8 space-y-12 max-w-5xl mx-auto h-full overflow-y-auto scrollbar-hide pb-32">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-3xl font-poiret text-neon-cyan neon-glow-blue uppercase tracking-widest">
            Insights & Trends
          </h2>
          <p className="text-baby-blue/40 text-sm mt-2 uppercase tracking-widest">Biological & Emotional Feedback</p>
        </div>
        <button 
          onClick={exportCSV}
          className="px-4 py-2 bg-white/5 border border-white/10 rounded-full text-[10px] uppercase font-bold tracking-widest text-baby-blue hover:text-white transition-all"
        >
          Export CSV
        </button>
      </div>

      <div className="grid grid-cols-1 gap-12">
        {/* Long Term AI Report */}
        <div className="glass p-8 rounded-2xl space-y-6 relative overflow-hidden">
          <div className="absolute -right-10 -top-10 text-neon-purple/5 rotate-12 pointer-events-none">
            <Brain size={200} />
          </div>
          
          <div className="flex justify-between items-center relative z-10">
            <h3 className="text-sm font-bold text-neon-purple uppercase tracking-widest border-l-2 border-neon-purple pl-3">
              Long-Term AI Assessment
            </h3>
            <button 
              onClick={handleGenerateLongTermAnalysis}
              disabled={analyzing}
              className={`flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-widest rounded-full transition-all border border-neon-purple shadow-[0_0_15px_rgba(191,0,255,0.2)] ${analyzing ? 'opacity-50' : 'bg-neon-purple/20 text-neon-purple hover:bg-neon-purple hover:text-black'}`}
            >
               <Sparkles size={14} /> {analyzing ? 'Synthesizing...' : 'Generate New Report'}
            </button>
          </div>

          {profile?.longTermAnalysis ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6 relative z-10 mt-4">
              <div className="p-4 bg-black/40 border border-white/10 rounded-xl space-y-2">
                <div className="flex items-center gap-2 text-neon-cyan mb-2">
                  <Activity size={16} />
                  <span className="text-xs uppercase font-bold tracking-widest">Disposition Consistencies</span>
                </div>
                <p className="text-sm leading-relaxed text-baby-blue/80 italic">{profile.longTermAnalysis.overallDisposition}</p>
                <p className="text-sm leading-relaxed text-white mt-2">{profile.longTermAnalysis.longTermTrends}</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 <div className="p-4 bg-black/40 border border-white/10 rounded-xl space-y-4">
                    <div className="flex items-center gap-2 text-neon-pink">
                      <Target size={16} />
                      <span className="text-xs uppercase font-bold tracking-widest">Recurring Themes</span>
                    </div>
                    <ul className="space-y-2">
                      {profile.longTermAnalysis.recurringThemes.map((theme, i) => (
                        <li key={i} className="text-sm text-baby-blue/70 flex items-start gap-2">
                          <span className="text-neon-pink inline-block mt-0.5">•</span> {theme}
                        </li>
                      ))}
                    </ul>
                 </div>
                 <div className="p-4 bg-black/40 border border-white/10 rounded-xl space-y-4">
                    <div className="flex items-center gap-2 text-neon-blue">
                      <Sparkles size={16} />
                      <span className="text-xs uppercase font-bold tracking-widest">Significant Shifts</span>
                    </div>
                    <ul className="space-y-2">
                      {profile.longTermAnalysis.significantShifts.map((shift, i) => (
                        <li key={i} className="text-sm text-baby-blue/70 flex items-start gap-2">
                          <span className="text-neon-blue inline-block mt-0.5">•</span> {shift}
                        </li>
                      ))}
                    </ul>
                 </div>
              </div>
            </motion.div>
          ) : (
            <div className="text-center py-8">
              <p className="text-baby-blue/30 text-sm italic">Generate an AI assessment to uncover emotional and behavioral trends across your recent journals.</p>
            </div>
          )}
        </div>

        {/* Mood Trend Timeline */}
        <div className="glass p-6 rounded-2xl space-y-6">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-bold text-neon-pink uppercase tracking-widest border-l-2 border-neon-pink pl-3 font-poiret text-base">
              Mood Timeline & fluctuations (30d)
            </h3>
            <span className="text-[10px] text-baby-blue/40 uppercase tracking-widest font-mono">Ups & Downs Tracker</span>
          </div>
          <div className="h-[380px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={moodTrendData} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={isLight ? "rgba(15, 23, 42, 0.08)" : "#88888815"} vertical={false} />
                <XAxis 
                  dataKey="date" 
                  stroke={isLight ? "rgba(15, 23, 42, 0.15)" : "#ffffff20"} 
                  tick={{ fill: isLight ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.85)', fontSize: 10, fontWeight: 600 }}
                  tickLine={false} 
                  axisLine={false}
                />
                <YAxis 
                  domain={[1, 11]}
                  ticks={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]}
                  stroke={isLight ? "rgba(15, 23, 42, 0.15)" : "#ffffff20"} 
                  tick={{ fill: isLight ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.85)', fontSize: 10, fontWeight: 600 }}
                  tickLine={false} 
                  axisLine={false} 
                  tickFormatter={(score) => {
                    if (score === 11) return '😍 In love';
                    if (score === 10) return '😊 Happy';
                    if (score === 9) return '🤩 Excited';
                    if (score === 8) return '😌 Peaceful';
                    if (score === 7) return '🙂 Okay';
                    if (score === 6) return '😴 Tired';
                    if (score === 5) return '😢 Sad';
                    if (score === 4) return '😰 Anxious';
                    if (score === 3) return '😤 Frustrated';
                    if (score === 2) return '😡 Angry';
                    if (score === 1) return '💔 Heartbroken';
                    return '';
                  }}
                  width={110}
                />
                 <Tooltip 
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      if (data.score === null || data.isInterpolated) return null;
                      const emoji = getMoodEmoji(data.mood || '');
                      return (
                        <div className={`p-3 rounded-xl shadow-2xl backdrop-blur-md border ${isLight ? 'bg-white border-slate-200 text-slate-900' : 'bg-black/90 border-white/10 text-white'}`}>
                          <p className={`text-[10px] uppercase tracking-widest font-mono ${isLight ? 'text-slate-400' : 'text-baby-blue/40'}`}>{data.rawDate}</p>
                          <p className={`text-sm font-medium flex items-center gap-1.5 mt-1 ${isLight ? 'text-slate-900' : 'text-white'}`}>
                            <span>{emoji}</span>
                            <span>{data.mood}</span>
                          </p>
                          <p className={`text-[10px] mt-1 uppercase tracking-widest font-bold ${isLight ? 'text-pink-600' : 'text-neon-pink'}`}>Score: {data.score}/11</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Line 
                  type="monotone" 
                  dataKey="score" 
                  stroke="#ff007f" 
                  strokeWidth={2.5} 
                  dot={(props: any) => {
                    if (props.payload.isInterpolated) return <></>;
                    return (
                      <circle 
                        key={props.key || `dot-${props.cx}-${props.cy}`}
                        cx={props.cx} 
                        cy={props.cy} 
                        r={3} 
                        fill="#ff007f" 
                        stroke="#000" 
                        strokeWidth={1} 
                      />
                    );
                  }}
                  activeDot={(props: any) => {
                    if (props.payload.isInterpolated) return <></>;
                    return (
                      <circle 
                        cx={props.cx} 
                        cy={props.cy} 
                        r={5} 
                        fill="#00f0ff" 
                        stroke="#fff" 
                        strokeWidth={2} 
                      />
                    );
                  }}
                  connectNulls={true}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Habit Completion Matrix (Dot Matrix / Heat Map) */}
        <div className="glass p-6 rounded-2xl space-y-6">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-bold text-neon-purple uppercase tracking-widest border-l-2 border-neon-purple pl-3 font-poiret text-base">
              Daily Goals Completion Matrix (30d)
            </h3>
            <span className="text-[10px] text-baby-blue/40 uppercase tracking-widest font-poiret font-bold">Past 30 Days ──► Today</span>
          </div>

          <div className="overflow-x-auto scrollbar-hide pb-2">
            <div className="min-w-[760px] space-y-4">
              {/* Grid Header Dates */}
              <div className="flex items-center">
                <div className="w-36 flex-shrink-0" />
                <div className="flex-1 flex justify-between px-1 text-[10px] uppercase tracking-widest text-baby-blue/30 font-poiret font-bold">
                  {(() => {
                    const steps = [0, 7, 14, 21, 29];
                    return steps.map(stepIdx => {
                      if (stepIdx < last30Days.length) {
                        const dateStr = last30Days[stepIdx];
                        return (
                          <span key={stepIdx} style={{ transform: 'translateX(-50%)' }}>
                            {format(parseISO(dateStr), 'MMM d')}
                          </span>
                        );
                      }
                      return null;
                    });
                  })()}
                </div>
              </div>

              {/* Habit Rows */}
              <div className="space-y-3">
                {habitsConfig.map((conf) => {
                  const targetMax = conf.max || 1;
                  const neonColor = getNeonColor(conf.key);
                  return (
                    <div key={conf.key} className="flex items-center">
                      {/* Habit Name Column */}
                      <div className="w-36 flex-shrink-0 text-xs font-poiret font-bold uppercase tracking-wider text-baby-blue/70 truncate pr-3">
                        {conf.label}{conf.hidden ? ' (Retired)' : ''}
                      </div>

                      {/* 30 Dots Column */}
                      <div className="flex-1 flex justify-between">
                        {last30Days.map((date) => {
                          const dayHabit = habits.find(h => h.habitKey === conf.key && h.date === date);
                          const val = dayHabit ? dayHabit.value : 0;
                          const isCompleted = val >= targetMax;
                          const isPartiallyCompleted = val > 0 && val < targetMax;

                          let dotStyle: React.CSSProperties = {};
                          if (isCompleted) {
                            dotStyle = {
                              backgroundColor: neonColor,
                              boxShadow: isLight ? 'none' : `0 0 10px ${neonColor}, 0 0 4px ${neonColor}`,
                              borderColor: neonColor
                            };
                          } else if (isPartiallyCompleted) {
                            dotStyle = {
                              backgroundColor: `${neonColor}50`,
                              borderColor: neonColor,
                              borderWidth: '1.5px',
                              boxShadow: 'none'
                            };
                          } else {
                            dotStyle = {
                              backgroundColor: isLight ? 'rgba(15, 23, 42, 0.04)' : 'rgba(255, 255, 255, 0.02)',
                              borderColor: isLight ? 'rgba(15, 23, 42, 0.12)' : 'rgba(255, 255, 255, 0.08)',
                              borderWidth: '1px',
                              boxShadow: 'none'
                            };
                          }

                          const formattedDate = format(parseISO(date), 'MMM d, yyyy');
                          const statusText = isCompleted 
                            ? 'Completed' 
                            : isPartiallyCompleted 
                              ? `Partially Complete (${val}/${targetMax})` 
                              : 'Incomplete';

                          return (
                            <div
                              key={date}
                              className="w-3.5 h-3.5 rounded-full transition-all duration-300 hover:scale-125 cursor-help"
                              style={dotStyle}
                              title={`${conf.label}${conf.hidden ? ' (Retired)' : ''} on ${formattedDate}: ${statusText}`}
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Heatmap Legend */}
          <div className="flex flex-wrap gap-x-6 gap-y-2 pt-4 border-t border-white/5 text-[9px] uppercase font-bold tracking-widest text-baby-blue/40 font-mono">
            <span className="text-[9px] uppercase tracking-wider text-baby-blue/30 mr-2 flex items-center">Legend:</span>
            {habitsConfig.map(conf => {
              const neonColor = getNeonColor(conf.key);
              return (
                <div key={conf.key} className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: neonColor, boxShadow: `0 0 6px ${neonColor}` }} />
                  <span>{conf.label}{conf.hidden ? ' (Retired)' : ''}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
