import { useState, useEffect, useRef, useMemo } from 'react';
import { Task } from '../types';
import { Plus, Trash2, CheckCircle2, Circle, Clock } from 'lucide-react';

const parse24To12 = (timeStr: string) => {
  if (!timeStr) return { hour: '12', minute: '00', period: 'AM' };
  const [hStr, mStr] = timeStr.split(':');
  let h = parseInt(hStr, 10);
  const m = mStr || '00';
  if (isNaN(h)) return { hour: '12', minute: '00', period: 'AM' };
  const period = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return { hour: String(h), minute: m, period };
};

const format12To24 = (hour: string, minute: string, period: string) => {
  let h = parseInt(hour, 10);
  if (isNaN(h)) h = 12;
  if (period === 'PM' && h < 12) h += 12;
  if (period === 'AM' && h === 12) h = 0;
  const hStr = String(h).padStart(2, '0');
  return `${hStr}:${minute}`;
};

function TimePicker({ time, onChange }: { time: string; onChange: (t: string) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const { hour, minute, period } = parse24To12(time);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (newH: string, newM: string, newP: string) => {
    const formatted = format12To24(newH, newM, newP);
    onChange(formatted);
  };

  const hours = Array.from({ length: 12 }, (_, i) => String(i + 1));
  const minutes = ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'];

  return (
    <div className="relative inline-block" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[10px] text-neon-cyan uppercase tracking-widest font-bold font-mono hover:bg-white/10 transition-all cursor-pointer select-none"
      >
        <Clock size={11} className="text-neon-cyan/80 shrink-0" />
        {time ? `${hour.padStart(2, '0')}:${minute} ${period}` : 'SET TIME'}
      </button>

      {isOpen && (
        <div className="absolute left-0 mt-1.5 z-50 p-2.5 rounded-xl bg-black/95 border border-white/20 backdrop-blur-md shadow-[0_10px_30px_rgba(0,0,0,0.8)] flex flex-col gap-2 min-w-[210px] text-xs">
          <div className="grid grid-cols-3 gap-1.5">
            {/* Hours column */}
            <div className="flex flex-col gap-1">
              <span className="text-[8px] text-baby-blue/40 font-bold uppercase text-center tracking-wider pb-0.5 border-b border-white/5">HOUR</span>
              <div className="max-h-[110px] overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 flex flex-col gap-0.5">
                {hours.map(h => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => handleSelect(h, minute, period)}
                    className={`py-1 text-[11px] rounded font-mono transition-all ${hour === h ? 'bg-neon-cyan text-black font-extrabold' : 'hover:bg-white/10 text-baby-blue/80'}`}
                  >
                    {h.padStart(2, '0')}
                  </button>
                ))}
              </div>
            </div>

            {/* Minutes column */}
            <div className="flex flex-col gap-1">
              <span className="text-[8px] text-baby-blue/40 font-bold uppercase text-center tracking-wider pb-0.5 border-b border-white/5">MIN</span>
              <div className="max-h-[110px] overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 flex flex-col gap-0.5">
                {minutes.map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => handleSelect(hour, m, period)}
                    className={`py-1 text-[11px] rounded font-mono transition-all ${minute === m ? 'bg-neon-cyan text-black font-extrabold' : 'hover:bg-white/10 text-baby-blue/80'}`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {/* AM/PM Column */}
            <div className="flex flex-col gap-1">
              <span className="text-[8px] text-baby-blue/40 font-bold uppercase text-center tracking-wider pb-0.5 border-b border-white/5">PERIOD</span>
              <div className="flex flex-col gap-1.5 h-full justify-center">
                {['AM', 'PM'].map(p => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => handleSelect(hour, minute, p)}
                    className={`py-2 text-[10px] rounded font-bold transition-all ${period === p ? 'bg-neon-cyan text-black font-extrabold' : 'hover:bg-white/10 text-baby-blue/80'}`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface TaskListProps {
  date: string;
  tasks: Task[];
  onAdd: (task: Partial<Task>) => void;
  onUpdate: (taskId: string, updates: Partial<Task>) => void;
  onDelete: (taskId: string) => void;
}

export default function TaskList({ tasks, onAdd, onUpdate, onDelete }: TaskListProps) {
  const [newTaskText, setNewTaskText] = useState('');

  const getPriorityWeight = (importance: string) => {
    switch (importance?.toLowerCase()) {
      case 'urgent': return 4;
      case 'high': return 3;
      case 'medium':
      case 'med': return 2;
      case 'low': return 1;
      default: return 2;
    }
  };

  const sortedTasks = useMemo(() => {
    return [...tasks].sort((a, b) => {
      if (a.done !== b.done) {
        return a.done ? 1 : -1;
      }
      return getPriorityWeight(b.importance || 'medium') - getPriorityWeight(a.importance || 'medium');
    });
  }, [tasks]);

  const handleAdd = () => {
    if (!newTaskText.trim()) return;
    onAdd({ text: newTaskText, done: false, importance: 'medium' });
    setNewTaskText('');
  };

  const getImportanceColorClass = (importance: string) => {
    switch (importance?.toLowerCase()) {
      case 'low':
        return 'text-neon-cyan';
      case 'medium':
      case 'med':
        return 'text-neon-purple';
      case 'high':
        return 'text-neon-pink';
      case 'urgent':
        return 'text-red-500';
      default:
        return 'text-neon-purple';
    }
  };

  const getImportanceLabel = (importance: string) => {
    switch (importance?.toLowerCase()) {
      case 'low':
        return 'LOW';
      case 'medium':
      case 'med':
        return 'MED';
      case 'high':
        return 'HIGH';
      case 'urgent':
        return 'URGENT';
      default:
        return 'MED';
    }
  };

  const cycleImportance = (current: string) => {
    const normalized = current?.toLowerCase();
    if (normalized === 'low') return 'medium';
    if (normalized === 'medium' || normalized === 'med') return 'high';
    if (normalized === 'high') return 'urgent';
    return 'low';
  };

  return (
    <div className="space-y-4">
      <h3 className="text-xs uppercase tracking-[0.2em] text-neon-pink font-bold mb-4 opacity-80">Daily Actions</h3>

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={newTaskText}
          onChange={(e) => setNewTaskText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder="What needs to be done?"
          className="flex-grow bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-neon-blue transition-colors placeholder:text-baby-blue/20"
        />
        <button 
          onClick={handleAdd}
          className="p-2 bg-neon-blue rounded-xl text-black hover:bg-neon-cyan transition-colors cursor-pointer"
        >
          <Plus size={20} />
        </button>
      </div>

      <div className="space-y-2">
        {sortedTasks.map((task) => (
          <div key={task.id} className="group flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/5 hover:border-white/10 transition-all">
            <button 
              onClick={() => onUpdate(task.id!, { done: !task.done })}
              className={`transition-colors cursor-pointer ${task.done ? 'text-neon-cyan' : 'text-baby-blue/30 hover:text-neon-blue'}`}
            >
              {task.done ? <CheckCircle2 size={20} /> : <Circle size={20} />}
            </button>

            <div className="flex-grow flex flex-col">
              <input
                type="text"
                value={task.text}
                onChange={(e) => onUpdate(task.id!, { text: e.target.value })}
                className={`bg-transparent border-none p-0 text-sm focus:ring-0 ${task.done ? 'text-baby-blue/30' : 'text-baby-blue'}`}
              />
              <div className="flex items-center gap-4 mt-1">
                <TimePicker 
                  time={task.time || ''} 
                  onChange={(newTime) => onUpdate(task.id!, { time: newTime })} 
                />
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-bold">
                  <button
                    type="button"
                    onClick={() => onUpdate(task.id!, { importance: cycleImportance(task.importance || 'medium') })}
                    className={`bg-transparent border-none p-0 text-[10px] uppercase tracking-widest font-bold cursor-pointer transition-colors ${getImportanceColorClass(task.importance || 'medium')}`}
                  >
                    {getImportanceLabel(task.importance || 'medium')}
                  </button>
                </div>
              </div>
            </div>

            <button 
              onClick={() => onDelete(task.id!)}
              className="opacity-0 group-hover:opacity-100 p-2 text-baby-blue/20 hover:text-red-400 transition-all cursor-pointer"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}

        {tasks.length === 0 && (
          <p className="text-center py-8 text-baby-blue/20 text-sm italic">Clear day, clear mind.</p>
        )}
      </div>
    </div>
  );
}
