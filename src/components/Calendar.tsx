import { format, startOfYear, endOfYear, eachMonthOfInterval, startOfMonth, endOfMonth, eachDayOfInterval, isToday, isSameDay } from 'date-fns';
import { motion } from 'motion/react';

interface CalendarProps {
  onDateSelect: (date: Date) => void;
  entries: { [key: string]: any }; // date string -> entry
}

export default function Calendar({ onDateSelect, entries }: CalendarProps) {
  const currentYear = new Date().getFullYear();
  const yearStart = startOfYear(new Date(currentYear, 0, 1));
  const yearEnd = endOfYear(new Date(currentYear, 0, 1));
  const months = eachMonthOfInterval({ start: yearStart, end: yearEnd });

  return (
    <div className="p-8 max-w-7xl mx-auto overflow-y-auto h-full scrollbar-hide">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-12"
      >
        <h1 className="text-6xl font-poiret tracking-[0.2em] text-neon-cyan neon-glow-blue uppercase mb-2">
          {currentYear}
        </h1>
        <p className="text-baby-blue/60 tracking-widest text-sm uppercase">Lumina AI Journal • CBT Edition</p>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
        {months.map((month) => {
          const monthStart = startOfMonth(month);
          const monthEnd = endOfMonth(month);
          const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

          return (
            <motion.div 
              key={month.toString()}
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              className="glass p-4 rounded-2xl border-white/5 hover:border-neon-blue/30 transition-colors"
            >
              <h2 className="text-lg text-center font-medium text-neon-purple neon-glow-purple mb-4 uppercase tracking-wider">
                {format(month, 'MMMM')}
              </h2>
              
              <div className="grid grid-cols-7 gap-1 text-[10px] mb-2 text-baby-blue/40 font-bold uppercase">
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                  <div key={i} className="text-center">{d}</div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1">
                {/* Empty cells for padding */}
                {Array.from({ length: monthStart.getDay() }).map((_, i) => (
                  <div key={`empty-${i}`} />
                ))}
                
                {days.map((day) => {
                  const dateStr = format(day, 'yyyy-MM-dd');
                  const hasEntry = !!entries[dateStr];
                  const entry = entries[dateStr];
                  const hasAnalysis = !!entry?.analysis;

                  return (
                    <button
                      key={day.toString()}
                      onClick={() => onDateSelect(day)}
                      title={dateStr}
                      className={`
                        aspect-square flex items-center justify-center rounded-full text-xs transition-all
                        ${isToday(day) ? 'ring-1 ring-neon-cyan text-neon-cyan shadow-[0_0_8px_rgba(0,225,255,0.3)]' : 'text-baby-blue/60'}
                        ${hasEntry ? 'bg-neon-blue/20 text-white font-bold' : 'hover:bg-white/5'}
                        ${hasAnalysis ? 'ring-1 ring-neon-pink shadow-[0_0_8px_rgba(255,112,148,0.3)]' : ''}
                      `}
                    >
                      {format(day, 'd')}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
